import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { EventEmitter } from "events"
import { randomUUID } from "crypto"
import type { VerificationSummary, CangjieTaskProgress } from "@njust-ai/types"

import { logger } from "../../shared/logger"
import { getErrorMessage } from "../../shared/error-utils"
import { redactApiSecrets } from "../../utils/redactApiSecrets"
import { getTaskDirectoryPath } from "../../utils/storage"
import { suspendCangjieAutoFormat } from "../../services/cangjie-lsp/autoFormatSuspension"
import { checkAutoApproval } from "../auto-approval"
import type { CangjieAgentRouteKind } from "../agent/CangjieAgentRouter"

import { decideCangjieCompletion, formatVerificationFacts } from "./completionDecision"
import {
	createDefaultCangjieCheckDeps,
	runCangjieCheck,
	runCangjieVerification,
	type CangjieCheckDeps,
} from "./CangjieVerificationRunner"
import { canonicalVerificationPath, resolveVerificationProjectRoot } from "./projectRoot"
import type { TaskVerificationRecord, CompletionClaim, VerificationRun } from "./types"
import { evaluateVerification, type CheckState, type VerificationVerdict } from "./verdict"
import {
	loadVerificationRecord,
	updateVerificationRecord,
	withClaim,
	withAcceptance,
	withRun,
} from "./VerificationStore"
import { saveSnapshot } from "./snapshotStore"
import { CangjieChangeMonitor, type ChangeMonitorDeps } from "./CangjieChangeMonitor"
import { buildVerificationSummary } from "./verificationSummary"
import { VerificationFeedbackError, type VerificationApproval, type VerificationFeedback } from "./verificationApproval"
import { captureDeliveryBaseline, buildTaskDelivery } from "./taskDelivery"
import { discoverProjectRoots } from "./projectFingerprint"
import { parseCangjieCommand } from "./cangjieCommand"

const LOG_TAIL_CHARS = 4_000
/** Upper bound on completions blocked by failed system verification, so a task always reaches an end. */
const MAX_SYSTEM_VERIFICATION_BLOCKS = 3
const VERIFICATION_COMMANDS = ["cjpm build", "cjpm test"] as const
const FACTS_HEADER = "System verification (recorded by the extension, not by the model):"

/** The slice of CangjieRuntimePolicy the verification session reads and feeds. */
export interface TaskVerificationPolicy {
	isCheckOnlyRoute(): boolean
	isBuildOnlyRequest(): boolean
	getRouteKind(): CangjieAgentRouteKind | undefined
	getWrittenPaths(): string[]
	isRepairLoopExhausted(): boolean
	noteBuildResult(command: string, succeeded: boolean | "unknown", output: string): void
	noteTestResult(passed: boolean): void
}

export interface TaskVerificationDeps {
	taskDir: () => Promise<string>
	workspaceFolders: () => string[]
	checkDeps: CangjieCheckDeps
	suspendAutoFormat: (root: string) => () => void
	isWorkspaceTrusted: () => boolean
	/** Whether the user's command auto-approval settings would run `command` without asking. */
	canAutoApprove: (command: string) => Promise<boolean>
	watchInputs?: ChangeMonitorDeps["watchInputs"]
	watchEnvironment?: ChangeMonitorDeps["watchEnvironment"]
}

/** Interactive approval for one verification command, using the same approval flow as execute_command. */
export type ApproveCommand = (command: string) => Promise<VerificationApproval>

export type CompletionVerificationOutcome =
	| { action: "allow"; facts: string; summary: VerificationSummary }
	| { action: "block"; reason: string }
	| { action: "skip" }
	| { action: "cancelled" }
	| { action: "feedback"; feedback: VerificationFeedback }

