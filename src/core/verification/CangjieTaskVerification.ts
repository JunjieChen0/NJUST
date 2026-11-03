import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import type { VerificationSummary } from "@njust-ai/types"

import { logger } from "../../shared/logger"
import { getErrorMessage } from "../../shared/error-utils"
import { getTaskDirectoryPath } from "../../utils/storage"
import { suspendCangjieAutoFormat } from "../../services/cangjie-lsp/autoFormatSuspension"
import { checkAutoApproval } from "../auto-approval"
import type { CangjieAgentRouteKind } from "../agent/CangjieAgentRouter"

import { decideCangjieCompletion, formatVerificationFacts } from "./completionDecision"
import {
	createDefaultCangjieCheckDeps,
	runCangjieVerification,
	type CangjieCheckDeps,
} from "./CangjieVerificationRunner"
import { resolveVerificationProjectRoot } from "./projectRoot"
import type { TaskVerificationRecord, CompletionClaim } from "./types"
import { evaluateVerification, type CheckState, type VerificationVerdict } from "./verdict"
import { loadVerificationRecord, updateVerificationRecord, withClaim, withAcceptance } from "./VerificationStore"
import { saveSnapshot } from "./snapshotStore"
import { CangjieChangeMonitor, type ChangeMonitorDeps } from "./CangjieChangeMonitor"
import { buildVerificationSummary } from "./verificationSummary"
import { VerificationFeedbackError, type VerificationApproval, type VerificationFeedback } from "./verificationApproval"

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

	async currentSummary(): Promise<VerificationSummary | undefined> {
		try {
			const taskDir = await this.deps.taskDir()
			const record = await loadVerificationRecord(taskDir, this.task.taskId)
			if (!record || (!record.runs.length && !record.claims.length)) return undefined
			const changed = await this.changeMonitor.recheck("file_change")
			const resolution = await this.resolveRoot()
			const snapshot =
				resolution.kind === "resolved" ? await this.deps.checkDeps.snapshot(resolution.root) : undefined
			const verdict = evaluateVerification(
				await loadVerificationRecord(taskDir, this.task.taskId),
				snapshot?.fingerprint,
				await this.deps.checkDeps.environment(),
			)
			return buildVerificationSummary(verdict, {
				taskDir,
				changes: changed?.changes,
				note: resolution.kind === "blocked" ? resolution.reason : verdict.latestClaim?.summary,
			})
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
		const results = await Promise.allSettled([this.baseline, this.delivery])
		for (const result of results)
			if (result.status === "rejected")
				logger.debug("CangjieTaskVerification", "Verification ended during cancellation", result.reason)
	}

	dispose(): void {
		this.cancel()
		this.changeMonitor.dispose()
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

	/** Baseline never prompts: it runs only when the workspace is trusted and both commands are auto-approved. */
	private async runBaseline(controller: AbortController): Promise<void> {
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

		const root = resolution.root
		const changed = await this.changeMonitor.recheck("file_change")
		const skipTests = policy.isBuildOnlyRequest()
		let snapshot = await this.deps.checkDeps.snapshot(root)
		let fingerprint = snapshot?.fingerprint
		const existing = await loadVerificationRecord(taskDir, this.task.taskId)
		if (
			skipTests ||
			!hasReusableResult(evaluateVerification(existing, fingerprint, await this.deps.checkDeps.environment()))
		) {
			await runCangjieVerification(
				{ taskId: this.task.taskId, taskDir, projectRoot: root, signal, phase: "delivery", approve },
				this.deps.checkDeps,
				{ skipTests },
			)
			if (signal.aborted) return { action: "cancelled" }
			snapshot = await this.deps.checkDeps.snapshot(root)
			fingerprint = snapshot?.fingerprint
		}

		const record = await this.recordClaim(taskDir, fingerprint)
		if (snapshot) await saveSnapshot(taskDir, snapshot, [snapshot.fingerprint])
		const verdict = evaluateVerification(record, fingerprint, await this.deps.checkDeps.environment())
		await this.feedPolicy(verdict, taskDir)
		const note = skipTests ? "Tests were not run because the request only allowed `cjpm build`" : undefined
		return this.decide(verdict, taskDir, note, changed?.changes)
	}

	private async allowWithNote(taskDir: string, note: string): Promise<CompletionVerificationOutcome> {
		const resolution = await this.resolveRoot()
		const snapshot =
			resolution.kind === "resolved" ? await this.deps.checkDeps.snapshot(resolution.root) : undefined
		const record = await this.recordClaim(taskDir, snapshot?.fingerprint, note)
		if (snapshot) await saveSnapshot(taskDir, snapshot, [snapshot.fingerprint])
		const verdict = evaluateVerification(record, snapshot?.fingerprint, await this.deps.checkDeps.environment())
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
		if (decision.action === "allow")
			return {
				action: "allow",
				facts: formatVerificationFacts(verdict, note, changes),
				summary: buildVerificationSummary(verdict, { taskDir, changes, note }),
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

	private recordClaim(
		taskDir: string,
		fingerprint: string | undefined,
		summary?: string,
	): Promise<TaskVerificationRecord> {
		const claimedAt = this.deps.checkDeps.now()
		return updateVerificationRecord(taskDir, this.task.taskId, (record) =>
			withClaim(record, {
				claimId: `${this.task.taskId}-claim-${record.claims.length + 1}`,
				taskId: this.task.taskId,
				claimedAt,
				inputFingerprint: fingerprint,
				summary,
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
				const watcher = vscode.workspace.createFileSystemWatcher("**/{*.cj,cjpm.toml,cjpm.lock}")
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
						event.affectsConfiguration("njust-ai.cangjieLsp")
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
