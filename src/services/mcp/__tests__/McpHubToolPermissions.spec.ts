import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "fs/promises"

vi.mock("fs/promises", () => ({
	access: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue("{}"),
	writeFile: vi.fn().mockResolvedValue(undefined),
	mkdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../shared/logger", () => ({
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
		UTILITY_ERROR: "utility_error",
	},
}))

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
	ListToolsResultSchema: {},
	ListResourcesResultSchema: {},
}))

import { safeWriteJson } from "../../../utils/safeWriteJson"
import {
	fetchToolsListWithHub,
	fetchResourcesListWithHub,
	updateServerToolListWithHub,
	toggleToolAlwaysAllowWithHub,
	toggleToolEnabledForPromptWithHub,
} from "../McpHubToolPermissions"

function createMockHub() {
	return {
		connections: [],
		sanitizedNameRegistry: new Map(),
		providerRef: { deref: () => ({ getExtensionPackageVersion: () => "1.0.0" }) },
		isMcpEnabled: vi.fn().mockResolvedValue(true),
		deleteConnection: vi.fn().mockResolvedValue(undefined),
		findConnection: vi.fn().mockReturnValue(undefined),
		createPlaceholderConnection: vi.fn(),
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

function createConnectedConnection(
	hub: ReturnType<typeof createMockHub>,
	serverName: string,
	source: "global" | "project" = "global",
) {
	const connection = {
		type: "connected" as const,
		server: {
			name: serverName,
			config: "{}",
			status: "connected" as const,
			disabled: false,
			source,
			errorHistory: [],
		},
		client: {
			request: vi.fn().mockResolvedValue({
				tools: [
					{ name: "read_file", description: "Read a file", inputSchema: {} },
					{ name: "write_to_file", description: "Write a file", inputSchema: {} },
					{ name: "custom_tool", description: "Custom tool", inputSchema: {} },
				],
			}),
		} as any,
		transport: {} as any,
	}
	vi.mocked(hub.findConnection).mockReturnValue(connection)
	return connection
}

describe("McpHubToolPermissions", () => {
	let hub: ReturnType<typeof createMockHub>

	beforeEach(() => {
		vi.clearAllMocks()
		hub = createMockHub()
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({
				mcpServers: {
					testServer: {
						type: "stdio",
						command: "node",
						alwaysAllow: [],
						disabledTools: [],
					},
				},
			}),
		)
	})

	describe("fetchToolsListWithHub", () => {
		it("should return empty array when connection is not found", async () => {
			vi.mocked(hub.findConnection).mockReturnValue(undefined)

			const result = await fetchToolsListWithHub(hub, "unknownServer")

			expect(result).toEqual([])
		})

		it("should return empty array when connection is not connected type", async () => {
			const disconnected = {
				type: "disconnected" as const,
				server: {
					name: "testServer",
					config: "{}",
					status: "disconnected" as const,
					disabled: false,
					source: "global" as const,
					errorHistory: [],
				},
				client: null,
				transport: null,
			}
			vi.mocked(hub.findConnection).mockReturnValue(disconnected)

			const result = await fetchToolsListWithHub(hub, "testServer")

			expect(result).toEqual([])
		})

		it("should return tools list with alwaysAllow and enabledForPrompt flags", async () => {
			createConnectedConnection(hub, "testServer")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						testServer: {
							alwaysAllow: ["custom_tool"],
							disabledTools: ["write_to_file"],
						},
					},
				}),
			)

			const tools = await fetchToolsListWithHub(hub, "testServer")

			expect(tools).toHaveLength(3)

			const readFileTool = tools.find((t) => t.name === "read_file")
			expect(readFileTool?.alwaysAllow).toBe(false)
			expect(readFileTool?.enabledForPrompt).toBe(true)

			const writeTool = tools.find((t) => t.name === "write_to_file")
			expect(writeTool?.alwaysAllow).toBe(false)
			expect(writeTool?.enabledForPrompt).toBe(false)

			const customTool = tools.find((t) => t.name === "custom_tool")
			expect(customTool?.alwaysAllow).toBe(true)
			expect(customTool?.enabledForPrompt).toBe(true)
		})

		it("should handle wildcard '*' in alwaysAllow but deny high-risk tools", async () => {
			createConnectedConnection(hub, "testServer")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						testServer: {
							alwaysAllow: ["*"],
							disabledTools: [],
						},
					},
				}),
			)

			const tools = await fetchToolsListWithHub(hub, "testServer")

			const readFileTool = tools.find((t) => t.name === "read_file")
			expect(readFileTool?.alwaysAllow).toBe(true)

			// write_to_file is in WILDCARD_DENY_TOOLS
			const writeTool = tools.find((t) => t.name === "write_to_file")
			expect(writeTool?.alwaysAllow).toBe(false)
		})

		it("should allow high-risk tools when explicitly listed in alwaysAllow", async () => {
			createConnectedConnection(hub, "testServer")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						testServer: {
							alwaysAllow: ["write_to_file"],
							disabledTools: [],
						},
					},
				}),
			)

			const tools = await fetchToolsListWithHub(hub, "testServer")

			const writeTool = tools.find((t) => t.name === "write_to_file")
			expect(writeTool?.alwaysAllow).toBe(true)
		})

		it("should read project config when source is project", async () => {
			createConnectedConnection(hub, "testServer", "project")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: {
						testServer: { alwaysAllow: [], disabledTools: [] },
					},
				}),
			)

			await fetchToolsListWithHub(hub, "testServer", "project")

			expect(hub.getProjectMcpPath).toHaveBeenCalled()
		})

		it("should truncate tools list when exceeding MAX_MCP_TOOLS_PER_SERVER", async () => {
			const connection = {
				type: "connected" as const,
				server: {
					name: "testServer",
					config: "{}",
					status: "connected" as const,
					disabled: false,
					source: "global" as const,
					errorHistory: [],
				},
				client: {
					request: vi.fn().mockResolvedValue({
						tools: Array.from({ length: 1001 }, (_, i) => ({
							name: `tool_${i}`,
							description: `Tool ${i}`,
							inputSchema: {},
						})),
					}),
				} as any,
				transport: {} as any,
			}
			vi.mocked(hub.findConnection).mockReturnValue(connection)

			const tools = await fetchToolsListWithHub(hub, "testServer")

			expect(tools).toHaveLength(1000)
		})

		it("should return empty array on error", async () => {
			const connection = createConnectedConnection(hub, "testServer")
			vi.mocked(connection.client.request).mockRejectedValue(new Error("request failed"))

			const result = await fetchToolsListWithHub(hub, "testServer")

			expect(result).toEqual([])
		})
	})

	describe("fetchResourcesListWithHub", () => {
		it("should return empty array when connection is not found", async () => {
			vi.mocked(hub.findConnection).mockReturnValue(undefined)

			const result = await fetchResourcesListWithHub(hub, "unknownServer")

			expect(result).toEqual([])
		})

		it("should return empty array when connection is disconnected", async () => {
			const disconnected = {
				type: "disconnected" as const,
				server: {
					name: "testServer",
					config: "{}",
					status: "disconnected" as const,
					disabled: false,
					source: "global" as const,
					errorHistory: [],
				},
				client: null,
				transport: null,
			}
			vi.mocked(hub.findConnection).mockReturnValue(disconnected)

			const result = await fetchResourcesListWithHub(hub, "testServer")

			expect(result).toEqual([])
		})

		it("should return resources list from connected server", async () => {
			const connection = createConnectedConnection(hub, "testServer")
			const mockResources = [{ uri: "file:///test.txt", name: "test.txt" }]
			vi.mocked(connection.client.request).mockResolvedValue({ resources: mockResources })

			const result = await fetchResourcesListWithHub(hub, "testServer")

			expect(result).toEqual(mockResources)
		})

		it("should return empty array on error", async () => {
			const connection = createConnectedConnection(hub, "testServer")
			vi.mocked(connection.client.request).mockRejectedValue(new Error("request failed"))

			const result = await fetchResourcesListWithHub(hub, "testServer")

			expect(result).toEqual([])
		})
	})

	describe("updateServerToolListWithHub", () => {
		it("should throw when server is not found", async () => {
			vi.mocked(hub.findConnection).mockReturnValue(undefined)

			await expect(
				updateServerToolListWithHub(hub, "unknown", "global", "tool1", "alwaysAllow", true),
			).rejects.toThrow("Server unknown with source global not found")
		})

		it("should add a tool to alwaysAllow list", async () => {
			createConnectedConnection(hub, "testServer", "global")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { alwaysAllow: [] } },
				}),
			)

			await updateServerToolListWithHub(hub, "testServer", "global", "custom_tool", "alwaysAllow", true)

			expect(safeWriteJson).toHaveBeenCalled()
			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(writtenData.mcpServers.testServer.alwaysAllow).toContain("custom_tool")
		})

		it("should remove a tool from alwaysAllow list", async () => {
			createConnectedConnection(hub, "testServer", "global")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { alwaysAllow: ["custom_tool", "other_tool"] } },
				}),
			)

			await updateServerToolListWithHub(hub, "testServer", "global", "custom_tool", "alwaysAllow", false)

			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(writtenData.mcpServers.testServer.alwaysAllow).not.toContain("custom_tool")
			expect(writtenData.mcpServers.testServer.alwaysAllow).toContain("other_tool")
		})

		it("should add a tool to disabledTools list", async () => {
			createConnectedConnection(hub, "testServer", "global")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { disabledTools: [] } },
				}),
			)

			await updateServerToolListWithHub(hub, "testServer", "global", "dangerous_tool", "disabledTools", true)

			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(writtenData.mcpServers.testServer.disabledTools).toContain("dangerous_tool")
		})

		it("should not add duplicate tools", async () => {
			createConnectedConnection(hub, "testServer", "global")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { alwaysAllow: ["existing_tool"] } },
				}),
			)

			await updateServerToolListWithHub(hub, "testServer", "global", "existing_tool", "alwaysAllow", true)

			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(
				writtenData.mcpServers.testServer.alwaysAllow.filter((t: string) => t === "existing_tool"),
			).toHaveLength(1)
		})

		it("should use project config path for project source", async () => {
			createConnectedConnection(hub, "testServer", "project")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { alwaysAllow: [] } },
				}),
			)

			await updateServerToolListWithHub(hub, "testServer", "project", "tool1", "alwaysAllow", true)

			expect(hub.getProjectMcpPath).toHaveBeenCalled()
		})

		it("should throw when project MCP path is not found", async () => {
			createConnectedConnection(hub, "testServer", "project")
			vi.mocked(hub.getProjectMcpPath).mockResolvedValue("")

			await expect(
				updateServerToolListWithHub(hub, "testServer", "project", "tool1", "alwaysAllow", true),
			).rejects.toThrow("Project MCP configuration file not found")
		})

		it("should create server entry with defaults if not in config", async () => {
			createConnectedConnection(hub, "testServer", "global")
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ mcpServers: {} }))

			await updateServerToolListWithHub(hub, "testServer", "global", "new_tool", "alwaysAllow", true)

			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(writtenData.mcpServers.testServer).toBeDefined()
			expect(writtenData.mcpServers.testServer.alwaysAllow).toContain("new_tool")
		})

		it("should refresh tools and notify webview after update", async () => {
			createConnectedConnection(hub, "testServer", "global")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { alwaysAllow: [] } },
				}),
			)

			await updateServerToolListWithHub(hub, "testServer", "global", "tool1", "alwaysAllow", true)

			expect(hub.notifyWebviewOfServerChanges).toHaveBeenCalled()
		})

		it("should set and reset programmatic update flag", async () => {
			createConnectedConnection(hub, "testServer", "global")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { alwaysAllow: [] } },
				}),
			)

			await updateServerToolListWithHub(hub, "testServer", "global", "tool1", "alwaysAllow", true)

			expect(hub.setProgrammaticUpdateFlag).toHaveBeenCalled()
			expect(hub.scheduleProgrammaticUpdateFlagReset).toHaveBeenCalled()
		})
	})

	describe("toggleToolAlwaysAllowWithHub", () => {
		it("should call updateServerToolListWithHub with alwaysAllow list", async () => {
			createConnectedConnection(hub, "testServer", "global")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { alwaysAllow: [] } },
				}),
			)

			await toggleToolAlwaysAllowWithHub(hub, "testServer", "global", "my_tool", true)

			expect(safeWriteJson).toHaveBeenCalled()
		})

		it("should show error message and rethrow on failure", async () => {
			vi.mocked(hub.findConnection).mockReturnValue(undefined)

			await expect(toggleToolAlwaysAllowWithHub(hub, "unknown", "global", "my_tool", true)).rejects.toThrow()

			expect(hub.showErrorMessage).toHaveBeenCalled()
		})
	})

	describe("toggleToolEnabledForPromptWithHub", () => {
		it("should add tool to disabledTools when isEnabled is false", async () => {
			createConnectedConnection(hub, "testServer", "global")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { disabledTools: [] } },
				}),
			)

			await toggleToolEnabledForPromptWithHub(hub, "testServer", "global", "my_tool", false)

			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(writtenData.mcpServers.testServer.disabledTools).toContain("my_tool")
		})

		it("should remove tool from disabledTools when isEnabled is true", async () => {
			createConnectedConnection(hub, "testServer", "global")
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { disabledTools: ["my_tool", "other_tool"] } },
				}),
			)

			await toggleToolEnabledForPromptWithHub(hub, "testServer", "global", "my_tool", true)

			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(writtenData.mcpServers.testServer.disabledTools).not.toContain("my_tool")
			expect(writtenData.mcpServers.testServer.disabledTools).toContain("other_tool")
		})

		it("should show error message and rethrow on failure", async () => {
			vi.mocked(hub.findConnection).mockReturnValue(undefined)

			await expect(toggleToolEnabledForPromptWithHub(hub, "unknown", "global", "my_tool", true)).rejects.toThrow()

			expect(hub.showErrorMessage).toHaveBeenCalled()
		})
	})
})
