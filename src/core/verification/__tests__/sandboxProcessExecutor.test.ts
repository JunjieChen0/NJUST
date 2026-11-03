import { afterEach, describe, expect, it, vi } from "vitest"
import { createSandboxProcessExecutor } from "../sandboxProcessExecutor"
import { SandboxExecutionService } from "../../../services/sandbox/SandboxExecutionService"
import { GuardedHostRunner } from "../../../services/sandbox/GuardedHostRunner"
import { CommandCancelledError } from "../../../services/sandbox/SandboxErrors"
import { sandboxAudit } from "../../../services/sandbox/SandboxAudit"
import { asMock } from "../../../__tests__/helpers/asMock"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

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
	it("cancels a real shell and its descendant without waiting for their natural exit", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "verification-tree-"))
		const heartbeat = path.join(dir, "heartbeat.txt")
		const script = path.join(dir, "parent.cjs")
		const child = `setInterval(() => require('fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())), 30); setTimeout(() => process.exit(), 15000)`
		await fs.writeFile(
			script,
			`require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], {stdio:'ignore'}); setTimeout(() => {}, 15000)`,
		)
		const service = new SandboxExecutionService()
		const controller = new AbortController()
		const running = createSandboxProcessExecutor(service)(process.execPath, [script], {
			...options(),
			cwd: dir,
			signal: controller.signal,
		})
		try {
			await vi.waitFor(async () => expect(await fs.readFile(heartbeat, "utf8")).toMatch(/^\d+$/), {
				timeout: 5_000,
			})
			const start = Date.now()
			controller.abort()
			expect((await running).cancelled).toBe(true)
			expect(Date.now() - start).toBeLessThan(5_000)
			const last = await fs.readFile(heartbeat, "utf8")
			await new Promise((resolve) => setTimeout(resolve, 150))
			expect(await fs.readFile(heartbeat, "utf8")).toBe(last)
		} finally {
			controller.abort()
			await running
			await service.dispose()
			await fs.rm(dir, { recursive: true, force: true })
		}
	}, 20_000)

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
