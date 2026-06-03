import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
	},
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn(function (this: any) {
		this.connect = vi.fn().mockResolvedValue(undefined)
		this.getInstructions = vi.fn().mockReturnValue("test instructions")
	}),
}))

vi.mock("../../../utils/config", () => ({
	injectVariables: vi.fn().mockImplementation((config) => Promise.resolve(config)),
}))

vi.mock("../../../utils/mcp-name", () => ({
	sanitizeMcpName: vi.fn().mockImplementation((name: string) => name.toLowerCase().replace(/\s+/g, "_")),
}))

vi.mock("../../../shared/logger", () => ({
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
	},
}))

vi.mock("../transport/TransportFactory", () => ({
	TransportFactory: vi.fn(function (this: any) {
		this.create = vi.fn().mockResolvedValue({
			start: vi.fn().mockResolvedValue(undefined),
			close: vi.fn().mockResolvedValue(undefined),
			stderr: {
				on: vi.fn(),
			},
		})
	}),
}))

import type { McpConnection } from "../McpHub"
import { connectToServerWithHub, appendErrorMessageToConnection } from "../McpHubConnection"

function createMockHub() {
	return {
		connections: [] as McpConnection[],
		sanitizedNameRegistry: new Map<string, string>(),
		providerRef: { deref: () => ({ getExtensionPackageVersion: () => "1.0.0" }) },
		isMcpEnabled: vi.fn().mockResolvedValue(true),
		deleteConnection: vi.fn().mockResolvedValue(undefined),
		findConnection: vi.fn().mockReturnValue(undefined),
		createPlaceholderConnection: vi
			.fn()
			.mockImplementation((name: string, config: unknown, source: string, reason: string) => ({
				type: "disconnected" as const,
				server: {
					name,
					config: JSON.stringify(config),
					status: "disconnected" as const,
					disabled: reason === "serverDisabled",
					source: source as "global" | "project",
					errorHistory: [],
				},
				client: null,
				transport: null,
			})),
		setupFileWatcher: vi.fn(),
		removeFileWatchersForServer: vi.fn(),
		connectToServer: vi.fn().mockResolvedValue(undefined),
		notifyWebviewOfServerChanges: vi.fn().mockResolvedValue(undefined),
		fetchToolsList: vi.fn().mockResolvedValue([]),
		fetchResourcesList: vi.fn().mockResolvedValue([]),
		fetchResourceTemplatesList: vi.fn().mockResolvedValue([]),
		showErrorMessage: vi.fn(),
		getProjectMcpPath: vi.fn().mockResolvedValue("/project/.roo/mcp.json"),
		getMcpSettingsFilePath: vi.fn().mockResolvedValue("/global/mcp_settings.json"),
		validateServerConfig: vi.fn((config: unknown) => config),
		setProgrammaticUpdateFlag: vi.fn(),
		scheduleProgrammaticUpdateFlagReset: vi.fn(),
		updateServerConnections: vi.fn().mockResolvedValue(undefined),
	}
}