/** A result for the current code that re-running the same commands could not change. */
function hasReusableResult(verdict: VerificationVerdict): boolean {
	if (
		[verdict.build, verdict.test, ...(verdict.relatedTests ?? [])].some(
			(check) => check.state !== "not_run" && check.run.source === "model_command",
		)
	)
		return false
	if (verdict.build.state === "failed") return true
	return verdict.build.state === "passed" && ["passed", "failed", "zero_tests"].includes(verdict.test.state)
}

/**
 * Per-task coordinator for system-run Cangjie verification: optional baseline before edits,
 * approved build/test on completion, claim recording, and the completion decision.
 */
export class CangjieTaskVerification {
	private readonly abortController = new AbortController()
	private baselineController: AbortController | undefined
	private baseline: Promise<void> | undefined
	private releaseAutoFormat: (() => void) | undefined
	private missingTestsRequested = false
	private systemBlocks = 0
	private readonly changeMonitor: CangjieChangeMonitor
	private delivery: Promise<CompletionVerificationOutcome> | undefined
	private preparation: Promise<void> | undefined
	private readonly progressEvents = new EventEmitter()
	private lastProgressKey: string | undefined

	readonly onDidProgress = (listener: (progress: CangjieTaskProgress) => void) => {
		this.progressEvents.on("progress", listener)
		return {
			dispose: () => {
				this.progressEvents.off("progress", listener)
			},
		}
	}

	private progress(update: Omit<CangjieTaskProgress, "at">): void {
		if (this.abortController.signal.aborted && update.status !== "cancelled") return
		const key = `${update.stage}:${update.status}:${update.detail ?? ""}`
		if (key === this.lastProgressKey) return
		this.lastProgressKey = key
		this.progressEvents.emit("progress", { ...update, at: this.deps.checkDeps.now() })
	}

	/** Awaited before the first model request, so the baseline cannot follow a model edit. */
	prepareForTask(): Promise<void> {
		return (this.preparation ??= this.captureInitialInputs().catch((error) => {
			logger.debug("CangjieTaskVerification", "Initial delivery inputs could not be captured", error)
			this.progress({ stage: "project", status: "blocked", detail: getErrorMessage(error) })
		}))
	}

	private async captureInitialInputs(): Promise<void> {
		if (this.abortController.signal.aborted) return
		this.progress({ stage: "project", status: "running" })
		const resolution = await this.resolveRoot()
		if (this.abortController.signal.aborted) return
		if (resolution.kind !== "resolved") {
			this.progress({ stage: "project", status: "blocked", detail: resolution.reason })
			return
		}
		const snapshot = await this.deps.checkDeps.snapshot(resolution.root)
		if (this.abortController.signal.aborted) return
		if (snapshot)
			await captureDeliveryBaseline(
				await this.deps.taskDir(),
				resolution.root,
				snapshot,
				!this.task.policy.isCheckOnlyRoute(),
				this.abortController.signal,
			)
		if (this.abortController.signal.aborted) return
		this.progress({
			stage: "project",
			status: snapshot?.coverage === "complete" ? "completed" : "blocked",
			projectRoot: resolution.root,
			detail: snapshot?.gaps.join("; ") || (!snapshot ? "Project inputs could not be read" : undefined),
		})
		this.progress({ stage: "sdk", status: "running", projectRoot: resolution.root })
		const sdk = await this.deps.checkDeps.sdkInfo()
		const cjpmAvailable = Boolean(this.deps.checkDeps.resolveCjpm())
		this.progress({
			stage: "sdk",
			status: (sdk.version || sdk.image) && cjpmAvailable ? "completed" : "blocked",
			projectRoot: resolution.root,
			sdkVersion: sdk.version,
			detail: !cjpmAvailable
				? (this.deps.checkDeps.unavailableReason?.() ??
					"cjpm executable is unavailable; check CANGJIE_HOME and the configured cjpm path")
				: (sdk.image ??
					(!sdk.version
						? "SDK version could not be detected; check CANGJIE_HOME and the configured compiler path"
						: undefined)),
		})
	}

