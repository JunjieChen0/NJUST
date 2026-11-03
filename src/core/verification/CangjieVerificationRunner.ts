import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import { execa } from "execa"

import { logger } from "../../shared/logger"
import {
	buildCangjieToolEnv,
	detectCangjieHome,
	resolveCangjieToolPath,
	CJC_CONFIG_KEY,
} from "../../services/cangjie-lsp/cangjieToolUtils"

import { CjpmLockUnavailableError, withCjpmProjectLock } from "../../services/cangjie-lsp/cjpmProjectLock"

import { buildCangjieTestScope, parseCangjieTestSummary, readCangjieTestReportDir } from "./cangjieTestReport"
import { computeProjectSnapshot, type ProjectSnapshot } from "./projectFingerprint"
import { saveSnapshot } from "./snapshotStore"
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
}

export type ProcessExecutor = (
	file: string,
	args: string[],
	options: { cwd: string; env: Record<string, string>; signal: AbortSignal; timeoutMs: number },
) => Promise<ProcessResult>

export interface CangjieCheckContext {
	taskId: string
	/** Task storage directory: records, logs and test reports live here, never in the project. */
	taskDir: string
	projectRoot: string
	signal: AbortSignal
	phase: "baseline" | "delivery"
	/** Set for background work that must yield the project's cjpm lock to anyone else who needs it. */
	preempt?: () => void
	/**
	 * Approval gate, called with the plain command (e.g. "cjpm build") right before it runs.
	 * The caller routes it through the same command approval/auto-approval as execute_command.
	 */
	approve: (command: string) => Promise<boolean>
}

export interface CangjieCheckDeps {
	exec: ProcessExecutor
	resolveCjpm: () => string | undefined
	buildEnv: () => Record<string, string>
	sdkInfo: () => Promise<{ home?: string; version?: string }>
	snapshot: (projectRoot: string) => Promise<ProjectSnapshot | undefined>
	environment: () => Promise<VerificationEnvironment>
	now: () => number
	newId: () => string
	timeoutMs: number
}

type RunOutcome = Pick<VerificationRun, "status" | "exitCode" | "abortReason" | "abortDetail">