describe("McpHubConnection", () => {
	let hub: ReturnType<typeof createMockHub>

	beforeEach(() => {
		vi.clearAllMocks()
		hub = createMockHub()
	})

	describe("connectToServerWithHub", () => {
		const stdioConfig = {
			type: "stdio" as const,
			command: "node",
			args: ["server.js"],
			cwd: "/workspace",
			disabled: false,
			timeout: 60,
			alwaysAllow: [],
			disabledTools: [],
		}

		it("should delete existing connection before creating new one", async () => {
			await connectToServerWithHub(hub, "testServer", stdioConfig)

			expect(hub.deleteConnection).toHaveBeenCalledWith("testServer", "global")
		})

		it("should register sanitized name", async () => {
			await connectToServerWithHub(hub, "testServer", stdioConfig)

			expect(hub.sanitizedNameRegistry.has("testserver")).toBe(true)
			expect(hub.sanitizedNameRegistry.get("testserver")).toBe("testServer")
		})

		it("should create placeholder connection when MCP is disabled", async () => {
			vi.mocked(hub.isMcpEnabled).mockResolvedValue(false)

			await connectToServerWithHub(hub, "testServer", stdioConfig)

			expect(hub.createPlaceholderConnection).toHaveBeenCalledWith(
				"testServer",
				stdioConfig,
				"global",
				"mcpDisabled",
			)
			expect(hub.connections).toHaveLength(1)
		})

		it("should create placeholder connection when server is disabled", async () => {
			const disabledConfig = { ...stdioConfig, disabled: true }

			await connectToServerWithHub(hub, "testServer", disabledConfig)

			expect(hub.createPlaceholderConnection).toHaveBeenCalledWith(
				"testServer",
				disabledConfig,
				"global",
				"serverDisabled",
			)
			expect(hub.connections).toHaveLength(1)
		})

		it("should set up file watcher for enabled servers", async () => {
			await connectToServerWithHub(hub, "testServer", stdioConfig)

			expect(hub.setupFileWatcher).toHaveBeenCalledWith("testServer", stdioConfig, "global")
		})

		it("should create connected connection on success", async () => {
			await connectToServerWithHub(hub, "testServer", stdioConfig)

			expect(hub.connections).toHaveLength(1)
			const connection = hub.connections[0]
			expect(connection.server.name).toBe("testServer")
			expect(connection.server.status).toBe("connected")
			expect(connection.server.source).toBe("global")
		})

		it("should fetch tools, resources, and resource templates after connect", async () => {
			await connectToServerWithHub(hub, "testServer", stdioConfig)

			expect(hub.fetchToolsList).toHaveBeenCalledWith("testServer", "global")
			expect(hub.fetchResourcesList).toHaveBeenCalledWith("testServer", "global")
			expect(hub.fetchResourceTemplatesList).toHaveBeenCalledWith("testServer", "global")
		})

		it("should set instructions from client after connect", async () => {
			await connectToServerWithHub(hub, "testServer", stdioConfig)

			const connection = hub.connections[0]
			expect(connection.server.instructions).toBe("test instructions")
		})

		it("should update connection to disconnected on connect failure", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js")
			vi.mocked(Client).mockImplementationOnce(function (this: any) {
				this.connect = vi.fn().mockRejectedValue(new Error("connection refused"))
				this.getInstructions = vi.fn().mockReturnValue("")
			} as any)

			// After the failed connect, findConnection should return the pushed connection
			hub.findConnection = vi.fn().mockImplementation(() => {
				return hub.connections[0]
			})

			await expect(connectToServerWithHub(hub, "testServer", stdioConfig)).rejects.toThrow("connection refused")

			const connection = hub.connections[0]
			expect(connection.server.status).toBe("disconnected")
		})

		it("should set project path when source is project", async () => {
			await connectToServerWithHub(hub, "testServer", stdioConfig, "project")

			const connection = hub.connections[0]
			expect(connection.server.projectPath).toBe("/workspace")
		})

		it("should not set project path when source is global", async () => {
			await connectToServerWithHub(hub, "testServer", stdioConfig, "global")

			const connection = hub.connections[0]
			expect(connection.server.projectPath).toBeUndefined()
		})

		it("should initialize error history as empty", async () => {
			await connectToServerWithHub(hub, "testServer", stdioConfig)

			const connection = hub.connections[0]
			expect(connection.server.errorHistory).toEqual([])
		})
	})

	describe("appendErrorMessageToConnection", () => {
		it("should append error message to connection", () => {
			const connection: McpConnection = {
				type: "disconnected",
				server: {
					name: "testServer",
					config: "{}",
					status: "disconnected",
					disabled: false,
					source: "global",
					errorHistory: [],
				},
				client: null,
				transport: null,
			}

			appendErrorMessageToConnection(connection, "something went wrong")

			expect(connection.server.error).toBe("something went wrong")
			expect(connection.server.errorHistory).toHaveLength(1)
			expect(connection.server.errorHistory![0].message).toBe("something went wrong")
			expect(connection.server.errorHistory![0].level).toBe("error")
		})

		it("should truncate long error messages", () => {
			const connection: McpConnection = {
				type: "disconnected",
				server: {
					name: "testServer",
					config: "{}",
					status: "disconnected",
					disabled: false,
					source: "global",
					errorHistory: [],
				},
				client: null,
				transport: null,
			}

			const longMessage = "x".repeat(1500)
			appendErrorMessageToConnection(connection, longMessage)

			expect(connection.server.error!.length).toBeLessThan(1500)
			expect(connection.server.error).toContain("...(error message truncated)")
		})

		it("should keep only the last 100 errors", () => {
			const connection: McpConnection = {
				type: "disconnected",
				server: {
					name: "testServer",
					config: "{}",
					status: "disconnected",
					disabled: false,
					source: "global",
					errorHistory: Array.from({ length: 99 }, (_, i) => ({
						message: `error ${i}`,
						timestamp: Date.now(),
						level: "error" as const,
					})),
				},
				client: null,
				transport: null,
			}

			appendErrorMessageToConnection(connection, "error 99")
			expect(connection.server.errorHistory).toHaveLength(100)

			appendErrorMessageToConnection(connection, "error 100")
			expect(connection.server.errorHistory).toHaveLength(100)
			expect(connection.server.errorHistory![0].message).toBe("error 1")
		})

		it("should initialize error history if it does not exist", () => {
			const connection: McpConnection = {
				type: "disconnected",
				server: {
					name: "testServer",
					config: "{}",
					status: "disconnected",
					disabled: false,
					source: "global",
				} as any,
				client: null,
				transport: null,
			}

			appendErrorMessageToConnection(connection, "first error")

			expect(connection.server.errorHistory).toHaveLength(1)
		})

		it("should accept custom error level", () => {
			const connection: McpConnection = {
				type: "disconnected",
				server: {
					name: "testServer",
					config: "{}",
					status: "disconnected",
					disabled: false,
					source: "global",
					errorHistory: [],
				},
				client: null,
				transport: null,
			}

			appendErrorMessageToConnection(connection, "warning message", "warn")

			expect(connection.server.errorHistory![0].level).toBe("warn")
		})

		it("should include timestamp in error history entries", () => {
			const connection: McpConnection = {
				type: "disconnected",
				server: {
					name: "testServer",
					config: "{}",
					status: "disconnected",
					disabled: false,
					source: "global",
					errorHistory: [],
				},
				client: null,
				transport: null,
			}

			const before = Date.now()
			appendErrorMessageToConnection(connection, "timed error")
			const after = Date.now()

			const timestamp = connection.server.errorHistory![0].timestamp
			expect(timestamp).toBeGreaterThanOrEqual(before)
			expect(timestamp).toBeLessThanOrEqual(after)
		})
	})
})