	noteToolStarted(tool: string): void {
		if (["read_file", "search_files", "list_files", "codebase_search"].includes(tool))
			this.progress({ stage: "read", status: "running" })
		if (["apply_patch", "apply_diff", "write_to_file", "edit", "edit_file", "search_and_replace"].includes(tool))
			this.progress({ stage: "edit", status: "running" })
	}

	constructor(
		private readonly task: { taskId: string; cwd: string; policy: TaskVerificationPolicy },
		private readonly deps: TaskVerificationDeps,
	) {
		this.changeMonitor = new CangjieChangeMonitor(
			{ taskId: task.taskId, writtenPaths: () => task.policy.getWrittenPaths() },
			{
				taskDir: deps.taskDir,
				resolveRoot: () => this.resolveRoot(),
				snapshot: (root) => deps.checkDeps.snapshot(root),
				environment: () => deps.checkDeps.environment(),
				now: () => deps.checkDeps.now(),
				watchInputs: deps.watchInputs,
				watchEnvironment: deps.watchEnvironment,
			},
		)
	}

	get onDidChange() {
		return this.changeMonitor.onDidChange
	}

	configurationIssue(): string | undefined {
		return this.deps.checkDeps.resolveCjpm() ? undefined : this.deps.checkDeps.unavailableReason?.()
	}

	/** Preserve direct model commands on the owning root, including their originating child task. */
	async observeCommand(command: string, cwd: string, sourceTaskId: string) {
		const parsed = parseCangjieCommand(command)
		if (!parsed || parsed.tool !== "cjpm") return
		const kind = parsed.args[0]
		if (kind !== "build" && kind !== "test") return
		const resolution = await this.resolveRoot()
		if (resolution.kind !== "resolved") return
		const before = await this.deps.checkDeps.snapshot(resolution.root)
		const observedEnvironment = await this.deps.checkDeps.environment()
		const filterIndex = parsed.args.indexOf("--filter")
		const filter =
			filterIndex >= 0
				? parsed.args[filterIndex + 1]
				: parsed.args.find((arg) => arg.startsWith("--filter="))?.slice(9)
		const runId = this.deps.checkDeps.newId()
		const startedAt = this.deps.checkDeps.now()
		return async (output: string, exitCode: number | undefined) => {
			const taskDir = await this.deps.taskDir()
			const after = await this.deps.checkDeps.snapshot(resolution.root)
			const logRef = `verification-logs/${runId}.log`
			await fs.mkdir(path.join(taskDir, "verification-logs"), { recursive: true })
			await fs.writeFile(path.join(taskDir, logRef), redactApiSecrets(output), "utf8")
			const run: VerificationRun = {
				runId,
				taskId: sourceTaskId,
				kind,
				source: "model_command",
				command: redactApiSecrets(command),
				executable: redactApiSecrets(parsed.executable),
				args: parsed.args.map((arg) => redactApiSecrets(arg)),
				observedEnvironment,
				...(kind === "test"
					? {
							testScope: {
								description: filter ? `filtered: ${filter}` : "model command; scope not certified",
								filter,
							},
						}
					: {}),
				cwd,
				startedAt,
				endedAt: this.deps.checkDeps.now(),
				status: exitCode === undefined ? "inconclusive" : exitCode === 0 ? "passed" : "failed",
				exitCode: exitCode ?? null,
				logRef,
				inputFingerprint: before?.fingerprint,
				inputFingerprintAfter: after?.fingerprint,
				inputCoverage:
					before?.coverage === "complete" && after?.coverage === "complete" ? "complete" : "partial",
				coverageGaps: [...(before?.gaps ?? []), ...(after?.gaps ?? [])],
				stale: false,
			}
			await updateVerificationRecord(taskDir, this.task.taskId, (record) => withRun(record, run))
		}
	}

