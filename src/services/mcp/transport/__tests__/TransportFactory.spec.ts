import { describe, it, expect, vi, beforeEach } from "vitest"

import type { ITransportStrategy, TransportCallbacks } from "../ITransportStrategy"

vi.mock("../StdioTransportStrategy", () => ({
	StdioTransportStrategy: vi.fn(function (this: any) {
		this.type = "stdio"
		this.createTransport = vi.fn().mockResolvedValue({ kind: "stdio-transport" })
	}),
}))

vi.mock("../SseTransportStrategy", () => ({
	SseTransportStrategy: vi.fn(function (this: any) {
		this.type = "sse"
		this.createTransport = vi.fn().mockResolvedValue({ kind: "sse-transport" })
	}),
}))

vi.mock("../StreamableHttpTransportStrategy", () => ({
	StreamableHttpTransportStrategy: vi.fn(function (this: any) {
		this.type = "streamable-http"
		this.createTransport = vi.fn().mockResolvedValue({ kind: "streamable-http-transport" })
	}),
}))

import { TransportFactory } from "../TransportFactory"

describe("TransportFactory", () => {
	let factory: TransportFactory
	const callbacks: TransportCallbacks = {
		onError: vi.fn(),
		onClose: vi.fn(),
		onStderr: vi.fn(),
	}

	beforeEach(() => {
		vi.clearAllMocks()
		factory = new TransportFactory()
	})

	describe("constructor", () => {
		it("should register stdio, sse, and streamable-http strategies by default", async () => {
			const stdioTransport = await factory.create("server1", "stdio", { command: "node" }, callbacks)
			expect(stdioTransport).toEqual({ kind: "stdio-transport" })

			const sseTransport = await factory.create("server2", "sse", { url: "http://localhost" }, callbacks)
			expect(sseTransport).toEqual({ kind: "sse-transport" })

			const streamableHttpTransport = await factory.create(
				"server3",
				"streamable-http",
				{ url: "http://localhost" },
				callbacks,
			)
			expect(streamableHttpTransport).toEqual({ kind: "streamable-http-transport" })
		})
	})

	describe("create", () => {
		it("should create stdio transport for type 'stdio'", async () => {
			const config = { command: "node", args: ["server.js"] }
			const transport = await factory.create("myServer", "stdio", config, callbacks)

			expect(transport).toEqual({ kind: "stdio-transport" })
		})

		it("should create sse transport for type 'sse'", async () => {
			const config = { url: "http://localhost:3000/sse" }
			const transport = await factory.create("myServer", "sse", config, callbacks)

			expect(transport).toEqual({ kind: "sse-transport" })
		})

		it("should create streamable-http transport for type 'streamable-http'", async () => {
			const config = { url: "http://localhost:3000/mcp" }
			const transport = await factory.create("myServer", "streamable-http", config, callbacks)

			expect(transport).toEqual({ kind: "streamable-http-transport" })
		})

		it("should throw for unsupported type", async () => {
			await expect(factory.create("myServer", "websocket", {}, callbacks)).rejects.toThrow(
				"Unsupported MCP server type: websocket",
			)
		})

		it("should throw for empty type", async () => {
			await expect(factory.create("myServer", "", {}, callbacks)).rejects.toThrow("Unsupported MCP server type: ")
		})

		it("should pass name, config, and callbacks to strategy", async () => {
			const { StdioTransportStrategy } = await import("../StdioTransportStrategy")
			const mockCreateTransport = vi.fn().mockResolvedValue({ kind: "stdio-transport" })
			vi.mocked(StdioTransportStrategy).mockImplementationOnce(function (this: any) {
				this.type = "stdio"
				this.createTransport = mockCreateTransport
			})

			const newFactory = new TransportFactory()
			const config = { command: "node", args: [] }
			await newFactory.create("testServer", "stdio", config, callbacks)

			expect(mockCreateTransport).toHaveBeenCalledWith("testServer", config, callbacks)
		})
	})

	describe("register", () => {
		it("should allow registering a custom strategy", async () => {
			const customStrategy: ITransportStrategy = {
				type: "custom",
				createTransport: vi.fn().mockResolvedValue({ kind: "custom-transport" }),
			}

			factory.register(customStrategy)

			const transport = await factory.create("myServer", "custom", {}, callbacks)
			expect(transport).toEqual({ kind: "custom-transport" })
		})

		it("should allow overriding an existing strategy", async () => {
			const customStdio: ITransportStrategy = {
				type: "stdio",
				createTransport: vi.fn().mockResolvedValue({ kind: "custom-stdio" }),
			}

			factory.register(customStdio)

			const transport = await factory.create("myServer", "stdio", { command: "node" }, callbacks)
			expect(transport).toEqual({ kind: "custom-stdio" })
		})

		it("should not affect other strategies when overriding one", async () => {
			const customStdio: ITransportStrategy = {
				type: "stdio",
				createTransport: vi.fn().mockResolvedValue({ kind: "custom-stdio" }),
			}

			factory.register(customStdio)

			// sse should still work
			const sseTransport = await factory.create("myServer", "sse", { url: "http://localhost" }, callbacks)
			expect(sseTransport).toEqual({ kind: "sse-transport" })
		})
	})
})
