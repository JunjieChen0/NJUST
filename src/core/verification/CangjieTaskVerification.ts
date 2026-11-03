import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"

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
import type { TaskVerificationRecord } from "./types"
import { evaluateVerification, type CheckState, type VerificationVerdict } from "./verdict"
import { loadVerificationRecord, updateVerificationRecord, withClaim } from "./VerificationStore"

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
}

/** Interactive approval for one verification command, using the same approval flow as execute_command. */
export type ApproveCommand = (command: string) => Promise<boolean>

export type CompletionVerificationOutcome =
	| { action: "allow"; facts: string }
	| { action: "block"; reason: string }
	| { action: "skip" }
	| { action: "cancelled" }

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

	constructor(
		private readonly task: { taskId: string; cwd: string; policy: TaskVerificationPolicy },
		private readonly deps: TaskVerificationDeps,
	) {}

	/** Called once the agent route is known: isolate check-only work, or record a baseline for edits. */
	onRouteConfigured(): void {
		if (this.abortController.signal.aborted) return
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
	preemptBaseline(): void {
		this.baselineController?.abort()
	}

	async verifyForCompletion(approve: ApproveCommand): Promise<CompletionVerificationOutcome> {
		const signal = this.abortController.signal
		if (signal.aborted) return { action: "cancelled" }
		try {
			this.preemptBaseline()
			await this.baseline
			const outcome = await this.verify(signal, approve)
			return signal.aborted ? { action: "cancelled" } : outcome
		} catch (error) {
			if (signal.aborted) return { action: "cancelled" }
			logger.error("CangjieTaskVerification", "System verification could not run", error)
			return {
				action: "allow",
				facts:
					`${FACTS_HEADER}\n- System verification could not run: ${getErrorMessage(error)}\n` +
					"- No build or test result is available for the current code.",
			}
		}
	}

	cancel(): void {
		this.preemptBaseline()
		this.abortController.abort()
	}

	dispose(): void {
		this.cancel()
		this.releaseAutoFormat?.()
		this.releaseAutoFormat = undefined
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
				approve: () => Promise.resolve(true),
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
		const skipTests = policy.isBuildOnlyRequest()
		let fingerprint = await this.deps.checkDeps.fingerprint(root)
		const existing = await loadVerificationRecord(taskDir, this.task.taskId)
		if (skipTests || !hasReusableResult(evaluateVerification(existing, fingerprint))) {
			await runCangjieVerification(
				{ taskId: this.task.taskId, taskDir, projectRoot: root, signal, phase: "delivery", approve },
				this.deps.checkDeps,
				{ skipTests },
			)
			if (signal.aborted) return { action: "cancelled" }
			fingerprint = await this.deps.checkDeps.fingerprint(root)
		}

		const verdict = evaluateVerification(await this.recordClaim(taskDir, fingerprint), fingerprint)
		await this.feedPolicy(verdict, taskDir)
		const note = skipTests ? "Tests were not run because the request only allowed `cjpm build`" : undefined
		return this.decide(verdict, taskDir, note)
	}

	private async allowWithNote(taskDir: string, note: string): Promise<CompletionVerificationOutcome> {
		const record = await this.recordClaim(taskDir, undefined, note)
		return { action: "allow", facts: formatVerificationFacts(evaluateVerification(record, undefined), note) }
	}

	private async decide(
		verdict: VerificationVerdict,
		taskDir: string,
		note: string | undefined,
	): Promise<CompletionVerificationOutcome> {
		const { policy } = this.task
		const decision = decideCangjieCompletion(verdict, {
			checkOnly: policy.isCheckOnlyRoute(),
			repairExhausted: policy.isRepairLoopExhausted() || this.systemBlocks >= MAX_SYSTEM_VERIFICATION_BLOCKS,
			missingTestsAlreadyRequested: this.missingTestsRequested,
		})
		if (decision.action === "allow") return { action: "allow", facts: formatVerificationFacts(verdict, note) }

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
