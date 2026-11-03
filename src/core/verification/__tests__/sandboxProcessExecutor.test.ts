import { afterEach, describe, expect, it, vi } from "vitest"
import { createSandboxProcessExecutor } from "../sandboxProcessExecutor"
import { SandboxExecutionService } from "../../../services/sandbox/SandboxExecutionService"
import { GuardedHostRunner } from "../../../services/sandbox/GuardedHostRunner"
import { CommandCancelledError } from "../../../services/sandbox/SandboxErrors"
import { sandboxAudit } from "../../../services/sandbox/SandboxAudit"
import { asMock } from "../../../__tests__/helpers/asMock"

afterEach(() => {
	vi.unstubAllEnvs()
	vi.restoreAllMocks()
	vi.useRealTimers()
})

const options = () => ({
	cwd: process.cwd(),
	env: {},
	signal: new AbortController().signal,
	timeoutMs: 15_000,
	taskId: "verification-test",
})

describe("sandbox verification executor", () => {
	it("filters credentials from a real host process and records an audit", async () => {
		vi.stubEnv("OPENAI_API_KEY", "verification-sentinel")
		const service = new SandboxExecutionService()
		try {
			const result = await createSandboxProcessExecutor(service)(
				process.execPath,
				["-p", "Boolean(process.env.OPENAI_API_KEY)"],
				{ ...options(), env: { OPENAI_API_KEY: "fake-request" } },
			)
			expect(result.exitCode).toBe(0)
			expect(result.output.trim()).toBe("false")
			expect(sandboxAudit.getRecordsForTask("verification-test")).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ source: "local", backend: "guarded-host", status: "completed" }),
				]),
			)
		} finally {
			await service.dispose()
		}
	})

	it("uses container cjpm and does not inject host SDK paths", async () => {
		const run = vi
			.fn()
			.mockResolvedValue({ exitCode: 0, output: "ok", backend: "docker", imageDigest: "sha256:image" })
		const service = asMock<SandboxExecutionService>({ getConfiguredBackend: () => "docker", run, cancel: vi.fn() })
		const result = await createSandboxProcessExecutor(service)(
			"D:\\Cangjie\\cjpm.exe",
			["test", "--report-path", "target/.njust-verification/run"],
			{ ...options(), env: { PATH: "host-only" } },
		)
		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "cjpm test --report-path target/.njust-verification/run",
				source: "local",
				environment: {},
			}),
		)
		expect(result.imageDigest).toBe("sha256:image")
	})

	it("never falls back to host when Docker is unavailable", async () => {
		const host = vi.spyOn(GuardedHostRunner.prototype, "run")
		const service = new SandboxExecutionService({
			getBackend: () => "docker",
			getDockerStatus: () => "not-installed",
			getTimeoutSeconds: () => 120,
		})
		try {
			const result = await createSandboxProcessExecutor(service)("cjpm", ["build"], options())
			expect(result.sandboxDenied).toBeTruthy()
			expect(host).not.toHaveBeenCalled()
		} finally {
			await service.dispose()
		}
	})

	it.each(["cancel", "timeout"] as const)("routes %s through the sandbox cancellation interface", async (reason) => {
		vi.useFakeTimers()
		let rejectRun!: (error: Error) => void
		const run = vi.fn(
			() =>
				new Promise((_resolve, reject) => {
					rejectRun = reject
				}),
		)
		const cancel = vi.fn(async () => {
			rejectRun(new CommandCancelledError("id"))
		})
		const service = asMock<SandboxExecutionService>({ getConfiguredBackend: () => "guarded-host", run, cancel })
		const controller = new AbortController()
		const checking = createSandboxProcessExecutor(service)("cjpm", ["build"], {
			...options(),
			executionId: "id",
			signal: controller.signal,
			timeoutMs: 100,
		})
		if (reason === "cancel") controller.abort()
		else await vi.advanceTimersByTimeAsync(100)
		const result = await checking
		expect(cancel).toHaveBeenCalledWith("id")
		expect(result).toMatchObject({ timedOut: reason === "timeout", cancelled: reason === "cancel" })
	})

	it("classifies missing container SDK as a spawn failure", async () => {
		const service = asMock<SandboxExecutionService>({
			getConfiguredBackend: () => "docker",
			run: vi.fn().mockResolvedValue({ exitCode: 127, output: "cjpm: not found" }),
			cancel: vi.fn(),
		})
		expect((await createSandboxProcessExecutor(service)("cjpm", ["build"], options())).spawnError).toContain(
			"not found",
		)
	})
})