	async currentSummary(): Promise<VerificationSummary | undefined> {
		try {
			const taskDir = await this.deps.taskDir()
			const record = await loadVerificationRecord(taskDir, this.task.taskId)
			if ((!record || (!record.runs.length && !record.claims.length)) && !this.preparation) return undefined
			const changed = await this.changeMonitor.recheck("file_change")
			const resolution = await this.resolveRoot()
			const snapshot =
				resolution.kind === "resolved" ? await this.deps.checkDeps.snapshot(resolution.root) : undefined
			const verdict = evaluateVerification(
				await loadVerificationRecord(taskDir, this.task.taskId),
				snapshot?.fingerprint,
				await this.deps.checkDeps.environment(),
				snapshot,
				resolution.kind === "resolved" ? await this.requiredTestRoots(resolution.root, record) : undefined,
			)
			const summary = buildVerificationSummary(
				verdict,
				{
					taskDir,
					changes: changed?.changes,
					note:
						this.configurationIssue() ??
						(resolution.kind === "blocked"
							? resolution.reason
							: !snapshot
								? "Project snapshot is unavailable"
								: verdict.latestClaim?.summary),
				},
				snapshot?.fingerprint,
			)
			if (!summary.delivery && snapshot && resolution.kind === "resolved" && this.preparation) {
				summary.delivery = await buildTaskDelivery(
					taskDir,
					resolution.root,
					snapshot,
					this.task.policy.getWrittenPaths(),
					"interrupted",
					this.deps.checkDeps.now(),
				)
			}
			return summary
		} catch (error) {
			logger.debug("CangjieTaskVerification", "Current verification evidence is unavailable", error)
			return buildVerificationSummary(evaluateVerification(undefined, undefined), {
				taskDir: this.task.cwd,
				note: `System verification unavailable: ${getErrorMessage(error)}`,
			})
		}
	}

	async getOutcome(): Promise<Pick<VerificationSummary, "overall" | "acceptance">> {
		const summary = await this.currentSummary()
		return { overall: summary?.overall ?? "no_record", acceptance: summary?.acceptance ?? "no_delivery" }
	}

	async onCheckpointRestored(): Promise<void> {
		await this.changeMonitor.recheck("checkpoint_restore")
	}

	async onTaskResumed(): Promise<string | undefined> {
		const change = await this.changeMonitor.recheck("task_resume")
		if (!change) return undefined
		this.changeMonitor.start()
		const stale = [change.verdict.build, change.verdict.test].some((check) => check.state === "stale")
		if (!change.codeChanged && !stale) return undefined
		return `仓颉验证输入已变化，请依据当前代码和验证记录继续任务。\n${formatVerificationFacts(change.verdict, undefined, change.changes)}`
	}

	/** Called once the agent route is known: isolate check-only work, or record a baseline for edits. */
	onRouteConfigured(): void {
		if (this.abortController.signal.aborted) return
		this.changeMonitor.start()
		const { policy } = this.task
		if (policy.isCheckOnlyRoute()) {
			this.releaseAutoFormat ??= this.deps.suspendAutoFormat(this.task.cwd)
			return
		}
		this.releaseAutoFormat?.()
		this.releaseAutoFormat = undefined
		const kind = policy.getRouteKind()
		if ((kind === "implement" || kind === "repair") && !this.baseline) {
			// Created synchronously so a preemption that arrives before the baseline starts still stops it.
			const controller = new AbortController()
			this.baselineController = controller
			this.baseline = this.runBaseline(controller).catch((error) => {
				logger.warn("CangjieTaskVerification", "Baseline verification failed to run", error)
			})
		}
	}

	/** Stop an unfinished baseline so it never competes with other cjpm runs for the target directory. */
	async preemptBaseline(): Promise<void> {
		this.baselineController?.abort()
		await this.baseline
	}

	verifyForCompletion(approve: ApproveCommand): Promise<CompletionVerificationOutcome> {
		this.delivery = this.verifyCompletion(approve)
		return this.delivery
	}

