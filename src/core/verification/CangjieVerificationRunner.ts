import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import type { CangjieTaskProgress } from "@njust-ai/types"
import { Package } from "../../shared/package"

import { logger } from "../../shared/logger"
import { detectCangjieHome, resolveCangjieToolPath, CJC_CONFIG_KEY } from "../../services/cangjie-lsp/cangjieToolUtils"

import { CjpmLockUnavailableError, withCjpmProjectLock } from "../../services/cangjie-lsp/cjpmProjectLock"

import { buildCangjieTestScope, parseCangjieTestSummary, readCangjieTestReportDir } from "./cangjieTestReport"
import { computeProjectSnapshot, type ProjectSnapshot } from "./projectFingerprint"
import { saveSnapshot } from "./snapshotStore"
import { VerificationFeedbackError, type VerificationApproval } from "./verificationApproval"
import { createSandboxProcessExecutor, buildVerificationSdkEnv } from "./sandboxProcessExecutor"
import { SandboxExecutionService } from "../../services/sandbox/SandboxExecutionService"
import { readSandboxSettings } from "../../services/sandbox/SandboxConfig"
import type { VerificationKind, VerificationRun, VerificationEnvironment } from "./types"
import { updateVerificationRecord, withRun } from "./VerificationStore"

export const DEFAULT_CHECK_TIMEOUT_MS = 10 * 60_000
export const LOCK_WAIT_TIMEOUT_MS = 60_000
const LOG_DIR = "verification-logs"
const REPORT_DIR = "verification-reports"
const WHOLE_PROJECT_SCOPE = "whole project"

/** Outcome of one child process. `exitCode` is null when the process did not report one. */
export interface ProcessResult {
	exitCode: number | null
	output: string
	timedOut: boolean
	cancelled: boolean
	signal?: string
	spawnError?: string
	sandboxDenied?: string
	backend?: "guarded-host" | "docker"
	imageDigest?: string
}

export type ProcessExecutor = (
	file: string,
	args: string[],
	options: {
		cwd: string
		workspacePath?: string
		env: Record<string, string>
		signal: AbortSignal
		timeoutMs: number
		taskId?: string
		executionId?: string
	},
) => Promise<ProcessResult>

export interface CangjieCheckContext {
	taskId: string
	/** Task storage directory: records, logs and test reports live here, never in the project. */
	taskDir: string
	projectRoot: string
	/** Related packages run in their own cwd, against the owning project's full input state. */
	inputRoot?: string
	signal: AbortSignal
	phase: "baseline" | "delivery"
	/** Set for background work that must yield the project's cjpm lock to anyone else who needs it. */
	preempt?: () => void
	/**
	 * Approval gate, called with the plain command (e.g. "cjpm build") right before it runs.
	 * The caller routes it through the same command approval/auto-approval as execute_command.
	 */
	approve: (command: string) => Promise<VerificationApproval>
	progress?: (update: Omit<CangjieTaskProgress, "at">) => void
}

export interface CangjieCheckDeps {
	exec: ProcessExecutor
	resolveCjpm: () => string | undefined
	unavailableReason?: () => string
	buildEnv: () => Record<string, string>
	sdkInfo: () => Promise<NonNullable<VerificationRun["sdk"]>>
	snapshot: (projectRoot: string) => Promise<ProjectSnapshot | undefined>
	environment: () => Promise<VerificationEnvironment>
	now: () => number
	newId: () => string
	timeoutMs: number
}

type RunOutcome = Pick<VerificationRun, "status" | "exitCode" | "abortReason" | "abortDetail">

function classifyProcessResult(result: ProcessResult): RunOutcome {
	if (result.sandboxDenied)
		return { status: "blocked", abortReason: "sandbox_denied", abortDetail: result.sandboxDenied }
	if (result.spawnError) return { status: "blocked", abortReason: "spawn_failed", abortDetail: result.spawnError }
	if (result.cancelled) return { status: "cancelled", abortReason: "cancelled" }
	if (result.timedOut) return { status: "inconclusive", abortReason: "timeout" }
	if (result.exitCode === null) {
		return result.signal
			? { status: "inconclusive", abortReason: "signal", abortDetail: result.signal }
			: { status: "inconclusive", exitCode: null, abortReason: "exit_code_unknown" }
	}
	return { status: result.exitCode === 0 ? "passed" : "failed", exitCode: result.exitCode }
}

