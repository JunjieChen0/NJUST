import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockStderrOn = vi.fn()
const mockTransportStart = vi.fn().mockResolvedValue(undefined)
const mockTransportClose = vi.fn()

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn(function (this: any) {
		this.start = mockTransportStart
		this.close = mockTransportClose
		this.onerror = null
		this.onclose = null
		this.stderr = {
			on: mockStderrOn,
		}
		this.process = {
			unref: vi.fn(),
			on: vi.fn(),
		}
	}),
	getDefaultEnvironment: vi.fn().mockReturnValue({ PATH: "/usr/bin", HOME: "/home/user" }),
}))

vi.mock("../../../../utils/env", () => ({
	mergeSafeEnv: vi.fn().mockImplementation((defaults: Record<string, string>, custom: Record<string, string>) => ({
		...defaults,
		...custom,
	})),
}))

vi.mock("../../../../shared/logger", () => ({
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
	},
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: {
		reportError: vi.fn(),
	},
}))

vi.mock("@njust-ai/types", () => ({
	TelemetryEventName: {
		MCP_ERROR: "mcp_error",
	},
}))

import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js"
import { mergeSafeEnv } from "../../../../utils/env"
import { StdioTransportStrategy } from "../StdioTransportStrategy"
import type { TransportCallbacks } from "../ITransportStrategy"