	private async verifyCompletion(approve: ApproveCommand): Promise<CompletionVerificationOutcome> {
		const signal = this.abortController.signal
		if (signal.aborted) return { action: "cancelled" }
		try {
			await this.preemptBaseline()
			const outcome = await this.verify(signal, approve)
			return signal.aborted ? { action: "cancelled" } : outcome
		} catch (error) {
			if (signal.aborted) return { action: "cancelled" }
			if (error instanceof VerificationFeedbackError) {
				logger.debug("CangjieTaskVerification", "Verification yielded to user feedback")
				return { action: "feedback", feedback: error.feedback }
			}
			logger.error("CangjieTaskVerification", "System verification could not run", error)
			return {
				action: "allow",
				summary: buildVerificationSummary(evaluateVerification(undefined, undefined), {
					taskDir: this.task.cwd,
					note: getErrorMessage(error),
				}),
				facts:
					`${FACTS_HEADER}\n- System verification could not run: ${getErrorMessage(error)}\n` +
					"- No build or test result is available for the current code.",
			}
		}
	}

	cancel(): void {
		this.baselineController?.abort()
		this.abortController.abort()
	}

	async cancelAndWait(): Promise<void> {
		this.cancel()
		const results = await Promise.allSettled([this.baseline, this.delivery, this.preparation])
		for (const result of results)
			if (result.status === "rejected")
				logger.debug("CangjieTaskVerification", "Verification ended during cancellation", result.reason)
	}

	dispose(): void {
		this.cancel()
		this.changeMonitor.dispose()
		this.progressEvents.removeAllListeners()
		this.releaseAutoFormat?.()
		this.releaseAutoFormat = undefined
	}

	/** Explicit user decisions apply only to the newest delivery of the unchanged code. */
	async recordAcceptance(
		decision: "accepted" | "changes_requested",
		expectedClaimId?: string,
	): Promise<"recorded" | "superseded" | "no_delivery"> {
		const taskDir = await this.deps.taskDir()
		const record = await loadVerificationRecord(taskDir, this.task.taskId)
		const claim = record?.claims.reduce<CompletionClaim | undefined>(
			(latest, next) => (!latest || next.claimedAt >= latest.claimedAt ? next : latest),
			undefined,
		)
		if (!claim) return "no_delivery"
		if (expectedClaimId !== undefined && claim.claimId !== expectedClaimId) return "superseded"
		const root = await this.resolveRoot()
		const snapshot = root.kind === "resolved" ? await this.deps.checkDeps.snapshot(root.root) : undefined
		if (!snapshot || snapshot.fingerprint !== claim.inputFingerprint) return "superseded"
		const verdict = evaluateVerification(
			record,
			snapshot.fingerprint,
			await this.deps.checkDeps.environment(),
			snapshot,
		)
		if ([verdict.build, verdict.test, ...(verdict.relatedTests ?? [])].some((check) => check.state === "stale"))
			return "superseded"
		let outcome: "recorded" | "superseded" = "superseded"
		await updateVerificationRecord(taskDir, this.task.taskId, (current) => {
			const latest = current.claims.reduce<CompletionClaim | undefined>(
				(previous, next) => (!previous || next.claimedAt >= previous.claimedAt ? next : previous),
				undefined,
			)
			if (latest?.claimId !== claim.claimId) return current
			outcome = "recorded"
			return withAcceptance(current, { claimId: claim.claimId, decision, decidedAt: this.deps.checkDeps.now() })
		})
		return outcome
	}

	private async resolveRoot() {
		return resolveVerificationProjectRoot({
			writtenPaths: this.task.policy.getWrittenPaths(),
			cwd: this.task.cwd,
			workspaceFolders: this.deps.workspaceFolders(),
		})
	}