function classifyProcessResult(result: ProcessResult): RunOutcome {
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
	const reportDir = path.join(ctx.taskDir, REPORT_DIR, runId)
	const executable = deps.resolveCjpm()
	const before = await deps.snapshot(ctx.projectRoot)
	if (before) await saveSnapshot(ctx.taskDir, before)
	const base: VerificationRun = {
		runId,
		taskId: ctx.taskId,
		kind,
		phase: ctx.phase,
		executable: executable ?? "cjpm",
		args: argsFor(kind, reportDir),
		cwd: ctx.projectRoot,
		startedAt: deps.now(),
		status: "running",
		sdk: await deps.sdkInfo(),
		inputFingerprint: before?.fingerprint,
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
		return blocked
	}
	if (!executable) return block("spawn_failed", "cjpm executable could not be resolved")
	if (!(await ctx.approve(displayCommand(kind)))) {
		return block(
			"not_approved",
			`\`${displayCommand(kind)}\` was not approved by the user or auto-approval settings`,
		)
	}

	await persist(ctx, base)
	let result: ProcessResult
	try {
		result = await withCjpmProjectLock(
			ctx.projectRoot,
			() =>
				deps.exec(executable, base.args, {
					cwd: ctx.projectRoot,
					env: deps.buildEnv(),
					signal: ctx.signal,
					timeoutMs: deps.timeoutMs,
				}),
			{ preempt: ctx.preempt, signal: ctx.signal, timeoutMs: LOCK_WAIT_TIMEOUT_MS },
		)
	} catch (error) {
		logger.debug("CangjieVerificationRunner", "Verification could not acquire the project lock", error)
		if (!(error instanceof CjpmLockUnavailableError)) throw error
		if (error.reason === "timeout") {
			return block("project_busy", "Another cjpm process is still running in this project")
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
	}

	const after = await deps.snapshot(ctx.projectRoot)
	if (after) await saveSnapshot(ctx.taskDir, after)
	const finished: VerificationRun = {
		...base,
		...outcome,
		testScope,
		endedAt: deps.now(),
		logRef: await writeLog(ctx.taskDir, runId, result.output),
		inputFingerprintAfter: after?.fingerprint,
	}
	await persist(ctx, finished)
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

async function killProcessTree(pid: number | undefined): Promise<void> {
	if (pid === undefined) return
	try {
		if (process.platform === "win32") {
			await execa("taskkill", ["/pid", String(pid), "/T", "/F"], { reject: false, windowsHide: true })
		} else {
			process.kill(-pid, "SIGKILL")
		}
	} catch (error) {
		logger.debug("CangjieVerificationRunner", `Failed to kill process tree ${pid}`, error)
	}
}

/** Spawn without a shell; on cancel/timeout kill the whole tree so cjc/test runners do not linger. */
export const execaProcessExecutor: ProcessExecutor = async (file, args, { cwd, env, signal, timeoutMs }) => {
	let timedOut = false
	let cancelled = signal.aborted
	const subprocess = execa(file, args, {
		cwd,
		env,
		extendEnv: false,
		all: true,
		reject: false,
		stdin: "ignore",
		windowsHide: true,
		detached: process.platform !== "win32",
	})
	// Awaited before returning so a "cancelled" result means the whole tree is really gone.
	let killing: Promise<void> | undefined
	const stop = () => {
		killing ??= killProcessTree(subprocess.pid)
	}
	const onAbort = () => {
		cancelled = true
		stop()
	}
	signal.addEventListener("abort", onAbort, { once: true })
	if (cancelled) stop()
	const timer = setTimeout(() => {
		timedOut = true
		stop()
	}, timeoutMs)

	try {
		const result = await subprocess
		// POSIX: the child led its own process group; reap any grandchildren it left behind.
		if (process.platform !== "win32" && !cancelled && !timedOut) stop()
		const spawnFailed = result.failed && result.exitCode === undefined && !result.signal && !cancelled && !timedOut
		return {
			exitCode: cancelled || timedOut ? null : (result.exitCode ?? null),
			output: typeof result.all === "string" ? result.all : "",
			timedOut,
			cancelled,
			signal: result.signal ?? undefined,
			spawnError: spawnFailed ? result.shortMessage : undefined,
		}
	} finally {
		clearTimeout(timer)
		signal.removeEventListener("abort", onAbort)
		await killing
	}
}

let cachedSdkVersion: Promise<string | undefined> | undefined

export function resetSdkInfoCache(): void {
	cachedSdkVersion = undefined
}

async function readSdkVersion(): Promise<string | undefined> {
	const cjc = resolveCangjieToolPath("cjc", CJC_CONFIG_KEY)
	if (!cjc) return undefined
	const result = await execa(cjc, ["--version"], { reject: false, timeout: 15_000, windowsHide: true })
	return result.exitCode === 0 ? String(result.stdout).split(/\r?\n/)[0]?.trim() || undefined : undefined
}

export function createDefaultCangjieCheckDeps(): CangjieCheckDeps {
	const resolveCjpm = () => resolveCangjieToolPath("cjpm", "cangjieTools.cjpmPath")
	const sdkInfo = async () => {
		cachedSdkVersion ??= readSdkVersion().catch((error) => {
			logger.debug("CangjieVerificationRunner", "Cannot read Cangjie SDK version", error)
			return undefined
		})
		return { home: detectCangjieHome(), version: await cachedSdkVersion }
	}
	return {
		exec: execaProcessExecutor,
		resolveCjpm,
		buildEnv: () => buildCangjieToolEnv(),
		sdkInfo,
		environment: async () => {
			const sdk = await sdkInfo()
			return { sdkHome: sdk.home, sdkVersion: sdk.version, cjpmPath: resolveCjpm() }
		},
		snapshot: computeProjectSnapshot,
		now: Date.now,
		newId: () => crypto.randomUUID(),
		timeoutMs: DEFAULT_CHECK_TIMEOUT_MS,
	}
}
