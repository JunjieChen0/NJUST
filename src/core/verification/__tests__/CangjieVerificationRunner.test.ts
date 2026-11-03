import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import {
	runCangjieCheck,
	runCangjieVerification,
	LOCK_WAIT_TIMEOUT_MS,
	type CangjieCheckContext,
	type CangjieCheckDeps,
	type ProcessResult,
} from "../CangjieVerificationRunner"
import { loadVerificationRecord } from "../VerificationStore"
import { loadSnapshot } from "../snapshotStore"
import { acquireCjpmProjectLock } from "../../../services/cangjie-lsp/cjpmProjectLock"

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (filePath: string, data: unknown) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data), "utf8")
	}),
}))

const PASSING_TEST_OUTPUT = `Summary: TOTAL: 3
    PASSED: 3, SKIPPED: 0, ERROR: 0
    FAILED: 0
cjpm test success`

function processResult(overrides: Partial<ProcessResult> = {}): ProcessResult {
	return { exitCode: 0, output: "cjpm build success", timedOut: false, cancelled: false, ...overrides }
}

describe("CangjieVerificationRunner", () => {
	let taskDir: string
	let ctx: CangjieCheckContext
	let ids: number

	function deps(exec: CangjieCheckDeps["exec"], overrides: Partial<CangjieCheckDeps> = {}): CangjieCheckDeps {
		return {
			exec,
			resolveCjpm: () => "/sdk/tools/bin/cjpm",
			buildEnv: () => ({ PATH: "/sdk/bin" }),
			sdkInfo: async () => ({ home: "/sdk", version: "1.0.5" }),
			snapshot: async () => ({ fingerprint: "fp-1", files: {} }),
			environment: async () => ({ sdkHome: "/sdk", sdkVersion: "1.0.5", cjpmPath: "/sdk/tools/bin/cjpm" }),
			now: () => 1_000,
			newId: () => `run-${++ids}`,
			timeoutMs: 60_000,
			...overrides,
		}
	}

	beforeEach(async () => {
		ids = 0
		taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "cj-runner-"))
		ctx = {
			taskId: "task-1",
			taskDir,
			projectRoot: "/ws/app",
			signal: new AbortController().signal,
			phase: "delivery",
			approve: async () => true,
		}
	})

	it("asks for approval with the plain command and records a refusal as blocked without running", async () => {
		const exec = vi.fn()
		const approve = vi.fn(async () => false)

		const run = await runCangjieCheck("build", { ...ctx, approve }, deps(exec))

		expect(approve).toHaveBeenCalledWith("cjpm build")
		expect(exec).not.toHaveBeenCalled()
		expect(run).toMatchObject({ status: "blocked", abortReason: "not_approved" })
	})

	it.each(["timeout", "aborted"] as const)(
		"records verification that never started after lock wait %s",
		async (reason) => {
			vi.useFakeTimers()
			const release = await acquireCjpmProjectLock(ctx.projectRoot)
			const controller = new AbortController()
			const exec = vi.fn(async () => processResult())
			const checking = runCangjieCheck("build", { ...ctx, signal: controller.signal }, deps(exec))
			try {
				await vi.waitFor(() => expect(vi.getTimerCount()).toBeGreaterThan(0))
				if (reason === "aborted") controller.abort()
				else await vi.advanceTimersByTimeAsync(LOCK_WAIT_TIMEOUT_MS)
				const run = await checking
				expect(run).toMatchObject({
					status: reason === "timeout" ? "blocked" : "cancelled",
					abortReason: reason === "timeout" ? "project_busy" : "cancelled",
					inputFingerprint: "fp-1",
					inputFingerprintAfter: "fp-1",
				})
				if (reason === "timeout")
					expect(run.abortDetail).toBe("Another cjpm process is still running in this project")
				expect(run.exitCode).toBeUndefined()
				expect(exec).not.toHaveBeenCalled()
				expect((await loadVerificationRecord(taskDir, "task-1"))?.runs).toEqual([run])
			} finally {
				controller.abort()
				release()
				await checking
				vi.useRealTimers()
			}
		},
	)

	it("treats flags rejected by an older cjpm as inconclusive, not as failing tests", async () => {
		const run = await runCangjieCheck(
			"test",
			ctx,
			deps(async () => processResult({ exitCode: 1, output: "error: unknown option '--report-format'" })),
		)

		expect(run).toMatchObject({ status: "inconclusive", abortReason: "unsupported_options" })
	})

	it("does not run tests when they are excluded", async () => {
		const exec = vi.fn(async () => processResult())

		const result = await runCangjieVerification(ctx, deps(exec), { skipTests: true })

		expect(exec).toHaveBeenCalledTimes(1)
		expect(result.test).toBeUndefined()
	})

	afterEach(async () => {
		await fs.rm(taskDir, { recursive: true, force: true })
	})

	it("records a passing build with exit code, fingerprints, sdk and a log reference", async () => {
		const exec = vi.fn(async () => processResult())

		const run = await runCangjieCheck("build", ctx, deps(exec))

		expect(exec).toHaveBeenCalledWith(
			"/sdk/tools/bin/cjpm",
			["build"],
			expect.objectContaining({ cwd: "/ws/app", env: { PATH: "/sdk/bin" }, timeoutMs: 60_000 }),
		)
		expect(run).toMatchObject({
			kind: "build",
			phase: "delivery",
			status: "passed",
			exitCode: 0,
			executable: "/sdk/tools/bin/cjpm",
			cwd: "/ws/app",
			inputFingerprint: "fp-1",
			inputFingerprintAfter: "fp-1",
			sdk: { home: "/sdk", version: "1.0.5" },
			stale: false,
		})
		await expect(fs.readFile(path.join(taskDir, run.logRef!), "utf8")).resolves.toBe("cjpm build success")
		const record = await loadVerificationRecord(taskDir, "task-1")
		expect(record?.runs).toEqual([run])
	})

	it("records a failing build", async () => {
		const run = await runCangjieCheck(
			"build",
			ctx,
			deps(async () => processResult({ exitCode: 1, output: "error" })),
		)

		expect(run).toMatchObject({ status: "failed", exitCode: 1 })
	})

	it("records a missing executable as blocked without an exit code", async () => {
		const run = await runCangjieCheck(
			"build",
			ctx,
			deps(async () => processResult({ exitCode: null, spawnError: "spawn cjpm ENOENT" })),
		)

		expect(run).toMatchObject({ status: "blocked", abortReason: "spawn_failed", abortDetail: "spawn cjpm ENOENT" })
		expect(run.exitCode).toBeUndefined()
	})

	it("records an unresolvable cjpm as blocked without spawning", async () => {
		const exec = vi.fn()

		const run = await runCangjieCheck("build", ctx, deps(exec, { resolveCjpm: () => undefined }))

		expect(exec).not.toHaveBeenCalled()
		expect(run).toMatchObject({ status: "blocked", abortReason: "spawn_failed" })
	})

	it("records a timeout as inconclusive", async () => {
		const run = await runCangjieCheck(
			"build",
			ctx,
			deps(async () => processResult({ exitCode: null, timedOut: true })),
		)

		expect(run).toMatchObject({ status: "inconclusive", abortReason: "timeout" })
	})

	it("records a cancellation", async () => {
		const run = await runCangjieCheck(
			"build",
			ctx,
			deps(async () => processResult({ exitCode: null, cancelled: true, output: "partial" })),
		)

		expect(run).toMatchObject({ status: "cancelled", abortReason: "cancelled" })
		await expect(fs.readFile(path.join(taskDir, run.logRef!), "utf8")).resolves.toBe("partial")
	})

	it("records an unknown exit code as inconclusive", async () => {
		const run = await runCangjieCheck(
			"build",
			ctx,
			deps(async () => processResult({ exitCode: null })),
		)

		expect(run).toMatchObject({ status: "inconclusive", abortReason: "exit_code_unknown" })
	})

	it("records a signal-terminated process as inconclusive", async () => {
		const run = await runCangjieCheck(
			"build",
			ctx,
			deps(async () => processResult({ exitCode: null, signal: "SIGKILL" })),
		)

		expect(run).toMatchObject({ status: "inconclusive", abortReason: "signal", abortDetail: "SIGKILL" })
	})

	it("captures the fingerprint after the run so mid-run edits are visible", async () => {
		const snapshot = vi
			.fn()
			.mockResolvedValueOnce({ fingerprint: "fp-before", files: { "cjpm.lock": "before" } })
			.mockResolvedValueOnce({ fingerprint: "fp-after", files: { "cjpm.lock": "after" } })

		const run = await runCangjieCheck(
			"build",
			ctx,
			deps(async () => processResult(), { snapshot }),
		)

		expect(run).toMatchObject({ inputFingerprint: "fp-before", inputFingerprintAfter: "fp-after" })
		expect((await loadSnapshot(taskDir, "fp-before"))?.files).toEqual({ "cjpm.lock": "before" })
		expect((await loadSnapshot(taskDir, "fp-after"))?.files).toEqual({ "cjpm.lock": "after" })
	})

	it("runs tests with an xml report outside the project and records the counts", async () => {
		const exec = vi.fn(async () => processResult({ output: PASSING_TEST_OUTPUT }))

		const run = await runCangjieCheck("test", ctx, deps(exec))

		const [, args] = exec.mock.calls[0] as unknown as [string, string[]]
		expect(args.slice(0, 1)).toEqual(["test"])
		expect(args).toEqual(expect.arrayContaining(["--report-format", "xml", "--no-progress", "--no-color"]))
		const reportDir = args[args.indexOf("--report-path") + 1]
		expect(reportDir.startsWith(taskDir)).toBe(true)
		expect(run).toMatchObject({
			kind: "test",
			status: "passed",
			testScope: { description: "whole project", executed: 3, passed: 3, failed: 0, skipped: 0 },
		})
	})

	it("marks a zero-exit test run that reports failures as failed", async () => {
		const output = PASSING_TEST_OUTPUT.replace("PASSED: 3", "PASSED: 2").replace("FAILED: 0", "FAILED: 1")

		const run = await runCangjieCheck(
			"test",
			ctx,
			deps(async () => processResult({ output })),
		)

		expect(run.status).toBe("failed")
	})

	it("skips tests when the build did not pass", async () => {
		const exec = vi.fn(async () => processResult({ exitCode: 1, output: "error" }))

		const result = await runCangjieVerification(ctx, deps(exec))

		expect(exec).toHaveBeenCalledTimes(1)
		expect(result.build.status).toBe("failed")
		expect(result.test).toBeUndefined()
	})

	it("runs build then tests when the build passes", async () => {
		const exec = vi
			.fn()
			.mockResolvedValueOnce(processResult())
			.mockResolvedValueOnce(processResult({ output: PASSING_TEST_OUTPUT }))

		const result = await runCangjieVerification(ctx, deps(exec))

		expect(result.build.status).toBe("passed")
		expect(result.test?.status).toBe("passed")
		expect((await loadVerificationRecord(taskDir, "task-1"))?.runs).toHaveLength(2)
	})

	it("does not start tests after cancellation", async () => {
		const controller = new AbortController()
		const exec = vi.fn(async () => {
			controller.abort()
			return processResult()
		})

		const result = await runCangjieVerification({ ...ctx, signal: controller.signal }, deps(exec))

		expect(exec).toHaveBeenCalledTimes(1)
		expect(result.test).toBeUndefined()
	})
})
