import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { execa } from "execa"
import { GuardedHostRunner } from "../GuardedHostRunner"
import type { CommandExecutionRequest } from "../CommandRunner"
import { CommandCancelledError, CommandFailedError } from "../SandboxErrors"
import { prepareTrustedReadOnlyGitCommand } from "../trustedGitCommand"

const execaState = vi.hoisted(() => ({
	events: [] as Array<{ stream: "stdout" | "stderr"; chunk: Buffer | string }>,
	exitCode: 0,
	deferCompletion: false,
	pendingReject: undefined as ((error: Error) => void) | undefined,
}))

// Mock execa
vi.mock("execa", () => {
	const createStream = () => {
		const dataListeners: Array<(chunk: Buffer | string) => void> = []
		return {
			on(event: string, listener: (chunk: Buffer | string) => void) {
				if (event === "data") {
					dataListeners.push(listener)
				}
				return this
			},
			emitData(chunk: Buffer | string) {
				for (const listener of dataListeners) {
					listener(chunk)
				}
			},
		}
	}

	const createSubprocess = () => {
		const stdout = createStream()
		const stderr = createStream()
		const subprocess = new Promise<{ exitCode: number }>((resolve, reject) => {
			if (execaState.deferCompletion) {
				execaState.pendingReject = reject
				return
			}

			queueMicrotask(() => {
				for (const event of execaState.events) {
					const stream = event.stream === "stdout" ? stdout : stderr
					stream.emitData(event.chunk)
				}
				resolve({ exitCode: execaState.exitCode })
			})
		})

		return Object.assign(subprocess, { stdout, stderr })
	}

	const execa = vi.fn((commandOrOptions: string | object) =>
		typeof commandOrOptions === "string" ? createSubprocess() : createSubprocess,
	)

	return {
		execa,
		ExecaError: class ExecaError extends Error {
			exitCode: number
			stderr?: string
			constructor(msg: string, exitCode: number) {
				super(msg)
				this.exitCode = exitCode
			}
		},
	}
})

// Mock vscode
vi.mock("vscode", () => ({
	window: { createTerminal: vi.fn() },
	workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn() })) },
}))

vi.mock("../trustedGitCommand", () => ({
	prepareTrustedReadOnlyGitCommand: vi.fn(async (command: string) =>
		command.startsWith("git ")
			? {
					executable: "C:\\Program Files\\Git\\cmd\\git.exe",
					args: ["log", "--no-ext-diff", "--no-textconv", "--oneline"],
					ceilingDirectory: process.cwd(),
				}
			: undefined,
	),
}))

// Mock terminal
vi.mock("../../../integrations/terminal/BaseTerminal", () => ({
	BaseTerminal: {
		getExecaShellPath: vi.fn().mockReturnValue("/bin/bash"),
	},
}))

// Mock hostShellCommand
vi.mock("../../../utils/hostShellCommand", () => ({
	normalizeDotSlashCommandForWindowsShell: vi.fn((cmd) => cmd),
}))