/** Older cjpm releases reject the report/progress flags; that is not a test failure. */
const UNSUPPORTED_OPTION_RE = /unknown option|unrecognized option|invalid option|unsupported test report format/i

function classifyTestOutcome(outcome: RunOutcome, result: ProcessResult, failedTests: number): RunOutcome {
	if (outcome.status === "passed" && failedTests > 0) return { ...outcome, status: "failed" }
	if (outcome.status === "failed" && failedTests === 0 && UNSUPPORTED_OPTION_RE.test(result.output)) {
		return { ...outcome, status: "inconclusive", abortReason: "unsupported_options" }
	}
	return outcome
}

function displayCommand(kind: VerificationKind): string {
	return kind === "build" ? "cjpm build" : "cjpm test"
}

function argsFor(kind: VerificationKind, reportDir: string): string[] {
	if (kind === "build") return ["build"]
	return ["test", "--report-path", reportDir, "--report-format", "xml", "--no-progress", "--no-color"]
}

async function writeLog(taskDir: string, runId: string, output: string): Promise<string> {
	const logRef = `${LOG_DIR}/${runId}.log`
	await fs.mkdir(path.join(taskDir, LOG_DIR), { recursive: true })
	await fs.writeFile(path.join(taskDir, logRef), output, "utf8")
	return logRef
}

async function persist(ctx: CangjieCheckContext, run: VerificationRun): Promise<void> {
	await updateVerificationRecord(ctx.taskDir, ctx.taskId, (record) => withRun(record, run))
}

/**
 * Run one tracked `cjpm build` or `cjpm test` and persist the facts (running → final).
 * Never throws for process-level problems: they are recorded as blocked/cancelled/inconclusive.
 */
