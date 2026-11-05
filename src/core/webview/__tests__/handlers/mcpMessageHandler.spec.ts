import { vi, describe, it, expect, beforeEach } from "vitest"
import type { WebviewMessage } from "@njust-ai/types"

const { searchMock } = vi.hoisted(() => ({ searchMock: vi.fn() }))
vi.mock("../../../../services/web-search/WebSearchProvider", () => ({
	createSearchProvider: () => ({ search: searchMock }),
}))

vi.mock("vscode", () => ({
	window: { showErrorMessage: vi.fn(), showInformationMessage: vi.fn() },
	workspace: {
		getConfiguration: vi.fn().mockReturnValue({ update: vi.fn() }),
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
	},
	ConfigurationTarget: { Global: 1 },
}))

vi.mock("../../../utils/fs", () => ({ fileExistsAtPath: vi.fn().mockResolvedValue(false) }))
vi.mock("../../../utils/safeWriteJson", () => ({ safeWriteJson: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../../../i18n", () => ({ t: (key: string) => key }))
vi.mock("../../../shared/package", () => ({ Package: { name: "njust-ai" } }))
vi.mock("../../../../integrations/misc/open-file", () => ({ openFile: vi.fn() }))

import { openFile } from "../../../../integrations/misc/open-file"
import { registerMcpHandlers } from "../../handlers/mcpMessageHandler"
import { MessageRouter } from "../../handlers/MessageRouter"
import { createMockContext } from "./helpers"

describe("mcpMessageHandler", () => {
	let router: MessageRouter
	let context: ReturnType<typeof createMockContext>

	beforeEach(() => {
		vi.clearAllMocks()
		router = new MessageRouter()
		context = createMockContext()
		registerMcpHandlers(router)
	})

	it("registers all 12 MCP handlers", () => {
		const registeredTypes = [
			"allowedCommands",
			"deniedCommands",
			"openMcpSettings",
			"openProjectMcpSettings",
			"deleteMcpServer",
			"restartMcpServer",
			"toggleToolAlwaysAllow",
			"toggleToolEnabledForPrompt",
			"toggleMcpServer",
			"refreshAllMcpServers",
			"updateMcpTimeout",
			"testWebSearch",
		]
		for (const type of registeredTypes) {
			const handler = vi.fn()
			router.register(type, handler)
		}
	})

	it("does not report a zero-result connection probe as verified", async () => {
		searchMock.mockResolvedValueOnce([])
		await router.route(context, { type: "testWebSearch" })
		expect(context.provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "webSearchStatus",
			text: expect.stringContaining('"status":"error"'),
		})
	})

	it("reports a successful probe only when source results are available", async () => {
		searchMock.mockResolvedValueOnce([{ title: "Cangjie", url: "https://example.com/docs", snippet: "Docs" }])
		await router.route(context, { type: "testWebSearch" })
		expect(context.provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "webSearchStatus",
			text: expect.stringContaining('"status":"ok"'),
		})
	})

	it("keeps anti-bot failures visible in the connection probe", async () => {
		searchMock.mockRejectedValueOnce(new Error("Verification / anti-bot page"))
		await router.route(context, { type: "testWebSearch" })
		expect(context.provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "webSearchStatus",
			text: expect.stringContaining("anti-bot"),
		})
	})

	it("allowedCommands saves to global state", async () => {
		const message = { type: "allowedCommands", commands: ["npm", "git"] } as WebviewMessage
		await router.route(context, message)

		expect(context.updateGlobalState).toHaveBeenCalledWith("allowedCommands", ["npm", "git"])
	})

	it("deniedCommands saves to global state", async () => {
		const message = { type: "deniedCommands", commands: ["rm -rf"] } as WebviewMessage
		await router.route(context, message)

		expect(context.updateGlobalState).toHaveBeenCalledWith("deniedCommands", ["rm -rf"])
	})

	it("openMcpSettings resolves filePath from mcpHub", async () => {
		const mockGetMcpSettingsFilePath = vi.fn().mockResolvedValue("/mock/mcp.json")
		const mockMcpHub = { getMcpSettingsFilePath: mockGetMcpSettingsFilePath }
		;(context.provider.getMcpHub as any).mockReturnValue(mockMcpHub)

		await router.route(context, { type: "openMcpSettings" } as WebviewMessage)

		// Handler calls getMcpHub()?.getMcpSettingsFilePath() then openFile(path)
		expect(mockGetMcpSettingsFilePath).toHaveBeenCalledOnce()
	})

	it("openMcpSettings does nothing when mcpHub is null", async () => {
		;(context.provider.getMcpHub as any).mockReturnValue(null)

		await router.route(context, { type: "openMcpSettings" } as WebviewMessage)

		expect(openFile).not.toHaveBeenCalled()
	})

	it("deleteMcpServer calls mcpHub.deleteServer", async () => {
		const mockDeleteServer = vi.fn().mockResolvedValue(undefined)
		const mockMcpHub = { deleteServer: mockDeleteServer }
		;(context.provider.getMcpHub as any).mockReturnValue(mockMcpHub)

		await router.route(context, { type: "deleteMcpServer", serverName: "test-server", source: "global" } as any)

		expect(mockDeleteServer).toHaveBeenCalledWith("test-server", "global")
	})

	it("restartMcpServer calls mcpHub.restartConnection", async () => {
		const mockRestart = vi.fn().mockResolvedValue(undefined)
		const mockMcpHub = { restartConnection: mockRestart }
		;(context.provider.getMcpHub as any).mockReturnValue(mockMcpHub)

		await router.route(context, { type: "restartMcpServer", text: "test-server", source: "global" } as any)

		expect(mockRestart).toHaveBeenCalledWith("test-server", "global")
	})

	it("refreshAllMcpServers calls mcpHub.refreshAllConnections", async () => {
		const mockRefresh = vi.fn().mockResolvedValue(undefined)
		const mockMcpHub = { refreshAllConnections: mockRefresh }
		;(context.provider.getMcpHub as any).mockReturnValue(mockMcpHub)

		await router.route(context, { type: "refreshAllMcpServers" } as WebviewMessage)

		expect(mockRefresh).toHaveBeenCalledOnce()
	})

	it("toggleToolAlwaysAllow calls mcpHub.toggleToolAlwaysAllow", async () => {
		const mockToggle = vi.fn().mockResolvedValue(undefined)
		const mockMcpHub = { toggleToolAlwaysAllow: mockToggle }
		;(context.provider.getMcpHub as any).mockReturnValue(mockMcpHub)

		await router.route(context, {
			type: "toggleToolAlwaysAllow",
			serverName: "srv",
			source: "project",
			toolName: "my-tool",
			alwaysAllow: true,
		} as any)

		expect(mockToggle).toHaveBeenCalledWith("srv", "project", "my-tool", true)
	})
})