	/** Keep the root suite, plus declared packages touched by this task or its previous delivery. */
	private async requiredTestRoots(root: string, record?: TaskVerificationRecord): Promise<string[]> {
		const owned = await discoverProjectRoots(root)
		const canonicalRoot = await fs.realpath(root)
		const latest = record?.claims.reduce<CompletionClaim | undefined>(
			(previous, next) => (!previous || next.claimedAt >= previous.claimedAt ? next : previous),
			undefined,
		)
		const written = await Promise.all(this.task.policy.getWrittenPaths().map(canonicalVerificationPath))
		const related = [...owned].filter(
			(candidate) =>
				candidate !== canonicalRoot &&
				(latest?.testProjectRoots?.some((scope) => path.relative(scope, candidate) === "") ||
					written.some((file) => {
						const relative = path.relative(candidate, file)
						return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
					})),
		)
		return related.length ? [canonicalRoot, ...related.sort()] : [root]
	}

	/** Baseline never prompts: it runs only when the workspace is trusted and both commands are auto-approved. */
	private async runBaseline(controller: AbortController): Promise<void> {
		await this.prepareForTask()
		if (controller.signal.aborted) return
		if (!this.deps.isWorkspaceTrusted()) return
		for (const command of VERIFICATION_COMMANDS) {
			if (!(await this.deps.canAutoApprove(command))) return
		}
		const resolution = await this.resolveRoot()
		if (resolution.kind !== "resolved" || controller.signal.aborted) return
		await runCangjieVerification(
			{
				taskId: this.task.taskId,
				taskDir: await this.deps.taskDir(),
				projectRoot: resolution.root,
				signal: controller.signal,
				phase: "baseline",
				preempt: () => controller.abort(),
				// Both commands were already confirmed auto-approvable above.
				approve: () => Promise.resolve({ approved: true }),
			},
			this.deps.checkDeps,
			{ skipTests: this.task.policy.isBuildOnlyRequest() },
		)
	}

	private async verify(signal: AbortSignal, approve: ApproveCommand): Promise<CompletionVerificationOutcome> {
		const { policy } = this.task
		if (policy.getRouteKind() === "explore" && policy.getWrittenPaths().length === 0) return { action: "skip" }

		const taskDir = await this.deps.taskDir()
		if (!this.deps.isWorkspaceTrusted()) {
			return this.allowWithNote(taskDir, "Workspace is not trusted; the extension did not run cjpm build or test")
		}
		const resolution = await this.resolveRoot()
		if (resolution.kind === "blocked") {
			const candidates = resolution.candidates.length > 0 ? `: ${resolution.candidates.join(", ")}` : ""
			return this.allowWithNote(taskDir, `${resolution.reason}${candidates}`)
		}

		const existing = await loadVerificationRecord(taskDir, this.task.taskId)
		const testRoots = await this.requiredTestRoots(resolution.root, existing)
		const root = testRoots[0]!
		const changed = await this.changeMonitor.recheck("file_change")
		const skipTests = policy.isBuildOnlyRequest()
		let snapshot = await this.deps.checkDeps.snapshot(root)
		let fingerprint = snapshot?.fingerprint
		if (
			skipTests ||
			!hasReusableResult(
				evaluateVerification(
					existing,
					fingerprint,
					await this.deps.checkDeps.environment(),
					snapshot,
					testRoots,
				),
			)
		) {
			await runCangjieVerification(
				{
					taskId: this.task.taskId,
					taskDir,
					projectRoot: root,
					signal,
					phase: "delivery",
					approve,
					progress: (update) => this.progress(update),
				},
				this.deps.checkDeps,
				{ skipTests },
			)
			if (signal.aborted) return { action: "cancelled" }
			if (!skipTests) {
				const rootVerdict = evaluateVerification(
					await loadVerificationRecord(taskDir, this.task.taskId),
					(await this.deps.checkDeps.snapshot(root))?.fingerprint,
					await this.deps.checkDeps.environment(),
					undefined,
					[root],
				)
				if (rootVerdict.overall === "verified")
					for (const relatedRoot of testRoots.slice(1)) {
						if (signal.aborted) return { action: "cancelled" }
						const result = await runCangjieCheck(
							"test",
							{
								taskId: this.task.taskId,
								taskDir,
								projectRoot: relatedRoot,
								inputRoot: root,
								signal,
								phase: "delivery",
								approve,
								progress: (update) => this.progress(update),
							},
							this.deps.checkDeps,
						)
						if (result.status !== "passed" || !result.testScope?.executed) break
					}
			}
			if (signal.aborted) return { action: "cancelled" }
			snapshot = await this.deps.checkDeps.snapshot(root)
			fingerprint = snapshot?.fingerprint
		}

		const record = await this.recordClaim(taskDir, fingerprint, undefined, root, snapshot, testRoots)
		if (snapshot) await saveSnapshot(taskDir, snapshot, [snapshot.fingerprint])
		const verdict = evaluateVerification(
			record,
			fingerprint,
			await this.deps.checkDeps.environment(),
			snapshot,
			testRoots,
		)
		await this.feedPolicy(verdict, taskDir)
		const note = skipTests ? "Tests were not run because the request only allowed `cjpm build`" : undefined
		return this.decide(verdict, taskDir, note, changed?.changes)
	}

