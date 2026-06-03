import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "fs/promises"

import type { McpHubInternal } from "../McpHub"

vi.mock("fs/promises", () => ({
	access: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue("{}"),
	writeFile: vi.fn().mockResolvedValue(undefined),
	mkdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("vscode", () => ({
	window: {
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
	},
}))

vi.mock("../../../i18n", () => ({
	t: (key: string, vars?: Record<string, string>) => {
		if (vars) return `${key}:${JSON.stringify(vars)}`
		return key
	},
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

import { safeWriteJson } from "../../../utils/safeWriteJson"
import {
	toggleServerDisabledWithHub,
	readServerConfigFromFileWithHub,
	updateServerConfigWithHub,
	updateServerTimeoutWithHub,
	deleteServerWithHub,
} from "../McpHubConfigPersistence"

function createMockHub(): McpHubInternal {
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

describe("McpHubConfigPersistence", () => {
	let hub: McpHubInternal

	beforeEach(() => {
		vi.clearAllMocks()
		hub = createMockHub()
		vi.mocked(safeWriteJson).mockResolvedValue(undefined)
		vi.mocked(fs.access).mockResolvedValue(undefined)
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({
				mcpServers: {
					testServer: {
						type: "stdio",
						command: "node",
						args: ["server.js"],
						alwaysAllow: [],
					},
				},
			}),
		)
	})

	describe("readServerConfigFromFileWithHub", () => {
		it("should read global server config by default", async () => {
			const result = await readServerConfigFromFileWithHub(hub, "testServer")

			expect(hub.getMcpSettingsFilePath).toHaveBeenCalled()
			expect(fs.readFile).toHaveBeenCalledWith("/global/mcp_settings.json", "utf-8")
			expect(hub.validateServerConfig).toHaveBeenCalled()
			expect(result).toBeDefined()
		})

		it("should read project server config when source is project", async () => {
			await readServerConfigFromFileWithHub(hub, "testServer", "project")

			expect(hub.getProjectMcpPath).toHaveBeenCalled()
			expect(fs.readFile).toHaveBeenCalledWith("/project/.roo/mcp.json", "utf-8")
		})

		it("should throw when project MCP path is not found", async () => {
			vi.mocked(hub.getProjectMcpPath).mockResolvedValue("")

			await expect(readServerConfigFromFileWithHub(hub, "testServer", "project")).rejects.toThrow(
				"Project MCP configuration file not found",
			)
		})

		it("should throw when settings file is not accessible", async () => {
			vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"))

			await expect(readServerConfigFromFileWithHub(hub, "testServer")).rejects.toThrow(
				"Settings file not accessible",
			)
		})

		it("should throw when config is not an object", async () => {
			vi.mocked(fs.readFile).mockResolvedValue('"just a string"')

			await expect(readServerConfigFromFileWithHub(hub, "testServer")).rejects.toThrow("Invalid config structure")
		})

		it("should throw when mcpServers section is missing", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ otherKey: {} }))

			await expect(readServerConfigFromFileWithHub(hub, "testServer")).rejects.toThrow(
				"No mcpServers section in config",
			)
		})

		it("should throw when server is not found in config", async () => {
			await expect(readServerConfigFromFileWithHub(hub, "nonexistentServer")).rejects.toThrow(
				"Server nonexistentServer not found in config",
			)
		})

		it("should validate server config before returning", async () => {
			const validated = { type: "stdio", command: "node", valid: true }
			vi.mocked(hub.validateServerConfig).mockReturnValue(validated as any)

			const result = await readServerConfigFromFileWithHub(hub, "testServer")

			expect(hub.validateServerConfig).toHaveBeenCalled()
			expect(result).toEqual(validated)
		})
	})

	describe("updateServerConfigWithHub", () => {
		it("should update global config by default", async () => {
			await updateServerConfigWithHub(hub, "testServer", { disabled: true })

			expect(hub.getMcpSettingsFilePath).toHaveBeenCalled()
			expect(hub.setProgrammaticUpdateFlag).toHaveBeenCalled()
			expect(safeWriteJson).toHaveBeenCalled()
			expect(hub.scheduleProgrammaticUpdateFlagReset).toHaveBeenCalled()
		})

		it("should update project config when source is project", async () => {
			await updateServerConfigWithHub(hub, "testServer", { disabled: true }, "project")

			expect(hub.getProjectMcpPath).toHaveBeenCalled()
			expect(safeWriteJson).toHaveBeenCalledWith(
				"/project/.roo/mcp.json",
				expect.objectContaining({ mcpServers: expect.any(Object) }),
				{ prettyPrint: true },
			)
		})

		it("should merge config update with existing server config", async () => {
			await updateServerConfigWithHub(hub, "testServer", { timeout: 120 })

			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(writtenData.mcpServers.testServer.timeout).toBe(120)
			expect(writtenData.mcpServers.testServer.command).toBe("node")
		})

		it("should create server entry if it does not exist", async () => {
			await updateServerConfigWithHub(hub, "newServer", { disabled: true })

			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(writtenData.mcpServers.newServer).toBeDefined()
			expect(writtenData.mcpServers.newServer.disabled).toBe(true)
		})

		it("should create mcpServers section if missing", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({}))

			await updateServerConfigWithHub(hub, "testServer", { disabled: true })

			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(writtenData.mcpServers).toBeDefined()
		})

		it("should ensure alwaysAllow defaults to empty array", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({
					mcpServers: { testServer: { command: "node" } },
				}),
			)

			await updateServerConfigWithHub(hub, "testServer", { timeout: 30 })

			const writtenData = vi.mocked(safeWriteJson).mock.calls[0][1]
			expect(writtenData.mcpServers.testServer.alwaysAllow).toEqual([])
		})

		it("should throw when settings file is not accessible", async () => {
			vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"))

			await expect(updateServerConfigWithHub(hub, "testServer", { disabled: true })).rejects.toThrow(
				"Settings file not accessible",
			)
		})

		it("should throw when config is invalid", async () => {
			vi.mocked(fs.readFile).mockResolvedValue("null")

			await expect(updateServerConfigWithHub(hub, "testServer", { disabled: true })).rejects.toThrow(
				"Invalid config structure",
			)
		})

		it("should reset programmatic update flag even on write failure", async () => {
			vi.mocked(safeWriteJson).mockRejectedValue(new Error("write failed"))

			await expect(updateServerConfigWithHub(hub, "testServer", { disabled: true })).rejects.toThrow(
				"write failed",
			)

			expect(hub.scheduleProgrammaticUpdateFlagReset).toHaveBeenCalled()
		})

		it("should throw when project MCP path is not found", async () => {
			vi.mocked(hub.getProjectMcpPath).mockResolvedValue("")

			await expect(updateServerConfigWithHub(hub, "testServer", { disabled: true }, "project")).rejects.toThrow(
				"Project MCP configuration file not found",
			)
		})
	})

	describe("toggleServerDisabledWithHub", () => {
		it("should throw when server is not found", async () => {
			vi.mocked(hub.findConnection).mockReturnValue(undefined)

			await expect(toggleServerDisabledWithHub(hub, "unknown", true)).rejects.toThrow("Server unknown not found")
			expect(hub.showErrorMessage).toHaveBeenCalled()
		})

		it("should disable a connected server and reconnect as disabled", async () => {
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
				client: {} as any,
				transport: {} as any,
			}
			vi.mocked(hub.findConnection).mockReturnValue(connection)

			await toggleServerDisabledWithHub(hub, "testServer", true)

			expect(hub.removeFileWatchersForServer).toHaveBeenCalledWith("testServer")
			expect(hub.deleteConnection).toHaveBeenCalledWith("testServer", "global")
			expect(hub.connectToServer).toHaveBeenCalled()
			expect(hub.notifyWebviewOfServerChanges).toHaveBeenCalled()
		})

		it("should enable a disabled server and reconnect", async () => {
			const connection = {
				type: "disconnected" as const,
				server: {
					name: "testServer",
					config: "{}",
					status: "disconnected" as const,
					disabled: true,
					source: "global" as const,
					errorHistory: [],
				},
				client: null,
				transport: null,
			}
			vi.mocked(hub.findConnection).mockReturnValue(connection)

			await toggleServerDisabledWithHub(hub, "testServer", false)

			expect(hub.deleteConnection).toHaveBeenCalledWith("testServer", "global")
			expect(hub.connectToServer).toHaveBeenCalled()
			expect(hub.notifyWebviewOfServerChanges).toHaveBeenCalled()
		})

		it("should refresh capabilities when connected server stays enabled", async () => {
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
				client: {} as any,
				transport: {} as any,
			}
			vi.mocked(hub.findConnection).mockReturnValue(connection)

			await toggleServerDisabledWithHub(hub, "testServer", false)

			expect(hub.fetchToolsList).toHaveBeenCalledWith("testServer", "global")
			expect(hub.fetchResourcesList).toHaveBeenCalledWith("testServer", "global")
			expect(hub.fetchResourceTemplatesList).toHaveBeenCalledWith("testServer", "global")
		})

		it("should include source in error message when specified", async () => {
			vi.mocked(hub.findConnection).mockReturnValue(undefined)

			await expect(toggleServerDisabledWithHub(hub, "unknown", true, "project")).rejects.toThrow(
				"Server unknown with source project not found",
			)
		})
	})

	describe("updateServerTimeoutWithHub", () => {
		it("should update timeout for an existing server", async () => {
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
				client: {} as any,
				transport: {} as any,
			}
			vi.mocked(hub.findConnection).mockReturnValue(connection)

			await updateServerTimeoutWithHub(hub, "testServer", 120)

			expect(hub.notifyWebviewOfServerChanges).toHaveBeenCalled()
		})

		it("should throw when server is not found", async () => {
			vi.mocked(hub.findConnection).mockReturnValue(undefined)

			await expect(updateServerTimeoutWithHub(hub, "unknown", 120)).rejects.toThrow("Server unknown not found")
			expect(hub.showErrorMessage).toHaveBeenCalled()
		})

		it("should include source in error message when specified", async () => {
			vi.mocked(hub.findConnection).mockReturnValue(undefined)

			await expect(updateServerTimeoutWithHub(hub, "unknown", 60, "project")).rejects.toThrow(
				"Server unknown with source project not found",
			)
		})
	})

	describe("deleteServerWithHub", () => {
		it("should delete a global server from config and update connections", async () => {
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
				client: {} as any,
				transport: {} as any,
			}
			vi.mocked(hub.findConnection).mockReturnValue(connection)

			await deleteServerWithHub(hub, "testServer")

			expect(safeWriteJson).toHaveBeenCalled()
			expect(hub.updateServerConnections).toHaveBeenCalled()
		})

		it("should delete a project server from project config", async () => {
			const connection = {
				type: "connected" as const,
				server: {
					name: "testServer",
					config: "{}",
					status: "connected" as const,
					disabled: false,
					source: "project" as const,
					errorHistory: [],
				},
				client: {} as any,
				transport: {} as any,
			}
			vi.mocked(hub.findConnection).mockReturnValue(connection)

			await deleteServerWithHub(hub, "testServer")

			expect(safeWriteJson).toHaveBeenCalledWith("/project/.roo/mcp.json", expect.any(Object), {
				prettyPrint: true,
			})
		})

		it("should throw when server is not found", async () => {
			vi.mocked(hub.findConnection).mockReturnValue(undefined)

			await expect(deleteServerWithHub(hub, "unknown")).rejects.toThrow("Server unknown not found")
			expect(hub.showErrorMessage).toHaveBeenCalled()
		})

		it("should throw when settings file is not accessible", async () => {
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
				client: {} as any,
				transport: {} as any,
			}
			vi.mocked(hub.findConnection).mockReturnValue(connection)
			vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"))

			await expect(deleteServerWithHub(hub, "testServer")).rejects.toThrow("Settings file not accessible")
		})

		it("should throw when config structure is invalid", async () => {
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
				client: {} as any,
				transport: {} as any,
			}
			vi.mocked(hub.findConnection).mockReturnValue(connection)
			vi.mocked(fs.readFile).mockResolvedValue('"not an object"')

			await expect(deleteServerWithHub(hub, "testServer")).rejects.toThrow("Invalid config structure")
		})

		it("should throw when project MCP path is not found for project server", async () => {
			const connection = {
				type: "connected" as const,
				server: {
					name: "testServer",
					config: "{}",
					status: "connected" as const,
					disabled: false,
					source: "project" as const,
					errorHistory: [],
				},
				client: {} as any,
				transport: {} as any,
			}
			vi.mocked(hub.findConnection).mockReturnValue(connection)
			vi.mocked(hub.getProjectMcpPath).mockResolvedValue("")

			await expect(deleteServerWithHub(hub, "testServer")).rejects.toThrow(
				"Project MCP configuration file not found",
			)
		})
	})
})