export async function runCangjieCheck(
	kind: VerificationKind,
	ctx: CangjieCheckContext,
	deps: CangjieCheckDeps,
): Promise<VerificationRun> {
	const runId = deps.newId()
	const reportDir = path.join(ctx.projectRoot, "target", ".njust-verification", runId)
	const executable = deps.resolveCjpm()
	const before = await deps.snapshot(ctx.inputRoot ?? ctx.projectRoot)
	if (before) await saveSnapshot(ctx.taskDir, before)
	const base: VerificationRun = {
		runId,
		taskId: ctx.taskId,
		kind,
		source: "system_verification",
		phase: ctx.phase,
		executable: executable ?? "cjpm",
		args: argsFor(kind, path.relative(ctx.projectRoot, reportDir).split(path.sep).join("/")),
		cwd: ctx.projectRoot,
		startedAt: deps.now(),
		status: "running",
		sdk: ctx.signal.aborted ? undefined : await deps.sdkInfo(),
		inputFingerprint: before?.fingerprint,
		inputCoverage: before?.coverage ?? "partial",
		coverageGaps: before?.gaps ?? ["Project inputs could not be fingerprinted"],
		stale: false,
		...(kind === "test" ? { testScope: { description: WHOLE_PROJECT_SCOPE } } : {}),
	}

	const block = async (abortReason: VerificationRun["abortReason"], abortDetail: string) => {
		// Nothing ran, so the inputs it would have checked are unchanged.
		const blocked: VerificationRun = {
			...base,
			endedAt: deps.now(),
			status: "blocked",
			abortReason,
			abortDetail,
			inputFingerprintAfter: base.inputFingerprint,
		}
		await persist(ctx, blocked)
		ctx.progress?.({ stage: kind, status: "blocked", projectRoot: ctx.projectRoot, detail: abortDetail })
		return blocked
	}
	const cancelledBeforeStart = async () => {
		const run: VerificationRun = {
			...base,
			endedAt: deps.now(),
			status: "cancelled",
			abortReason: "cancelled",
			inputFingerprintAfter: base.inputFingerprint,
		}
		await persist(ctx, run)
		ctx.progress?.({ stage: kind, status: "cancelled", projectRoot: ctx.projectRoot })
		return run
	}
	if (ctx.signal.aborted) return cancelledBeforeStart()
	if (!executable)
		return block(
			"spawn_failed",
			deps.unavailableReason?.() ??
				"cjpm executable could not be resolved; configure CANGJIE_HOME or the cjpm path",
		)
	const missingDependency = before?.gaps.filter((gap) => gap.startsWith("Cannot read member/dependency:"))
	if (missingDependency?.length)
		return block(
			"dependency_unavailable",
			`Local dependency is unavailable: ${missingDependency.join("; ")}. Restore the dependency directory or correct its path in cjpm.toml.`,
		)
	ctx.progress?.({ stage: kind, status: "waiting", projectRoot: ctx.projectRoot })
	if (ctx.signal.aborted) return cancelledBeforeStart()
	let onAbort!: () => void
	const cancelledApproval = new Promise<VerificationApproval>((resolve) => {
		onAbort = () => resolve({ approved: false })
		ctx.signal.addEventListener("abort", onAbort, { once: true })
	})
	let approval: VerificationApproval
	try {
		approval = await Promise.race([ctx.approve(displayCommand(kind)), cancelledApproval])
	} finally {
		ctx.signal.removeEventListener("abort", onAbort)
	}
	if (ctx.signal.aborted) return cancelledBeforeStart()
	if (approval.feedback) throw new VerificationFeedbackError(approval.feedback)
	if (!approval.approved) {
		return block(
			"not_approved",
			`\`${displayCommand(kind)}\` was not approved by the user or auto-approval settings`,
		)
	}

	await persist(ctx, base)
	if (kind === "test") await fs.mkdir(reportDir, { recursive: true })
	let result: ProcessResult
	try {
		result = await withCjpmProjectLock(
			ctx.inputRoot ?? ctx.projectRoot,
			() => {
				ctx.progress?.({ stage: kind, status: "running", projectRoot: ctx.projectRoot })
				return deps.exec(executable, base.args, {
					cwd: ctx.projectRoot,
					...(ctx.inputRoot ? { workspacePath: ctx.inputRoot } : {}),
					env: deps.buildEnv(),
					signal: ctx.signal,
					timeoutMs: deps.timeoutMs,
					taskId: ctx.taskId,
					executionId: runId,
				})
			},
			{
				preempt: ctx.preempt,
				signal: ctx.signal,
				timeoutMs: LOCK_WAIT_TIMEOUT_MS,
				holder: { command: displayCommand(kind), taskId: ctx.taskId },
			},
		)
	} catch (error) {
		logger.debug("CangjieVerificationRunner", "Verification could not acquire the project lock", error)
		if (!(error instanceof CjpmLockUnavailableError)) throw error
		if (error.reason === "timeout") {
			const holder = error.holder
			const detail = holder
				? `Another cjpm process is still running in this project: ${holder.command} (task ${holder.taskId ?? "unknown"}, running ${Math.max(0, Math.floor((Date.now() - holder.startedAt) / 1000))}s)`
				: "Another cjpm process is still running in this project"
			return block("project_busy", detail)
		}
		const cancelled: VerificationRun = {
			...base,
			endedAt: deps.now(),
			status: "cancelled",
			abortReason: "cancelled",
			inputFingerprintAfter: base.inputFingerprint,
		}
		await persist(ctx, cancelled)
		return cancelled
	}

	let outcome = classifyProcessResult(result)
	let testScope = base.testScope
	if (kind === "test") {
		const report = await readCangjieTestReportDir(reportDir).catch((error) => {
			logger.warn("CangjieVerificationRunner", `Cannot read test report ${reportDir}`, error)
			return undefined
		})
		testScope = buildCangjieTestScope(WHOLE_PROJECT_SCOPE, report, parseCangjieTestSummary(result.output))
		outcome = classifyTestOutcome(outcome, result, testScope.failed ?? 0)
		await fs
			.cp(reportDir, path.join(ctx.taskDir, REPORT_DIR, runId), { recursive: true })
			.catch((error) => logger.debug("CangjieVerificationRunner", "Cannot archive test reports", error))
	}

	const after = await deps.snapshot(ctx.inputRoot ?? ctx.projectRoot)
	if (after) await saveSnapshot(ctx.taskDir, after)
	const finished: VerificationRun = {
		...base,
		...outcome,
		testScope,
		endedAt: deps.now(),
		logRef: await writeLog(ctx.taskDir, runId, result.output),
		inputFingerprintAfter: after?.fingerprint,
		reportRef: kind === "test" ? `${REPORT_DIR}/${runId}` : undefined,
		sdk: {
			...base.sdk,
			...(result.backend ? { backend: result.backend } : {}),
			...(result.imageDigest ? { imageDigest: result.imageDigest } : {}),
		},
		inputCoverage: before?.coverage === "complete" && after?.coverage === "complete" ? "complete" : "partial",
		coverageGaps: [
			...new Set([
				...(base.coverageGaps ?? []),
				...(after?.gaps ?? ["Final project inputs could not be fingerprinted"]),
			]),
		],
	}
	await persist(ctx, finished)
	ctx.progress?.({
		stage: kind,
		status: finished.status === "passed" ? "completed" : finished.status === "cancelled" ? "cancelled" : "blocked",
		projectRoot: ctx.projectRoot,
		detail: finished.abortDetail,
	})
	return finished
}

