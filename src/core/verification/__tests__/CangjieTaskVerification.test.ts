import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import {
	CangjieTaskVerification,
	type TaskVerificationDeps,
	type TaskVerificationPolicy,
} from "../CangjieTaskVerification"
import type { CangjieCheckDeps, ProcessResult } from "../CangjieVerificationRunner"
import { loadVerificationRecord } from "../VerificationStore"
import { computeProjectSnapshot } from "../projectFingerprint"

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (filePath: string, data: unknown) => {
		await fs.mkdir(path.dirname(filePath), { recursive: true })
		await fs.writeFile(filePath, JSON.stringify(data), "utf8")
	}),
}))

const TESTS_PASSED = "Summary: TOTAL: 4\n    PASSED: 4, SKIPPED: 0, ERROR: 0\n    FAILED: 0\ncjpm test success"
const TESTS_FAILED = "Summary: TOTAL: 4\n    PASSED: 3, SKIPPED: 0, ERROR: 0\n    FAILED: 1\nError: cjpm test failed"
const NO_TESTS = "Summary: TOTAL: 0\n    PASSED: 0, SKIPPED: 0, ERROR: 0\n    FAILED: 0\ncjpm test success"

function ok(output = "cjpm build success"): ProcessResult {
	return { exitCode: 0, output, timedOut: false, cancelled: false }
}
function fail(output: string): ProcessResult {
	return { exitCode: 1, output, timedOut: false, cancelled: false }
}

const approveAll = async () => ({ approved: true })

function makePolicy(overrides: Partial<TaskVerificationPolicy> = {}): TaskVerificationPolicy {
	return {
		isCheckOnlyRoute: vi.fn(() => false),
		isBuildOnlyRequest: vi.fn(() => false),
		getRouteKind: vi.fn(() => "implement" as const),
		getWrittenPaths: vi.fn(() => []),
		isRepairLoopExhausted: vi.fn(() => false),
		noteBuildResult: vi.fn(),
		noteTestResult: vi.fn(),
		...overrides,
	}
}