// Mock logger
vi.mock("../../../shared/logger", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

describe("GuardedHostRunner", () => {
	let runner: GuardedHostRunner

	beforeEach(() => {
		execaState.events = []
		execaState.exitCode = 0
		execaState.deferCompletion = false
		execaState.pendingReject = undefined
		runner = new GuardedHostRunner()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllEnvs()
		vi.clearAllMocks()
	})

	function createRequest(overrides: Partial<CommandExecutionRequest> = {}): CommandExecutionRequest {
		return {
			executionId: "exec-run",
			taskId: "task-run",
			command: "echo test",
			workspacePath: process.cwd(),
			timeoutMs: 10_000,
			source: "local",
			onOutput: vi.fn(),
			...overrides,
		}
	}

	describe("remote shell security", () => {
		it.each(["git show HEAD > ../outside.txt", "git diff > C:/Users/Public/out.txt", "git log < ../input.txt"])(
			"rejects remote I/O redirection: %s",
			async (command) => {
				const error = await runner.run(createRequest({ command, source: "mcp" })).catch((caught) => caught)

				expect(error).toBeInstanceOf(CommandFailedError)
				expect(error.stderr).toContain("shell I/O redirection is not allowed")
				expect(execa).not.toHaveBeenCalled()
			},
		)

		it("allows angle brackets inside a quoted argument", async () => {
			await runner.run(createRequest({ command: 'node -e "console.log(1 > 0)"', source: "cloud-agent" }))

			expect(execa).toHaveBeenCalledOnce()
		})

		it("preserves local interactive redirection behavior", async () => {
			await runner.run(createRequest({ command: "echo test > output.txt", source: "local" }))

			expect(execa).toHaveBeenCalledOnce()
		})

		it("runs default read-only Git through an absolute executable without a shell", async () => {
			await runner.run(
				createRequest({
					command: "git log --oneline",
					source: "mcp",
					environment: { GIT_DIR: "../outside", GIT_EXTERNAL_DIFF: "unsafe-helper" },
				}),
			)

			expect(prepareTrustedReadOnlyGitCommand).toHaveBeenCalledWith("git log --oneline", process.cwd(), {
				cwd: process.cwd(),
			})
			expect(execa).toHaveBeenCalledWith(
				"C:\\Program Files\\Git\\cmd\\git.exe",
				["log", "--no-ext-diff", "--no-textconv", "--oneline"],
				expect.objectContaining({
					shell: false,
					cwd: process.cwd(),
					env: expect.objectContaining({
						GIT_CEILING_DIRECTORIES: process.cwd(),
						GIT_CONFIG_NOSYSTEM: "1",
						GIT_NO_LAZY_FETCH: "1",
						GIT_OPTIONAL_LOCKS: "0",
					}),
				}),
			)
			const options = vi.mocked(execa).mock.calls[0]![2]
			expect(options?.env).not.toHaveProperty("GIT_DIR")
			expect(options?.env).not.toHaveProperty("GIT_EXTERNAL_DIFF")
		})
	})

	describe("execution isolation", () => {
		it("disables implicit env inheritance and Execa buffering", async () => {
			execaState.events = [{ stream: "stdout", chunk: "ok" }]
			vi.stubEnv("HOST_RUNNER_SENTINEL_TOKEN", "host-secret")

			await runner.run(
				createRequest({
					environment: {
						SAFE_REQUEST_VALUE: "allowed",
						REQUEST_API_KEY: "request-secret",
						NODE_OPTIONS: "--inspect",
					},
				}),
			)

			const options = vi.mocked(execa).mock.calls[0]![0]
			expect(options).toEqual(
				expect.objectContaining({
					extendEnv: false,
					buffer: false,
				}),
			)
			expect(options.env).toEqual(
				expect.objectContaining({
					SAFE_REQUEST_VALUE: "allowed",
					LANG: "en_US.UTF-8",
					LC_ALL: "en_US.UTF-8",
				}),
			)
			expect(options.env).not.toHaveProperty("HOST_RUNNER_SENTINEL_TOKEN")
			expect(options.env).not.toHaveProperty("REQUEST_API_KEY")
			expect(options.env).not.toHaveProperty("NODE_OPTIONS")
		})

		it("captures each output field within 100000 UTF-8 bytes while streaming all text", async () => {
			const stdout = `${"x".repeat(99_999)}你`
			const stderr = `${"y".repeat(99_999)}😀`
			const onOutput = vi.fn()
			execaState.events = [
				{ stream: "stdout", chunk: stdout },
				{ stream: "stderr", chunk: stderr },
			]

			const handle = await runner.run(createRequest({ onOutput }))

			expect(handle.stdout).toBe("x".repeat(99_999))
			expect(handle.stderr).toBe("y".repeat(99_999))
			expect(handle.output).toBe("x".repeat(99_999))
			expect(handle.stdout).not.toContain("\uFFFD")
			expect(handle.stderr).not.toContain("\uFFFD")
			expect(Buffer.byteLength(handle.output, "utf8")).toBeLessThanOrEqual(100_000)
			expect(Buffer.byteLength(handle.stdout!, "utf8")).toBeLessThanOrEqual(100_000)
			expect(Buffer.byteLength(handle.stderr!, "utf8")).toBeLessThanOrEqual(100_000)
			expect(handle.truncated).toBe(true)
			expect(handle.capturedBytes).toBe(99_999)
			expect(onOutput).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: stdout }))
			expect(onOutput).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: stderr, isStderr: true }))
		})

		it("preserves stdout and stderr event order in combined output", async () => {
			execaState.events = [
				{ stream: "stdout", chunk: "out-1" },
				{ stream: "stderr", chunk: "err-1" },
				{ stream: "stdout", chunk: "out-2" },
			]

			const handle = await runner.run(createRequest())

			expect(handle.output).toBe("out-1err-1out-2")
			expect(handle.stdout).toBe("out-1out-2")
			expect(handle.stderr).toBe("err-1")
			expect(handle.truncated).toBe(false)
			expect(handle.capturedBytes).toBe(15)
		})

		it("decodes a multi-byte character split across stream chunks", async () => {
			const encoded = Buffer.from("你", "utf8")
			const onOutput = vi.fn()
			execaState.events = [
				{ stream: "stdout", chunk: encoded.subarray(0, 2) },
				{ stream: "stdout", chunk: encoded.subarray(2) },
			]

			const handle = await runner.run(createRequest({ onOutput }))

			expect(handle.output).toBe("你")
			expect(onOutput).toHaveBeenCalledTimes(1)
			expect(onOutput).toHaveBeenCalledWith(expect.objectContaining({ text: "你" }))
		})
	})

	describe("disposeTask", () => {
		it("cancels an execution by its resource scope", async () => {
			execaState.deferCompletion = true
			const resourceScopeId = "task:task-A:instance-1"
			const runResult = runner
				.run(createRequest({ taskId: "task-A", resourceScopeId }))
				.catch((error: unknown) => error)
			const activeExecutions = (runner as any).activeExecutions as Map<string, any>
			let disposePromise: Promise<void> | undefined

			try {
				expect(activeExecutions.get("exec-run")?.resourceScopeId).toBe(resourceScopeId)
				disposePromise = runner.disposeTask(resourceScopeId)
				expect(vi.mocked(execa).mock.calls[0]![0].cancelSignal?.aborted).toBe(true)
			} finally {
				execaState.pendingReject?.(new Error("cancelled"))
			}

			expect(await runResult).toBeInstanceOf(CommandCancelledError)
			await disposePromise
		})

		it("accepts taskId as a compatibility fallback and waits for execution settlement", async () => {
			execaState.deferCompletion = true
			const runResult = runner
				.run(createRequest({ taskId: "task-A", resourceScopeId: "task:task-A:instance-1" }))
				.catch((error: unknown) => error)
			const activeExecutions = (runner as any).activeExecutions as Map<string, any>
			const disposePromise = runner.disposeTask("task-A")
			let disposeResolved = false
			void disposePromise.then(() => {
				disposeResolved = true
			})

			await Promise.resolve()
			expect(vi.mocked(execa).mock.calls[0]![0].cancelSignal?.aborted).toBe(true)
			expect(disposeResolved).toBe(false)
			expect(activeExecutions.has("exec-run")).toBe(true)

			execaState.pendingReject?.(new Error("cancelled"))
			expect(await runResult).toBeInstanceOf(CommandCancelledError)
			await disposePromise
			expect(activeExecutions.has("exec-run")).toBe(false)
		})

		it("does nothing when taskId does not match any execution", async () => {
			const abortA = vi.fn()
			const activeExecutions = (runner as any).activeExecutions as Map<string, any>
			activeExecutions.set("exec-1", {
				executionId: "exec-1",
				taskId: "task-A",
				resourceScopeId: "task:task-A:instance-1",
				abortController: { abort: abortA },
				timedOut: false,
				settled: Promise.resolve(),
			})

			await runner.disposeTask("task-nonexistent")

			expect(abortA).not.toHaveBeenCalled()
			expect(activeExecutions.size).toBe(1)
		})

		it("handles empty active executions gracefully", async () => {
			await expect(runner.disposeTask("task-X")).resolves.toBeUndefined()
		})
	})

	describe("cancel", () => {
		it("preserves cancellation when the subprocess settles after the deadline", async () => {
			vi.useFakeTimers()
			execaState.deferCompletion = true
			const result = runner.run(createRequest({ timeoutMs: 100 })).catch((error: unknown) => error)

			await vi.advanceTimersByTimeAsync(90)
			await runner.cancel("exec-run")
			await vi.advanceTimersByTimeAsync(20)
			execaState.pendingReject?.(new Error("cancelled"))

			expect(await result).toBeInstanceOf(CommandCancelledError)
		})

		it("aborts the execution matching executionId", async () => {
			const abortFn = vi.fn()
			const activeExecutions = (runner as any).activeExecutions as Map<string, any>
			activeExecutions.set("exec-42", {
				executionId: "exec-42",
				taskId: "task-1",
				abortController: { abort: abortFn },
				timedOut: false,
			})

			await runner.cancel("exec-42")

			expect(abortFn).toHaveBeenCalled()
		})

		it("does nothing for unknown executionId", async () => {
			// Should not throw
			await expect(runner.cancel("unknown-id")).resolves.toBeUndefined()
		})
	})
})