	private async allowWithNote(taskDir: string, note: string): Promise<CompletionVerificationOutcome> {
		const resolution = await this.resolveRoot()
		const snapshot =
			resolution.kind === "resolved" ? await this.deps.checkDeps.snapshot(resolution.root) : undefined
		const record = await this.recordClaim(
			taskDir,
			snapshot?.fingerprint,
			note,
			resolution.kind === "resolved" ? resolution.root : undefined,
			snapshot,
		)
		if (snapshot) await saveSnapshot(taskDir, snapshot, [snapshot.fingerprint])
		const verdict = evaluateVerification(
			record,
			snapshot?.fingerprint,
			await this.deps.checkDeps.environment(),
			snapshot,
		)
		return {
			action: "allow",
			facts: formatVerificationFacts(verdict, note),
			summary: buildVerificationSummary(verdict, { taskDir, note }),
		}
	}

	private async decide(
		verdict: VerificationVerdict,
		taskDir: string,
		note: string | undefined,
		changes?: Parameters<typeof formatVerificationFacts>[2],
	): Promise<CompletionVerificationOutcome> {
		const { policy } = this.task
		const decision = decideCangjieCompletion(verdict, {
			checkOnly: policy.isCheckOnlyRoute(),
			repairExhausted: policy.isRepairLoopExhausted() || this.systemBlocks >= MAX_SYSTEM_VERIFICATION_BLOCKS,
			missingTestsAlreadyRequested: this.missingTestsRequested,
		})
		if (decision.action === "allow") {
			this.progress({ stage: "delivery", status: "completed" })
			return {
				action: "allow",
				facts: formatVerificationFacts(verdict, note, changes),
				summary: buildVerificationSummary(
					verdict,
					{ taskDir, changes, note },
					verdict.latestClaim?.inputFingerprint,
				),
			}
		}

		this.systemBlocks += 1
		if (decision.requestedMissingTests) this.missingTestsRequested = true
		const failing = verdict.build.state === "failed" ? verdict.build : verdict.test
		const tail = await readLogTail(taskDir, failing)
		return { action: "block", reason: tail ? `${decision.reason}\n\nOutput (tail):\n${tail}` : decision.reason }
	}

	/** Keep the existing repair route in sync with system-recorded results. */
	private async feedPolicy(verdict: VerificationVerdict, taskDir: string): Promise<void> {
		const { policy } = this.task
		if (verdict.build.state === "passed") policy.noteBuildResult("cjpm build", true, "")
		if (verdict.build.state === "failed") {
			policy.noteBuildResult("cjpm build", false, (await readLogTail(taskDir, verdict.build)) ?? "")
		}
		if (verdict.test.state === "passed") policy.noteTestResult(true)
		if (verdict.test.state === "failed") policy.noteTestResult(false)
	}