describe("CangjieTaskVerification", () => {
	let base: string
	let projectRoot: string
	let taskDir: string
	let exec: ReturnType<typeof vi.fn<CangjieCheckDeps["exec"]>>
	let suspendAutoFormat: ReturnType<typeof vi.fn>
	let release: ReturnType<typeof vi.fn>
	let trusted: boolean
	let autoApproved: boolean
	let ids: number

	function deps(): TaskVerificationDeps {
		const checkDeps: CangjieCheckDeps = {
			exec,
			resolveCjpm: () => "cjpm",
			buildEnv: () => ({}),
			sdkInfo: async () => ({ version: "1.0.5" }),
			snapshot: async () => ({ coverage: "complete" as const, gaps: [], fingerprint: "fp-1", files: {} }),
			environment: async () => ({ sdkVersion: "1.0.5", cjpmPath: "cjpm" }),
			now: () => ++ids,
			newId: () => `run-${ids}`,
			timeoutMs: 1_000,
		}
		return {
			taskDir: async () => taskDir,
			workspaceFolders: () => [],
			checkDeps,
			suspendAutoFormat,
			isWorkspaceTrusted: () => trusted,
			canAutoApprove: async () => autoApproved,
		}
	}

	function create(policy: TaskVerificationPolicy, cwd = projectRoot): CangjieTaskVerification {
		return new CangjieTaskVerification({ taskId: "task-1", cwd, policy }, deps())
	}

	beforeEach(async () => {
		ids = 0
		trusted = true
		autoApproved = true
		base = await fs.mkdtemp(path.join(os.tmpdir(), "cj-session-"))
		projectRoot = path.join(base, "app")
		taskDir = path.join(base, "task")
		await fs.mkdir(path.join(projectRoot, "src"), { recursive: true })
		await fs.writeFile(path.join(projectRoot, "cjpm.toml"), '[package]\nname = "app"\n', "utf8")
		exec = vi.fn<CangjieCheckDeps["exec"]>()
		release = vi.fn()
		suspendAutoFormat = vi.fn(() => release)
	})

	afterEach(async () => {
		await fs.rm(base, { recursive: true, force: true })
	})

	it("allows a verified delivery after approval and records the claim and facts", async () => {
		exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(TESTS_PASSED))
		const policy = makePolicy()
		const approve = vi.fn(approveAll)

		const outcome = await create(policy).verifyForCompletion(approve)

		expect(approve.mock.calls).toEqual([["cjpm build"], ["cjpm test"]])
		expect(outcome.action).toBe("allow")
		if (outcome.action === "allow") expect(outcome.facts).toContain("Verdict: verified")
		expect(policy.noteBuildResult).toHaveBeenCalledWith("cjpm build", true, "")
		expect(policy.noteTestResult).toHaveBeenCalledWith(true)
		const record = await loadVerificationRecord(taskDir, "task-1")
		expect(record?.claims).toHaveLength(1)
		expect(record?.claims[0]?.inputFingerprint).toBe("fp-1")
	})

	it.each(["passed", "failed", "denied", "cancelled"] as const)(
		"runs a changed dependency's test suite and retains its %s outcome",
		async (state) => {
			const dependency = path.join(projectRoot, "libs", "pricing")
			await fs.mkdir(path.join(dependency, "src"), { recursive: true })
			await fs.writeFile(
				path.join(projectRoot, "cjpm.toml"),
				'[package]\nname = "app"\n[dependencies]\npricing = { path = "libs/pricing" }\n',
			)
			await fs.writeFile(path.join(dependency, "cjpm.toml"), '[package]\nname = "pricing"\n')
			const alias = path.join(base, "project-alias")
			await fs.symlink(projectRoot, alias, process.platform === "win32" ? "junction" : "dir")
			const policy = makePolicy({
				getWrittenPaths: () => [path.join(alias, "libs", "pricing", "src", "price.cj")],
			})
			const dependencies = deps()
			const snapshot = vi.fn(dependencies.checkDeps.snapshot)
			dependencies.checkDeps.snapshot = snapshot
			exec.mockResolvedValueOnce(ok())
				.mockResolvedValueOnce(ok(TESTS_PASSED))
				.mockResolvedValueOnce(state === "failed" ? fail(TESTS_FAILED) : ok(TESTS_PASSED))
			const session = new CangjieTaskVerification({ taskId: "task-1", cwd: projectRoot, policy }, dependencies)
			let approvals = 0
			const outcome = await session.verifyForCompletion(async () => {
				if (++approvals === 3 && state === "cancelled") session.cancel()
				return { approved: !(approvals === 3 && state === "denied") }
			})
			expect(approvals).toBe(3)
			const canonicalRoot = await fs.realpath(projectRoot)
			const canonicalDependency = await fs.realpath(dependency)
			expect(snapshot.mock.calls.every(([root]) => root === canonicalRoot || root === projectRoot)).toBe(true)
			const record = await loadVerificationRecord(taskDir, "task-1")
			expect(record?.runs.at(-1)).toMatchObject({
				cwd: canonicalDependency,
				inputFingerprint: "fp-1",
				inputFingerprintAfter: "fp-1",
				status: state === "denied" ? "blocked" : state,
			})
			if (state === "passed" || state === "failed")
				expect(exec.mock.calls.at(-1)?.[2]).toMatchObject({
					cwd: canonicalDependency,
					workspacePath: canonicalRoot,
				})
			expect(outcome.action).toBe(state === "failed" ? "block" : state === "cancelled" ? "cancelled" : "allow")
			if (state !== "cancelled")
				expect(record?.claims.at(-1)?.testProjectRoots).toEqual([canonicalRoot, canonicalDependency])
			const summary = await session.currentSummary()
			expect(summary?.overall).toBe(
				state === "passed" ? "verified" : state === "failed" ? "failed" : "incomplete",
			)
			expect(summary?.relatedTests).toHaveLength(1)
			session.dispose()
		},
	)

	it("returns approval feedback without running or recording a new delivery", async () => {
		const feedback = { text: "先修复边界问题，不要结束", images: ["data:image/png;base64,eA=="] }
		const outcome = await create(makePolicy()).verifyForCompletion(async () => ({ approved: false, feedback }))
		expect(outcome).toEqual({ action: "feedback", feedback })
		expect(exec).not.toHaveBeenCalled()
		const record = await loadVerificationRecord(taskDir, "task-1")
		expect(record?.claims ?? []).toEqual([])
		expect(record?.runs ?? []).toEqual([])
	})

	it.each(["accepted", "changes_requested"] as const)(
		"records an explicit %s decision for unchanged code",
		async (decision) => {
			const dependencies = deps()
			dependencies.checkDeps.snapshot = computeProjectSnapshot
			exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(TESTS_PASSED))
			const session = new CangjieTaskVerification(
				{ taskId: "task-1", cwd: projectRoot, policy: makePolicy() },
				dependencies,
			)
			await session.verifyForCompletion(approveAll)

			await expect(session.recordAcceptance(decision)).resolves.toBe("recorded")
			expect((await loadVerificationRecord(taskDir, "task-1"))?.acceptances.at(-1)?.decision).toBe(decision)
		},
	)

	it("rejects acceptance after a source change without changing the record", async () => {
		const dependencies = deps()
		dependencies.checkDeps.snapshot = computeProjectSnapshot
		exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(TESTS_PASSED))
		const session = new CangjieTaskVerification(
			{ taskId: "task-1", cwd: projectRoot, policy: makePolicy() },
			dependencies,
		)
		await session.verifyForCompletion(approveAll)
		const before = await loadVerificationRecord(taskDir, "task-1")
		await fs.writeFile(path.join(projectRoot, "src", "main.cj"), "main() {}")

		await expect(session.recordAcceptance("accepted")).resolves.toBe("superseded")
		await expect(loadVerificationRecord(taskDir, "task-1")).resolves.toEqual(before)
	})

	it("does not accept when there is no delivery", async () => {
		await expect(create(makePolicy()).recordAcceptance("accepted")).resolves.toBe("no_delivery")
	})

	it("has no summary or successful outcome before any verification record exists", async () => {
		const session = create(makePolicy())
		await expect(session.currentSummary()).resolves.toBeUndefined()
		await expect(session.getOutcome()).resolves.toEqual({ overall: "no_record", acceptance: "no_delivery" })
	})

	it("preserves the edited file list and diff when cancelled before any completion claim", async () => {
		const dependencies = deps()
		dependencies.checkDeps.snapshot = computeProjectSnapshot
		const policy = makePolicy()
		const file = path.join(projectRoot, "src", "main.cj")
		await fs.writeFile(file, "main() { 1 }\n")
		vi.mocked(policy.getWrittenPaths).mockReturnValue([file])
		const session = new CangjieTaskVerification({ taskId: "task-1", cwd: projectRoot, policy }, dependencies)
		const progress: { stage: string; status: string }[] = []
		session.onDidProgress((event) => progress.push(event))
		await session.prepareForTask()
		await fs.writeFile(file, "main() { 2 }\n")
		session.cancel()
		session.noteToolStarted("write_to_file")
		const summary = await session.currentSummary()
		expect(summary?.overall).toBe("no_record")
		expect(summary?.delivery?.files).toContainEqual({
			path: "src/main.cj",
			change: "modified",
			source: "task_tool",
		})
		expect(await fs.readFile(summary!.delivery!.diffPath!, "utf8")).toContain("+main() { 2 }")
		expect(progress.some((event) => event.stage === "sdk" && event.status === "completed")).toBe(true)
		expect(progress.some((event) => event.stage === "edit")).toBe(false)
		expect(exec).not.toHaveBeenCalled()
		expect(await loadVerificationRecord(taskDir, "task-1")).toBeUndefined()
		session.dispose()
	})

	it("shows a missing cjpm path even for read-only environment inspection", async () => {
		const dependencies = deps()
		dependencies.checkDeps.resolveCjpm = () => undefined
		dependencies.checkDeps.unavailableReason = () => "Configured cjpm executable is missing: /missing-sdk/cjpm"
		const session = new CangjieTaskVerification(
			{
				taskId: "task-1",
				cwd: projectRoot,
				policy: makePolicy({ getRouteKind: () => "explore", isCheckOnlyRoute: () => true }),
			},
			dependencies,
		)
		const progress: { stage: string; status: string; detail?: string }[] = []
		session.onDidProgress((event) => progress.push(event))
		await session.prepareForTask()
		expect(progress).toContainEqual(
			expect.objectContaining({
				stage: "sdk",
				status: "blocked",
				detail: expect.stringContaining("/missing-sdk/cjpm"),
			}),
		)
		expect(exec).not.toHaveBeenCalled()
		session.dispose()
	})

	it("reports unavailable evidence without overwriting a corrupt record", async () => {
		await fs.mkdir(taskDir, { recursive: true })
		await fs.writeFile(path.join(taskDir, "verification.json"), "{broken")
		const session = create(makePolicy())
		await expect(session.currentSummary()).resolves.toMatchObject({
			overall: "no_record",
			acceptance: "no_delivery",
			note: expect.stringContaining("unavailable"),
		})
		expect(await fs.readFile(path.join(taskDir, "verification.json"), "utf8")).toBe("{broken")
	})

	it("exposes recorded facts and prevents accepting an unexpected delivery", async () => {
		exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(TESTS_PASSED))
		const session = create(makePolicy())
		const outcome = await session.verifyForCompletion(approveAll)
		if (outcome.action !== "allow") throw new Error("expected a delivery")
		expect(outcome.summary).toMatchObject({ overall: "verified", acceptance: "pending", test: { executed: 4 } })
		await expect(session.recordAcceptance("accepted", "different-claim")).resolves.toBe("superseded")
		await expect(session.recordAcceptance("accepted", outcome.summary.claimId)).resolves.toBe("recorded")
		await expect(session.getOutcome()).resolves.toEqual({ overall: "verified", acceptance: "accepted" })
		session.dispose()
	})

	it("reports external edits on resume and preserves checkpoint invalidation cause", async () => {
		const dependencies = deps()
		dependencies.checkDeps.snapshot = computeProjectSnapshot
		exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(TESTS_PASSED))
		const session = new CangjieTaskVerification(
			{ taskId: "task-1", cwd: projectRoot, policy: makePolicy() },
			dependencies,
		)
		await session.verifyForCompletion(approveAll)
		await expect(session.onTaskResumed()).resolves.toBeUndefined()
		await fs.writeFile(path.join(projectRoot, "src", "external.cj"), "main() {}")
		await session.onCheckpointRestored()
		const notice = await session.onTaskResumed()
		expect(notice).toContain("仓颉验证输入已变化")
		expect(notice).toContain("Changes by other sources: src/external.cj")
		expect((await loadVerificationRecord(taskDir, "task-1"))?.invalidations).toMatchObject([
			{ cause: "checkpoint_restore" },
		])
		session.dispose()
	})

	it("does not reuse a success from a different SDK environment", async () => {
		const dependencies = deps()
		let sdkVersion = "1.0.5"
		dependencies.checkDeps.sdkInfo = async () => ({ version: sdkVersion })
		dependencies.checkDeps.environment = async () => ({ sdkVersion, cjpmPath: "cjpm" })
		exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(TESTS_PASSED))
		const session = new CangjieTaskVerification(
			{ taskId: "task-1", cwd: projectRoot, policy: makePolicy() },
			dependencies,
		)
		await session.verifyForCompletion(approveAll)
		sdkVersion = "2.0.0"
		const notice = await session.onTaskResumed()
		expect(notice).toContain("仓颉验证输入已变化")
		expect(notice).toContain("SDK or cjpm environment changed (stale)")
		exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(TESTS_PASSED))
		const result = await session.verifyForCompletion(approveAll)
		expect(exec).toHaveBeenCalledTimes(4)
		if (result.action === "allow") expect(result.facts).toContain("Verdict: verified")
		expect(result.action).toBe("allow")
		expect((await loadVerificationRecord(taskDir, "task-1"))?.invalidations).toHaveLength(1)
		session.dispose()
	})

	it("delivers with the gap when the user does not approve the build", async () => {
		const outcome = await create(makePolicy()).verifyForCompletion(async () => false)

		expect(exec).not.toHaveBeenCalled()
		expect(outcome.action).toBe("allow")
		if (outcome.action === "allow") expect(outcome.facts).toMatch(/Build: blocked.*not approved/)
	})

	it("runs nothing in an untrusted workspace", async () => {
		trusted = false
		const approve = vi.fn(approveAll)

		const outcome = await create(makePolicy()).verifyForCompletion(approve)

		expect(approve).not.toHaveBeenCalled()
		expect(exec).not.toHaveBeenCalled()
		if (outcome.action === "allow") expect(outcome.facts).toMatch(/not trusted/)
	})

	it("can accept a fingerprinted but unverified delivery without running untrusted commands", async () => {
		trusted = false
		const session = create(makePolicy())
		const result = await session.verifyForCompletion(approveAll)
		expect(result.action).toBe("allow")
		await expect(session.recordAcceptance("accepted")).resolves.toBe("recorded")
		await expect(session.getOutcome()).resolves.toEqual({ overall: "incomplete", acceptance: "accepted" })
		expect(exec).not.toHaveBeenCalled()
	})

	it("blocks a failed build with the build output and feeds the failure to the repair route", async () => {
		exec.mockResolvedValueOnce(fail("error: undeclared identifier 'foo'"))
		const policy = makePolicy()

		const outcome = await create(policy).verifyForCompletion(approveAll)

		expect(outcome.action).toBe("block")
		if (outcome.action === "block") expect(outcome.reason).toContain("undeclared identifier 'foo'")
		expect(policy.noteBuildResult).toHaveBeenCalledWith(
			"cjpm build",
			false,
			expect.stringContaining("undeclared identifier"),
		)
	})

	it("stops blocking after repeated system verification failures even without repair delegations", async () => {
		exec.mockResolvedValue(fail("error: still broken"))
		const session = create(makePolicy())

		const outcomes = []
		for (let i = 0; i < 4; i++) outcomes.push((await session.verifyForCompletion(approveAll)).action)

		expect(outcomes).toEqual(["block", "block", "block", "allow"])
	})

	it("allows a partial delivery after repair attempts are exhausted", async () => {
		exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(fail(TESTS_FAILED))

		const outcome = await create(makePolicy({ isRepairLoopExhausted: vi.fn(() => true) })).verifyForCompletion(
			approveAll,
		)

		expect(outcome.action).toBe("allow")
		if (outcome.action === "allow") expect(outcome.facts).toMatch(/Verdict: failed[\s\S]*Tests: failed/)
	})

	it("asks once for tests when none exist and reuses the result instead of rebuilding", async () => {
		exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(NO_TESTS))
		const session = create(makePolicy())

		const first = await session.verifyForCompletion(approveAll)
		const second = await session.verifyForCompletion(approveAll)

		expect(first.action).toBe("block")
		expect(second.action).toBe("allow")
		if (second.action === "allow") expect(second.facts).toMatch(/no tests executed/)
		expect(exec).toHaveBeenCalledTimes(2)
	})

	it("does not add a test run when the user only allowed cjpm build", async () => {
		exec.mockResolvedValueOnce(ok())
		const approve = vi.fn(approveAll)

		const outcome = await create(makePolicy({ isBuildOnlyRequest: vi.fn(() => true) })).verifyForCompletion(approve)

		expect(approve.mock.calls).toEqual([["cjpm build"]])
		expect(outcome.action).toBe("allow")
		if (outcome.action === "allow") expect(outcome.facts).toMatch(/Tests: not run[\s\S]*only allowed `cjpm build`/)
	})

	it("skips system verification for read-only exploration that wrote nothing", async () => {
		const outcome = await create(makePolicy({ getRouteKind: vi.fn(() => "explore" as const) })).verifyForCompletion(
			approveAll,
		)

		expect(outcome).toEqual({ action: "skip" })
		expect(exec).not.toHaveBeenCalled()
	})

	it("does not route a check-only task into repair and suspends auto-format until the route changes", async () => {
		exec.mockResolvedValueOnce(fail("error: bad"))
		const checkOnly = vi.fn(() => true)
		const session = create(
			makePolicy({ isCheckOnlyRoute: checkOnly, getRouteKind: vi.fn(() => "verify" as const) }),
		)

		session.onRouteConfigured()
		const outcome = await session.verifyForCompletion(approveAll)

		expect(suspendAutoFormat).toHaveBeenCalledWith(projectRoot)
		expect(outcome.action).toBe("allow")
		checkOnly.mockReturnValue(false)
		session.onRouteConfigured()
		expect(release).toHaveBeenCalled()
	})

	it("reports an unresolved project without running anything", async () => {
		const outside = await fs.mkdtemp(path.join(os.tmpdir(), "cj-noproj-"))
		try {
			const outcome = await create(makePolicy(), outside).verifyForCompletion(approveAll)

			expect(exec).not.toHaveBeenCalled()
			expect(outcome.action).toBe("allow")
			if (outcome.action === "allow") expect(outcome.facts).toMatch(/Note: No cjpm\.toml found/)
		} finally {
			await fs.rm(outside, { recursive: true, force: true })
		}
	})

	it("returns cancelled when the task is cancelled during verification", async () => {
		const session = create(makePolicy())
		exec.mockImplementationOnce(async () => {
			session.cancel()
			return { exitCode: null, output: "partial", timedOut: false, cancelled: true }
		})

		await expect(session.verifyForCompletion(approveAll)).resolves.toEqual({ action: "cancelled" })
		const record = await loadVerificationRecord(taskDir, "task-1")
		expect(record?.runs[0]).toMatchObject({ status: "cancelled" })
	})

	it("runs a baseline only when both commands are auto-approved", async () => {
		autoApproved = false
		const session = create(makePolicy())

		session.onRouteConfigured()
		exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(TESTS_PASSED))
		await session.verifyForCompletion(approveAll)

		const record = await loadVerificationRecord(taskDir, "task-1")
		expect(record?.runs.filter((r) => r.phase === "baseline")).toHaveLength(0)
	})

	it("preempts an unfinished baseline instead of waiting for it", async () => {
		let releaseBaseline: (() => void) | undefined
		exec.mockImplementationOnce(
			(_file: string, _args: string[], options: { signal: AbortSignal }) =>
				new Promise<ProcessResult>((resolve) => {
					releaseBaseline = () => resolve({ exitCode: null, output: "", timedOut: false, cancelled: true })
					options.signal.addEventListener("abort", () => releaseBaseline?.())
				}),
		)
		exec.mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok(TESTS_PASSED))
		const session = create(makePolicy())

		session.onRouteConfigured()
		await vi.waitFor(() => expect(releaseBaseline).toBeDefined())
		const outcome = await session.verifyForCompletion(approveAll)

		expect(outcome.action).toBe("allow")
		const record = await loadVerificationRecord(taskDir, "task-1")
		expect(record?.runs.find((r) => r.phase === "baseline")).toMatchObject({ status: "cancelled" })
	})

	it("waits for the cancelled baseline to finish cleanup before preemption resolves", async () => {
		let finishCleanup!: () => void
		let aborted = false
		exec.mockImplementationOnce(
			(_file: string, _args: string[], options: { signal: AbortSignal }) =>
				new Promise<ProcessResult>((resolve) => {
					finishCleanup = () => resolve({ exitCode: null, output: "", timedOut: false, cancelled: true })
					options.signal.addEventListener("abort", () => {
						aborted = true
					})
				}),
		)
		const session = create(makePolicy())
		session.onRouteConfigured()
		await vi.waitFor(() => expect(finishCleanup).toBeDefined())
		let stopped = false
		const stopping = session.preemptBaseline().then(() => {
			stopped = true
		})
		try {
			await Promise.resolve()
			expect(aborted).toBe(true)
			expect(stopped).toBe(false)
		} finally {
			finishCleanup()
			await stopping
		}
		expect(stopped).toBe(true)
		const record = await loadVerificationRecord(taskDir, "task-1")
		expect(record?.runs.find((r) => r.phase === "baseline")).toMatchObject({ status: "cancelled" })
	})

	it("never reports success when the verification record is unreadable", async () => {
		await fs.mkdir(taskDir, { recursive: true })
		await fs.writeFile(path.join(taskDir, "verification.json"), "{broken", "utf8")

		const outcome = await create(makePolicy()).verifyForCompletion(approveAll)

		expect(exec).not.toHaveBeenCalled()
		expect(outcome.action).toBe("allow")
		if (outcome.action === "allow") {
			expect(outcome.facts).toMatch(/could not run/i)
			expect(outcome.facts).not.toContain("verified")
		}
	})
})
