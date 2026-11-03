import { EventEmitter } from "events"

import { logger } from "../../shared/logger"
import { attributeChanges, diffSnapshots } from "./changeAttribution"
import type { ProjectSnapshot } from "./projectFingerprint"
import type { ProjectRootResolution } from "./projectRoot"
import { loadSnapshot, saveSnapshot } from "./snapshotStore"
import type {
	AttributedChange,
	VerificationEnvironment,
	VerificationInvalidation,
	TaskVerificationRecord,
} from "./types"
import { evaluateVerification, environmentsDiffer, type VerificationVerdict } from "./verdict"
import { loadVerificationRecord, updateVerificationRecord, withInvalidation } from "./VerificationStore"

type Cause = VerificationInvalidation["cause"]
type Disposable = { dispose(): void }

export interface ChangeMonitorDeps {
	taskDir(): Promise<string>
	resolveRoot(): Promise<ProjectRootResolution>
	snapshot(root: string): Promise<ProjectSnapshot | undefined>
	environment(): Promise<VerificationEnvironment>
	now(): number
	watchInputs?: (onChange: (filePath: string) => void) => Disposable
	watchEnvironment?: (onChange: () => void) => Disposable
}

export interface VerificationChange {
	verdict: VerificationVerdict
	changes: AttributedChange[]
	codeChanged: boolean
	cause: Cause
}

/** Observe input changes without changing code or overwriting verification facts. */
export class CangjieChangeMonitor {
	private readonly events = new EventEmitter()
	private readonly subscriptions: Disposable[] = []
	private timer?: ReturnType<typeof setTimeout>
	private pending: Promise<unknown> = Promise.resolve()
	private started = false
	private disposed = false

	constructor(
		private readonly task: { taskId: string; writtenPaths(): string[] },
		private readonly deps: ChangeMonitorDeps,
	) {}

	readonly onDidChange = (listener: (change: VerificationChange) => void): Disposable => {
		this.events.on("change", listener)
		return {
			dispose: () => {
				this.events.off("change", listener)
			},
		}
	}

	start(): void {
		if (this.started || this.disposed) return
		this.started = true
		const inputs = this.deps.watchInputs?.((filePath) => {
			if (
				filePath
					.split(/[\\/]/)
					.some((part) => ["target", ".git", "node_modules", ".njust_ai"].includes(part.toLowerCase()))
			)
				return
			this.schedule("file_change")
		})
		const environment = this.deps.watchEnvironment?.(() => this.schedule("environment_change"))
		if (inputs) this.subscriptions.push(inputs)
		if (environment) this.subscriptions.push(environment)
	}

	private schedule(cause: Cause): void {
		if (this.disposed) return
		clearTimeout(this.timer)
		this.timer = setTimeout(() => {
			this.timer = undefined
			void this.recheck(cause)
		}, 2_000)
	}

	/** Explicit restore checks still work after cancellation; only background subscriptions are disposed. */
	recheck(cause: Cause): Promise<VerificationChange | undefined> {
		clearTimeout(this.timer)
		this.timer = undefined
		const next = this.pending
			.then(() => this.check(cause))
			.catch((error) => {
				logger.debug("CangjieChangeMonitor", `Cannot recheck verification inputs (${cause})`, error)
				return undefined
			})
		this.pending = next
		return next
	}

	private async check(cause: Cause): Promise<VerificationChange | undefined> {
		const taskDir = await this.deps.taskDir()
		const record = await loadVerificationRecord(taskDir, this.task.taskId)
		if (!record || (record.runs.length === 0 && record.claims.length === 0)) return undefined
		const resolution = await this.deps.resolveRoot()
		if (resolution.kind !== "resolved") return undefined
		const snapshot = await this.deps.snapshot(resolution.root)
		if (!snapshot) return undefined
		const environment = await this.deps.environment()
		const verdict = evaluateVerification(record, snapshot.fingerprint, environment, snapshot)
		const reference = latestBinding(record)
		const delivery = latestBinding(record, false)
		const codeChanged = reference?.fingerprint !== undefined && reference.fingerprint !== snapshot.fingerprint
		const environmentChanged =
			environmentsDiffer(reference?.environment, environment) ||
			[verdict.build, verdict.test].some(
				(check) => check.state === "stale" && check.staleReason === "environment_changed",
			)
		const changesSince = async (fingerprint: string | undefined): Promise<AttributedChange[]> => {
			if (!fingerprint || fingerprint === snapshot.fingerprint) return []
			const before = await loadSnapshot(taskDir, fingerprint)
			return before
				? attributeChanges(diffSnapshots(before, snapshot), resolution.root, this.task.writtenPaths())
				: []
		}
		const changes = await changesSince(reference?.fingerprint)
		// History records each transition; delivery facts include ALL changes since the latest check/claim.
		const deliveryChanges =
			delivery?.fingerprint === reference?.fingerprint ? changes : await changesSince(delivery?.fingerprint)
		const info: VerificationChange = {
			verdict,
			changes: deliveryChanges,
			codeChanged: delivery?.fingerprint !== undefined && delivery.fingerprint !== snapshot.fingerprint,
			cause: codeChanged ? cause : environmentChanged ? "environment_change" : cause,
		}
		if (!codeChanged && !environmentChanged) return info
		const inv: VerificationInvalidation = {
			at: this.deps.now(),
			cause: info.cause,
			fromFingerprint: reference?.fingerprint,
			toFingerprint: snapshot.fingerprint,
			changes,
			changesTruncated: false,
			environment,
		}
		if (withInvalidation(record, inv) === record) return info
		const latestRun = record.runs.reduce<(typeof record.runs)[number] | undefined>(
			(latest, run) => (!latest || run.startedAt >= latest.startedAt ? run : latest),
			undefined,
		)
		const keep = [verdict.latestClaim?.inputFingerprint, latestRun?.inputFingerprint].filter(
			(fingerprint): fingerprint is string => fingerprint !== undefined,
		)
		await saveSnapshot(taskDir, snapshot, keep)
		let appended = false
		await updateVerificationRecord(taskDir, this.task.taskId, (current) => {
			const updated = withInvalidation(current, inv)
			appended = updated !== current
			return updated
		})
		if (appended && !this.disposed) this.events.emit("change", info)
		return info
	}

	dispose(): void {
		this.disposed = true
		clearTimeout(this.timer)
		this.timer = undefined
		for (const sub of this.subscriptions) sub.dispose()
		this.subscriptions.length = 0
		this.events.removeAllListeners()
	}
}

function latestBinding(record: TaskVerificationRecord, includeInvalidations = true) {
	const bindings = [
		...record.runs.map((run) => ({
			at: run.endedAt ?? run.startedAt,
			fingerprint: run.inputFingerprint,
			environment: {
				sdkHome: run.sdk?.home,
				sdkVersion: run.sdk?.version,
				cjpmPath: run.executable,
				backend: run.sdk?.backend ?? "guarded-host",
				image: run.sdk?.image,
				imageDigest: run.sdk?.imageDigest,
			},
		})),
		...record.claims.map((claim) => ({
			at: claim.claimedAt,
			fingerprint: claim.inputFingerprint,
			environment: undefined as VerificationEnvironment | undefined,
		})),
		...(includeInvalidations
			? record.invalidations.map((inv) => ({
					at: inv.at,
					fingerprint: inv.toFingerprint,
					environment: inv.environment,
				}))
			: []),
	]
	return bindings.reduce<(typeof bindings)[number] | undefined>(
		(latest, next) => (!latest || next.at >= latest.at ? next : latest),
		undefined,
	)
}