	private async recordClaim(
		taskDir: string,
		fingerprint: string | undefined,
		summary?: string,
		root?: string,
		snapshot?: import("./projectFingerprint").ProjectSnapshot,
		testProjectRoots?: string[],
	): Promise<TaskVerificationRecord> {
		const claimedAt = this.deps.checkDeps.now()
		const claimId = `${this.task.taskId}-claim-${randomUUID()}`
		testProjectRoots ??= root
			? await this.requiredTestRoots(root, await loadVerificationRecord(taskDir, this.task.taskId))
			: undefined
		const delivery =
			root && snapshot
				? await buildTaskDelivery(
						taskDir,
						root,
						snapshot,
						this.task.policy.getWrittenPaths(),
						claimId,
						claimedAt,
					)
				: undefined
		return updateVerificationRecord(taskDir, this.task.taskId, (record) =>
			withClaim(record, {
				testProjectRoots,
				claimId,
				taskId: this.task.taskId,
				claimedAt,
				inputFingerprint: fingerprint,
				summary,
				delivery,
			}),
		)
	}
}

async function readLogTail(taskDir: string, check: CheckState): Promise<string | undefined> {
	if (check.state === "not_run" || !check.run.logRef) return undefined
	try {
		const text = await fs.readFile(path.join(taskDir, check.run.logRef), "utf8")
		return text.length > LOG_TAIL_CHARS ? text.slice(-LOG_TAIL_CHARS) : text
	} catch (error) {
		logger.debug("CangjieTaskVerification", `Cannot read verification log ${check.run.logRef}`, error)
		return undefined
	}
}

/** Wire a verification session to a real task (storage path, workspace trust, approval settings, cjpm). */
export function createCangjieTaskVerification(task: {
	taskId: string
	cwd: string
	globalStoragePath: string
	cangjieRuntimePolicy: TaskVerificationPolicy
	hostRef: WeakRef<{ getState(): Promise<unknown> }>
}): CangjieTaskVerification {
	return new CangjieTaskVerification(
		{ taskId: task.taskId, cwd: task.cwd, policy: task.cangjieRuntimePolicy },
		{
			taskDir: () => getTaskDirectoryPath(task.globalStoragePath, task.taskId),
			workspaceFolders: () => (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
			checkDeps: createDefaultCangjieCheckDeps(),
			watchInputs: (onChange) => {
				const watcher = vscode.workspace.createFileSystemWatcher("**/*")
				const subscriptions = [
					watcher.onDidChange((uri) => onChange(uri.fsPath)),
					watcher.onDidCreate((uri) => onChange(uri.fsPath)),
					watcher.onDidDelete((uri) => onChange(uri.fsPath)),
				]
				return {
					dispose: () => {
						for (const sub of subscriptions) sub.dispose()
						watcher.dispose()
					},
				}
			},
			watchEnvironment: (onChange) =>
				vscode.workspace.onDidChangeConfiguration((event) => {
					if (
						event.affectsConfiguration("njust-ai.cangjieTools") ||
						event.affectsConfiguration("njust-ai.cangjieLsp") ||
						event.affectsConfiguration("njust-ai.sandbox")
					)
						onChange()
				}),
			suspendAutoFormat: suspendCangjieAutoFormat,
			isWorkspaceTrusted: () => vscode.workspace.isTrusted !== false,
			canAutoApprove: async (command) => {
				const state = (await task.hostRef.deref()?.getState()) as Parameters<
					typeof checkAutoApproval
				>[0]["state"]
				const approval = await checkAutoApproval({ state, ask: "command", text: command })
				return approval.decision === "approve"
			},
		},
	)
}