/**
 * Build, then run tests only when the build passed, the run was not cancelled, and tests
 * were not excluded (e.g. the user only allowed `cjpm build`).
 */
export async function runCangjieVerification(
	ctx: CangjieCheckContext,
	deps: CangjieCheckDeps,
	options: { skipTests?: boolean } = {},
): Promise<{ build: VerificationRun; test?: VerificationRun }> {
	const build = await runCangjieCheck("build", ctx, deps)
	if (build.status !== "passed" || ctx.signal.aborted || options.skipTests) return { build }
	return { build, test: await runCangjieCheck("test", ctx, deps) }
}

// ── Default (real process) dependencies ─────────────────────────────────────

let cachedSdkVersion: Promise<string | undefined> | undefined

export function resetSdkInfoCache(): void {
	cachedSdkVersion = undefined
}

async function readSdkVersion(): Promise<string | undefined> {
	const cjc = resolveCangjieToolPath("cjc", CJC_CONFIG_KEY)
	if (!cjc) return undefined
	const result = await createSandboxProcessExecutor()(cjc, ["--version"], {
		cwd: detectCangjieHome() ?? process.cwd(),
		env: buildVerificationSdkEnv(),
		timeoutMs: 15_000,
		signal: new AbortController().signal,
	})
	return result.exitCode === 0 ? String(result.output).split(/\r?\n/)[0]?.trim() || undefined : undefined
}

export function createDefaultCangjieCheckDeps(): CangjieCheckDeps {
	const resolveCjpm = () =>
		SandboxExecutionService.getInstance().getConfiguredBackend() === "docker"
			? "cjpm"
			: resolveCangjieToolPath("cjpm", "cangjieTools.cjpmPath")
	const sdkInfo: CangjieCheckDeps["sdkInfo"] = async () => {
		const service = SandboxExecutionService.getInstance()
		if (service.getConfiguredBackend() === "docker") {
			const image = readSandboxSettings().dockerImage
			return { backend: "docker", image, imageDigest: await service.getDockerRunner()?.getImageDigest(image) }
		}
		cachedSdkVersion ??= readSdkVersion().catch((error) => {
			logger.debug("CangjieVerificationRunner", "Cannot read Cangjie SDK version", error)
			return undefined
		})
		return { home: detectCangjieHome(), version: await cachedSdkVersion, backend: "guarded-host" }
	}
	return {
		exec: createSandboxProcessExecutor(),
		resolveCjpm,
		unavailableReason: () => {
			const config = vscode.workspace.getConfiguration(Package.name)
			const configured = config.get<string>("cangjieTools.cjpmPath")
			const setting = config.inspect?.("cangjieTools.cjpmPath")
			const scope =
				setting?.workspaceFolderValue !== undefined
					? "workspace folder"
					: setting?.workspaceValue !== undefined
						? "workspace"
						: setting?.globalValue !== undefined
							? "user"
							: "effective setting"
			return configured
				? `Invalid explicit cjpm path: ${configured}. Source: njust-ai.cangjieTools.cjpmPath (${scope}); the configured executable is missing. ` +
						"System verification is blocked and does not fall back to PATH. An SDK on PATH may still work independently. Correct or clear this setting, then retry verification."
				: "Cangjie SDK is unavailable. Configure CANGJIE_HOME or njust-ai.cangjieTools.cjpmPath, then retry verification."
		},
		buildEnv: buildVerificationSdkEnv,
		sdkInfo,
		environment: async () => {
			const sdk = await sdkInfo()
			return {
				sdkHome: sdk.home,
				sdkVersion: sdk.version,
				cjpmPath: resolveCjpm(),
				backend: sdk.backend,
				image: sdk.image,
				imageDigest: sdk.imageDigest,
			}
		},
		snapshot: computeProjectSnapshot,
		now: Date.now,
		newId: () => crypto.randomUUID(),
		timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
	}
}