describe("StdioTransportStrategy", () => {
	let strategy: StdioTransportStrategy
	let callbacks: TransportCallbacks
	let originalPlatform: PropertyDescriptor | undefined

	beforeEach(() => {
		vi.clearAllMocks()
		// Reset mock implementations to defaults
		mockTransportStart.mockReset()
		mockTransportStart.mockResolvedValue(undefined)
		strategy = new StdioTransportStrategy()
		callbacks = {
			onError: vi.fn(),
			onClose: vi.fn(),
			onStderr: vi.fn(),
		}
		originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")
		Object.defineProperty(process, "platform", { value: "linux" })
	})

	afterEach(() => {
		if (originalPlatform) {
			Object.defineProperty(process, "platform", originalPlatform)
		}
	})

	describe("type", () => {
		it("should have type 'stdio'", () => {
			expect(strategy.type).toBe("stdio")
		})
	})

	describe("createTransport", () => {
		it("should create a StdioClientTransport with correct options", async () => {
			const config = {
				command: "node",
				args: ["server.js"],
				cwd: "/workspace",
				env: { CUSTOM_VAR: "value" },
			}

			await strategy.createTransport("testServer", config, callbacks)

			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "node",
					args: ["server.js"],
					cwd: "/workspace",
					stderr: "pipe",
				}),
			)
		})

		it("should start the transport", async () => {
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			expect(mockTransportStart).toHaveBeenCalled()
		})

		it("should monkey-patch start to no-op after initial start", async () => {
			const config = { command: "node", args: [] }

			const transport = await strategy.createTransport("testServer", config, callbacks)

			// After creation, calling start again should be a no-op
			await transport.start()
			// The original mock was called once during createTransport; the monkey-patched version should not call it again
			expect(mockTransportStart).toHaveBeenCalledTimes(1)
		})

		it("should merge environment variables", async () => {
			const config = {
				command: "node",
				args: [],
				env: { MY_VAR: "my_value" },
			}

			await strategy.createTransport("testServer", config, callbacks)

			expect(getDefaultEnvironment).toHaveBeenCalled()
			expect(mergeSafeEnv).toHaveBeenCalledWith(expect.any(Object), { MY_VAR: "my_value" }, "testServer")
		})

		it("should use empty object when env is not provided", async () => {
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			expect(mergeSafeEnv).toHaveBeenCalledWith(expect.any(Object), {}, "testServer")
		})

		it("should call unref on child process to prevent blocking VS Code exit", async () => {
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			const transport = vi.mocked(StdioClientTransport).mock.instances[0] as any
			expect(transport.process.unref).toHaveBeenCalled()
		})

		it("should register exit and error listeners on child process", async () => {
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			const transport = vi.mocked(StdioClientTransport).mock.instances[0] as any
			expect(transport.process.on).toHaveBeenCalledWith("exit", expect.any(Function))
			expect(transport.process.on).toHaveBeenCalledWith("error", expect.any(Function))
		})

		it("should set up stderr listener before start", async () => {
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			expect(mockStderrOn).toHaveBeenCalledWith("data", expect.any(Function))
		})

		it("should handle missing stderr stream", async () => {
			vi.mocked(StdioClientTransport).mockImplementationOnce(function (this: any) {
				this.start = mockTransportStart
				this.close = mockTransportClose
				this.onerror = null
				this.onclose = null
				this.stderr = null
				this.process = {
					unref: vi.fn(),
					on: vi.fn(),
				}
			} as any)

			const config = { command: "node", args: [] }

			// Should not throw
			await strategy.createTransport("testServer", config, callbacks)

			const { logger } = await import("../../../../shared/logger")
			expect(logger.error).toHaveBeenCalledWith("McpHub", "No stderr stream for testServer")
		})

		it("should pass INFO level stderr to logger.info", async () => {
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			// Get the stderr data callback
			const stderrDataCallback = mockStderrOn.mock.calls[0][1]
			stderrDataCallback(Buffer.from("INFO: Server started"))

			const { logger } = await import("../../../../shared/logger")
			expect(logger.info).toHaveBeenCalledWith("McpHub", 'Server "testServer" info:', "INFO: Server started")
			expect(callbacks.onStderr).not.toHaveBeenCalled()
		})

		it("should pass non-INFO stderr to onStderr callback", async () => {
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			const stderrDataCallback = mockStderrOn.mock.calls[0][1]
			const errorData = Buffer.from("Error: something failed")
			stderrDataCallback(errorData)

			const { logger } = await import("../../../../shared/logger")
			expect(logger.error).toHaveBeenCalledWith(
				"McpHub",
				'Server "testServer" stderr:',
				"Error: something failed",
			)
			expect(callbacks.onStderr).toHaveBeenCalledWith(errorData)
		})
	})

	describe("Windows command wrapping", () => {
		it("should wrap command with cmd.exe on Windows", async () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			const config = { command: "npx", args: ["-y", "server"] }

			await strategy.createTransport("testServer", config, callbacks)

			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "cmd.exe",
					args: ["/c", "npx", "-y", "server"],
				}),
			)
		})

		it("should not double-wrap when command is already cmd.exe", async () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			const config = { command: "cmd.exe", args: ["/c", "npx"] }

			await strategy.createTransport("testServer", config, callbacks)

			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "cmd.exe",
					args: ["/c", "npx"],
				}),
			)
		})

		it("should not double-wrap when command is 'cmd'", async () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			const config = { command: "cmd", args: ["/c", "echo"] }

			await strategy.createTransport("testServer", config, callbacks)

			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "cmd",
					args: ["/c", "echo"],
				}),
			)
		})

		it("should not wrap command on non-Windows platforms", async () => {
			Object.defineProperty(process, "platform", { value: "linux" })
			const config = { command: "npx", args: ["-y", "server"] }

			await strategy.createTransport("testServer", config, callbacks)

			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "npx",
					args: ["-y", "server"],
				}),
			)
		})

		it("should handle empty args on Windows", async () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			const config = { command: "node" }

			await strategy.createTransport("testServer", config, callbacks)

			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "cmd.exe",
					args: ["/c", "node"],
				}),
			)
		})
	})

	describe("error handling", () => {
		it("should call callbacks.onError when transport errors", async () => {
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			// Get the transport instance and trigger its onerror handler
			const transport = vi.mocked(StdioClientTransport).mock.instances[0] as any
			const error = new Error("transport error")
			await transport.onerror(error)

			expect(callbacks.onError).toHaveBeenCalledWith(error)
		})

		it("should attempt reconnection on close with exponential backoff", async () => {
			vi.useFakeTimers()
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			const transport = vi.mocked(StdioClientTransport).mock.instances[0] as any

			// Simulate close
			await transport.onclose()

			// Should not immediately call onClose (reconnect attempt pending)
			expect(callbacks.onClose).not.toHaveBeenCalled()

			vi.useRealTimers()
		})

		it("should call onClose after max reconnect attempts exhausted", async () => {
			vi.useFakeTimers()
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			const transport = vi.mocked(StdioClientTransport).mock.instances[0] as any

			// After createTransport, transport.start is monkey-patched to a no-op.
			// Override it to reject so reconnect attempts fail and the counter accumulates.
			transport.start = vi.fn().mockRejectedValue(new Error("reconnect failed"))

			// Simulate 6 close events (MAX_STREAM_RECONNECT = 6)
			for (let i = 0; i < 6; i++) {
				await transport.onclose()
				await vi.advanceTimersByTimeAsync(120_000)
			}

			// 7th close should trigger onClose (reconnect exhausted)
			await transport.onclose()
			expect(callbacks.onClose).toHaveBeenCalled()

			vi.useRealTimers()
		})

		it("should reset reconnect attempts on successful reconnect", async () => {
			vi.useFakeTimers()
			const config = { command: "node", args: [] }

			await strategy.createTransport("testServer", config, callbacks)

			const transport = vi.mocked(StdioClientTransport).mock.instances[0] as any

			// Simulate close then successful reconnect
			await transport.onclose()
			await vi.advanceTimersByTimeAsync(120_000)

			// start was called again on successful reconnect, and the counter should be reset
			// Now simulate another close; it should try to reconnect again, not give up
			await transport.onclose()
			expect(callbacks.onClose).not.toHaveBeenCalled()

			vi.useRealTimers()
		})
	})

	describe("environment filtering", () => {
		it("should filter out undefined env values", async () => {
			vi.mocked(mergeSafeEnv).mockReturnValueOnce({
				PATH: "/usr/bin",
				UNDEFINED_VAR: undefined as any,
				DEFINED_VAR: "value",
			})

			const config = { command: "node", args: [], env: {} }

			await strategy.createTransport("testServer", config, callbacks)

			const transportCall = vi.mocked(StdioClientTransport).mock.calls[0][0]
			const env = transportCall.env as Record<string, string>

			expect(env.PATH).toBe("/usr/bin")
			expect(env.DEFINED_VAR).toBe("value")
			expect(env).not.toHaveProperty("UNDEFINED_VAR")
		})
	})
})
