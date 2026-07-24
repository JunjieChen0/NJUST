import { afterAll, afterEach, beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import crypto from "crypto"
import http from "http"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import nock from "nock"
import * as path from "path"
import { RooToolsMcpServer } from "../RooToolsMcpServer"
import * as toolExecutors from "../tool-executors"
import { RooIgnoreController } from "../../../core/ignore/RooIgnoreController"

describe("RooToolsMcpServer — body size limit", () => {
	it("MAX_BODY_SIZE is 10 MB", () => {
		const MAX_BODY_SIZE = 10 * 1024 * 1024
		expect(MAX_BODY_SIZE).toBe(10_485_760)
	})

	it("small body should be accepted", () => {
		const smallData = JSON.stringify({ method: "tools/list", params: {} })
		const size = Buffer.byteLength(smallData)
		expect(size).toBeLessThan(10 * 1024 * 1024)
	})

	it("large body should be rejected", () => {
		const hugeData = "x".repeat(11 * 1024 * 1024) // 11MB
		const size = Buffer.byteLength(hugeData)
		expect(size).toBeGreaterThan(10 * 1024 * 1024)
	})
})

describe("RooToolsMcpServer CORS origin", () => {
	beforeAll(() => {
		nock.enableNetConnect("127.0.0.1")
	})

	afterAll(() => {
		nock.disableNetConnect()
	})

	async function startServer(bindAddress: string, authToken?: string) {
		const server = new RooToolsMcpServer({
			workspacePath: process.cwd(),
			port: 0,
			bindAddress,
			authToken,
		})

		await server.start()
		const address = (server as unknown as { httpServer: { address: () => { port: number } } }).httpServer.address()
		return { server, port: address.port }
	}

	/** OPTIONS 请求，使用 Node http 模块绕过 nock 的 fetch 拦截器。 */
	function optionsRequest(host: string, port: number, origin: string): Promise<http.IncomingMessage> {
		return new Promise((resolve, reject) => {
			const req = http.request(
				{ hostname: host, port, path: "/mcp", method: "OPTIONS", headers: { Origin: origin } },
				(res) => resolve(res),
			)
			req.on("error", reject)
			req.end()
		})
	}

	it("allows browser origin only when server is exposed beyond localhost", async () => {
		const { server, port } = await startServer("0.0.0.0", "secret-token")

		try {
			const res = await optionsRequest("127.0.0.1", port, "https://agent.example")
			expect(res.headers["access-control-allow-origin"]).toBe("https://agent.example")
		} finally {
			await server.stop()
		}
	})

	it("uses null origin for localhost-only server", async () => {
		const { server, port } = await startServer("127.0.0.1")

		try {
			const res = await optionsRequest("127.0.0.1", port, "https://agent.example")
			expect(res.headers["access-control-allow-origin"]).toBe("null")
		} finally {
			await server.stop()
		}
	})
})

describe("RooToolsMcpServer — auth comparison", () => {
	function verifyAuth(authHeader: string | undefined, token: string): boolean {
		if (!authHeader) return false
		const expected = `Bearer ${token}`
		if (authHeader.length !== expected.length) return false
		return crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
	}

	it("accepts valid Bearer token", () => {
		expect(verifyAuth("Bearer secret-token", "secret-token")).toBe(true)
	})

	it("rejects wrong token", () => {
		expect(verifyAuth("Bearer wrong-token", "secret-token")).toBe(false)
	})

	it("rejects missing auth header", () => {
		expect(verifyAuth(undefined, "secret-token")).toBe(false)
	})

	it("rejects auth header without Bearer prefix", () => {
		expect(verifyAuth("secret-token", "secret-token")).toBe(false)
	})

	it("rejects tokens of different length — constant-time safe", () => {
		expect(verifyAuth("Bearer short", "very-long-token-value")).toBe(false)
	})
})

describe("RooToolsMcpServer access controllers", () => {
	let clients: Client[]
	let mcpServers: Array<{ close: () => Promise<void> }>

	beforeEach(() => {
		clients = []
		mcpServers = []
	})

	afterEach(async () => {
		await Promise.allSettled(clients.map((client) => client.close()))
		await Promise.allSettled(mcpServers.map((server) => server.close()))
		vi.restoreAllMocks()
	})

	function createServer(overrides: Record<string, unknown> = {}): RooToolsMcpServer {
		return new RooToolsMcpServer({
			workspacePath: process.cwd(),
			port: 0,
			bindAddress: "127.0.0.1",
			...overrides,
		} as unknown as ConstructorParameters<typeof RooToolsMcpServer>[0])
	}

	async function connectClient(server: RooToolsMcpServer): Promise<Client> {
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
		const mcpServer = (
			server as unknown as {
				createMcpServer: (getSessionId: () => string | undefined) => {
					connect: (transport: InMemoryTransport) => Promise<void>
					close: () => Promise<void>
				}
			}
		).createMcpServer(() => "test-session")
		await mcpServer.connect(serverTransport)
		mcpServers.push(mcpServer)

		const client = new Client({ name: "access-control-test", version: "1.0.0" }, { capabilities: {} })
		await client.connect(clientTransport)
		clients.push(client)
		return client
	}

	function getText(result: Awaited<ReturnType<Client["callTool"]>>): string {
		const textContent = result.content.find((content) => content.type === "text")
		return textContent?.type === "text" ? textContent.text : ""
	}

	it("rejects every direct file tool when .rooignore denies the requested path", async () => {
		const pathValidator = {
			validateAccess: vi.fn(() => false),
			validateCommand: vi.fn(() => undefined),
		}
		vi.spyOn(toolExecutors, "execReadFile").mockResolvedValue("read")
		vi.spyOn(toolExecutors, "execWriteFile").mockResolvedValue("written")
		vi.spyOn(toolExecutors, "execListFiles").mockResolvedValue("listed")
		vi.spyOn(toolExecutors, "execSearchFiles").mockResolvedValue("searched")
		vi.spyOn(toolExecutors, "execApplyDiff").mockResolvedValue("applied")

		const client = await connectClient(createServer({ pathValidator }))
		const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [
			{ name: "read_file", arguments: { path: "blocked.txt" } },
			{ name: "write_to_file", arguments: { path: "blocked.txt", content: "new" } },
			{ name: "list_files", arguments: { path: "blocked" } },
			{ name: "search_files", arguments: { path: "blocked", regex: "secret" } },
			{
				name: "apply_diff",
				arguments: { path: "blocked.txt", diff: "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE" },
			},
		]

		for (const call of calls) {
			const result = await client.callTool(call)
			expect(result.isError).toBe(true)
			expect(getText(result)).toContain(`Access denied by .rooignore: ${call.arguments.path}`)
		}

		expect(pathValidator.validateAccess).toHaveBeenCalledTimes(calls.length)
		expect(toolExecutors.execReadFile).not.toHaveBeenCalled()
		expect(toolExecutors.execWriteFile).not.toHaveBeenCalled()
		expect(toolExecutors.execListFiles).not.toHaveBeenCalled()
		expect(toolExecutors.execSearchFiles).not.toHaveBeenCalled()
		expect(toolExecutors.execApplyDiff).not.toHaveBeenCalled()
	})

	it("passes the path validator through for nested list and search filtering", async () => {
		const pathValidator = {
			validateAccess: vi.fn(() => true),
			validateCommand: vi.fn(() => undefined),
		}
		const listFiles = vi.spyOn(toolExecutors, "execListFiles").mockResolvedValue("listed")
		const searchFiles = vi.spyOn(toolExecutors, "execSearchFiles").mockResolvedValue("searched")
		const client = await connectClient(createServer({ pathValidator }))

		await client.callTool({ name: "list_files", arguments: { path: "src", recursive: true } })
		await client.callTool({ name: "search_files", arguments: { path: "src", regex: "needle" } })

		expect(listFiles).toHaveBeenCalledWith(
			process.cwd(),
			{ path: "src", recursive: true },
			pathValidator,
			expect.anything(),
		)
		expect(searchFiles).toHaveBeenCalledWith(
			process.cwd(),
			{ path: "src", regex: "needle" },
			pathValidator,
			expect.anything(),
		)
	})

	it("rejects protected writes and diffs before invoking an executor", async () => {
		const pathValidator = {
			validateAccess: vi.fn(() => true),
			validateCommand: vi.fn(() => undefined),
		}
		const writeProtector = { isWriteProtected: vi.fn(async () => true) }
		vi.spyOn(toolExecutors, "execWriteFile").mockResolvedValue("written")
		vi.spyOn(toolExecutors, "execApplyDiff").mockResolvedValue("applied")
		const client = await connectClient(createServer({ pathValidator, protectedController: writeProtector }))

		const writeResult = await client.callTool({
			name: "write_to_file",
			arguments: { path: "AGENTS.md", content: "new" },
		})
		const diffResult = await client.callTool({
			name: "apply_diff",
			arguments: { path: "AGENTS.md", diff: "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE" },
		})

		expect(writeResult.isError).toBe(true)
		expect(getText(writeResult)).toContain("Write protected: AGENTS.md")
		expect(diffResult.isError).toBe(true)
		expect(getText(diffResult)).toContain("Write protected: AGENTS.md")
		expect(writeProtector.isWriteProtected).toHaveBeenCalledTimes(2)
		expect(toolExecutors.execWriteFile).not.toHaveBeenCalled()
		expect(toolExecutors.execApplyDiff).not.toHaveBeenCalled()
	})

	it("rejects commands that reference a .rooignore-protected path", async () => {
		const pathValidator = {
			validateAccess: vi.fn(() => true),
			validateCommand: vi.fn(() => "blocked.txt"),
		}
		const executeCommand = vi.spyOn(toolExecutors, "execCommand").mockResolvedValue("executed")
		const client = await connectClient(createServer({ pathValidator, allowedCommands: ["cat"] }))

		const result = await client.callTool({
			name: "execute_command",
			arguments: { command: "cat blocked.txt" },
		})

		expect(result.isError).toBe(true)
		expect(getText(result)).toContain("Access denied by .rooignore: blocked.txt")
		expect(pathValidator.validateCommand).toHaveBeenCalledWith("cat blocked.txt")
		expect(executeCommand).not.toHaveBeenCalled()
	})

	it("initializes and disposes the default .rooignore controller", async () => {
		const initialize = vi.spyOn(RooIgnoreController.prototype, "initialize").mockResolvedValue(undefined)
		const dispose = vi.spyOn(RooIgnoreController.prototype, "dispose")
		const server = createServer()

		await server.start()
		try {
			expect(initialize).toHaveBeenCalledOnce()
			expect((server as unknown as { pathValidator?: unknown }).pathValidator).toBeInstanceOf(RooIgnoreController)
		} finally {
			await server.stop()
		}

		expect(dispose).toHaveBeenCalledOnce()
	})

	it("atomically replaces owned controllers when the workspace changes", async () => {
		vi.spyOn(RooIgnoreController.prototype, "initialize").mockResolvedValue(undefined)
		const dispose = vi.spyOn(RooIgnoreController.prototype, "dispose")
		const server = createServer()
		await server.start()
		const firstController = (server as unknown as { pathValidator?: unknown }).pathValidator

		try {
			await server.updateWorkspacePath(path.join(process.cwd(), "src"))
			const nextController = (server as unknown as { pathValidator?: unknown }).pathValidator
			expect(nextController).toBeInstanceOf(RooIgnoreController)
			expect(nextController).not.toBe(firstController)
			expect(dispose).toHaveBeenCalledOnce()
		} finally {
			await server.stop()
		}

		expect(dispose).toHaveBeenCalledTimes(2)
	})

	it("does not dispose an externally injected path validator", async () => {
		const pathValidator = {
			validateAccess: vi.fn(() => true),
			validateCommand: vi.fn(() => undefined),
			dispose: vi.fn(),
		}
		const protectedController = { isWriteProtected: vi.fn(async () => false), dispose: vi.fn() }
		const server = createServer({ pathValidator, protectedController })

		await server.start()
		await server.stop()

		expect(pathValidator.dispose).not.toHaveBeenCalled()
		expect(protectedController.dispose).not.toHaveBeenCalled()
	})
})
