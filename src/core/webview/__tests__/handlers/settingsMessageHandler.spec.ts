import { vi, describe, it, expect, beforeEach } from "vitest"
import { sandboxExtensionMessageSchema, type WebviewMessage } from "@njust-ai/types"

const vscodeMocks = vi.hoisted(() => ({
	getConfiguration: vi.fn(),
	updateConfiguration: vi.fn(),
	inspectConfiguration: vi.fn(),
	showErrorMessage: vi.fn(),
}))

const sandboxMocks = vi.hoisted(() => ({
	buildValidatedSettings: vi.fn(),
	validateDockerImage: vi.fn(),
	getInstance: vi.fn(),
	refreshDockerBackend: vi.fn(),
	cleanupStaleContainers: vi.fn(),
	pullImage: vi.fn(),
}))

const loggerMocks = vi.hoisted(() => ({
	warn: vi.fn(),
	debug: vi.fn(),
}))

vi.mock("vscode", () => ({
	window: { showErrorMessage: vscodeMocks.showErrorMessage, showInformationMessage: vi.fn() },
	workspace: {
		getConfiguration: vscodeMocks.getConfiguration,
		workspaceFolders: [{ uri: { fsPath: "/mock/workspace" } }],
	},
	ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
	Uri: {
		file: vi.fn(function (p: string) {
			return {
				fsPath: p,
			}
		}),
	},
}))

vi.mock("../../../i18n", () => ({ t: (key: string) => key, changeLanguage: vi.fn() }))
vi.mock("../../../shared/package", () => ({ Package: { name: "njust-ai" } }))
vi.mock("../../../shared/api", () => ({
	toRouterName: (s: string) => s,
}))
vi.mock("../../../shared/experiments", () => ({ experimentDefault: {} }))
vi.mock("../../../integrations/terminal/Terminal", () => ({
	Terminal: {
		setShellIntegrationTimeout: vi.fn(),
		setShellIntegrationDisabled: vi.fn(),
		setCommandDelay: vi.fn(),
		setPowershellCounter: vi.fn(),
		setTerminalZshClearEolMark: vi.fn(),
		setTerminalZshOhMy: vi.fn(),
		setTerminalZshP10k: vi.fn(),
		setTerminalZdotdir: vi.fn(),
		setExecaShellPath: vi.fn(),
	},
}))
vi.mock("../../bypassGuard", () => ({
	confirmBypassTransition: vi.fn(),
}))
vi.mock("../../../api/providers/openai", () => ({ getOpenAiModels: vi.fn() }))
vi.mock("../../../api/providers/vscode-lm", () => ({ getVsCodeLmModels: vi.fn() }))
vi.mock("../../../api/providers/fetchers/modelCache", () => ({
	getModels: vi.fn().mockResolvedValue({}),
	flushModels: vi.fn(),
}))
vi.mock("../../../utils/debugLog", () => ({ debugLog: vi.fn() }))
vi.mock("../../../utils/tts", () => ({
	setTtsEnabled: vi.fn(),
	setTtsSpeed: vi.fn(),
}))
vi.mock("../../config/importExport", () => ({
	importSettingsWithFeedback: vi.fn(),
	exportSettings: vi.fn(),
}))
vi.mock("../../../../shared/logger", () => ({
	logger: {
		error: vi.fn(),
		info: vi.fn(),
		warn: loggerMocks.warn,
		debug: loggerMocks.debug,
	},
}))
vi.mock("../../../../services/sandbox", () => ({
	DEFAULT_SETTINGS: {
		backend: "guarded-host",
		dockerImage: "njust-ai/sandbox:latest",
		networkMode: "none",
		workspaceAccess: "read-write",
		memoryMb: 512,
		cpuLimit: 1,
		pidsLimit: 256,
		timeoutSeconds: 120,
		taskScopedContainer: true,
		allowFallbackToHost: false,
	},
	buildValidatedSettings: sandboxMocks.buildValidatedSettings,
	validateDockerImage: sandboxMocks.validateDockerImage,
	SandboxExecutionService: { getInstance: sandboxMocks.getInstance },
}))

import { registerSettingsHandlers } from "../../handlers/settingsMessageHandler"
import { MessageRouter } from "../../handlers/MessageRouter"
import { createMockContext } from "./helpers"
import { confirmBypassTransition } from "../../bypassGuard"

const defaultSandboxConfig: Record<string, unknown> = {
	backend: "guarded-host",
	dockerImage: "njust-ai/sandbox:latest",
	networkMode: "none",
	workspaceAccess: "read-write",
	memoryMb: 512,
	cpuLimit: 1,
	pidsLimit: 256,
	timeoutSeconds: 120,
	taskScopedContainer: true,
}

let sandboxConfig = { ...defaultSandboxConfig }

beforeEach(() => {
	sandboxConfig = { ...defaultSandboxConfig }
	vscodeMocks.updateConfiguration.mockResolvedValue(undefined)
	vscodeMocks.getConfiguration.mockImplementation(() => ({
		get: (key: string, fallback: unknown) => sandboxConfig[key] ?? fallback,
		inspect: vscodeMocks.inspectConfiguration,
		update: vscodeMocks.updateConfiguration,
	}))
	vscodeMocks.inspectConfiguration.mockReturnValue(undefined)
	sandboxMocks.buildValidatedSettings.mockImplementation((raw) => ({
		...raw,
		allowFallbackToHost: false,
	}))
	sandboxMocks.validateDockerImage.mockImplementation(() => undefined)
	sandboxMocks.getInstance.mockReturnValue({
		refreshDockerBackend: sandboxMocks.refreshDockerBackend,
		cleanupStaleContainers: sandboxMocks.cleanupStaleContainers,
		pullImage: sandboxMocks.pullImage,
	})
	sandboxMocks.refreshDockerBackend.mockResolvedValue("available")
	sandboxMocks.cleanupStaleContainers.mockResolvedValue(0)
	sandboxMocks.pullImage.mockResolvedValue(undefined)
})

describe("settingsMessageHandler", () => {
	let router: MessageRouter
	let context: ReturnType<typeof createMockContext>

	beforeEach(() => {
		vi.clearAllMocks()
		router = new MessageRouter()
		context = createMockContext()
		registerSettingsHandlers(router)
	})

	it("registers all expected settings handlers", () => {
		const registeredTypes = [
			"updateSettings",
			"updateCloudAgentSettings",
			"updateVSCodeSetting",
			"getVSCodeSetting",
			"saveApiConfiguration",
			"upsertApiConfiguration",
			"renameApiConfiguration",
			"loadApiConfiguration",
			"loadApiConfigurationById",
			"deleteApiConfiguration",
			"getListApiConfiguration",
			"flushRouterModels",
			"requestRouterModels",
			"requestOllamaModels",
			"requestLmStudioModels",
			"requestRooModels",
			"requestOpenAiModels",
			"requestVsCodeLmModels",
			"importSettings",
			"exportSettings",
			"resetState",
			"toggleApiConfigPin",
			"enhancementApiConfigId",
			"lockApiConfigAcrossModes",
			"autoApprovalEnabled",
			"taskSyncEnabled",
			"hasOpenedModeSelector",
			"debugSetting",
			"openAiCodexSignIn",
			"openAiCodexSignOut",
			"requestOpenAiCodexRateLimits",
		]
		for (const type of registeredTypes) {
			const handler = vi.fn()
			router.register(type, handler)
		}
	})

	it("updateSettings does nothing when updatedSettings is missing", async () => {
		await router.route(context, { type: "updateSettings" } as WebviewMessage)

		expect(context.provider.contextProxy.setValue).not.toHaveBeenCalled()
	})

	it("updateSettings iterates over updatedSettings entries", async () => {
		await router.route(context, {
			type: "updateSettings",
			updatedSettings: { mode: "architect", apiProvider: "openai" },
		} as any)

		expect(context.provider.contextProxy.setValue).toHaveBeenCalledTimes(2)
		expect(context.provider.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("updateSettings saves language to state", async () => {
		await router.route(context, {
			type: "updateSettings",
			updatedSettings: { language: "zh-CN" },
		} as any)

		// Handler calls changeLanguage and then setValue
		expect(context.provider.contextProxy.setValue).toHaveBeenCalledWith("language", "zh-CN")
	})

	it("saveApiConfiguration saves config and updates list", async () => {
		;(context.provider.providerSettingsManager.saveConfig as any).mockResolvedValue(undefined)
		;(context.provider.providerSettingsManager.listConfig as any).mockResolvedValue([{ name: "test" }])

		await router.route(context, {
			type: "saveApiConfiguration",
			text: "my-config",
			apiConfiguration: { apiProvider: "openai" },
		} as any)

		expect(context.provider.providerSettingsManager.saveConfig).toHaveBeenCalledWith("my-config", {
			apiProvider: "openai",
		})
	})

	it("saveApiConfiguration does nothing without text", async () => {
		await router.route(context, {
			type: "saveApiConfiguration",
			apiConfiguration: { apiProvider: "openai" },
		} as any)

		expect(context.provider.providerSettingsManager.saveConfig).not.toHaveBeenCalled()
	})

	it("loadApiConfiguration activates profile by name", async () => {
		await router.route(context, { type: "loadApiConfiguration", text: "my-config" } as WebviewMessage)

		expect(context.provider.activateProviderProfile).toHaveBeenCalledWith({ name: "my-config" })
	})

	it("loadApiConfiguration does nothing without text", async () => {
		await router.route(context, { type: "loadApiConfiguration" } as WebviewMessage)

		expect(context.provider.activateProviderProfile).not.toHaveBeenCalled()
	})

	it("getListApiConfiguration lists and updates global state", async () => {
		const mockList = [{ name: "config1" }, { name: "config2" }]
		;(context.provider.providerSettingsManager.listConfig as any).mockResolvedValue(mockList)

		await router.route(context, { type: "getListApiConfiguration" } as WebviewMessage)

		expect(context.updateGlobalState).toHaveBeenCalledWith("listApiConfigMeta", mockList)
		expect(context.provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "listApiConfig",
			listApiConfig: mockList,
		})
	})

	it("resetState calls provider.resetState", async () => {
		;(context.provider.resetState as any).mockResolvedValue(undefined)

		await router.route(context, { type: "resetState" } as WebviewMessage)

		expect(context.provider.resetState).toHaveBeenCalledOnce()
	})

	it("toggleApiConfigPin adds pin when not pinned", async () => {
		;(context.getGlobalState as any).mockReturnValue({})

		await router.route(context, { type: "toggleApiConfigPin", text: "config-1" } as WebviewMessage)

		expect(context.updateGlobalState).toHaveBeenCalledWith("pinnedApiConfigs", { "config-1": true })
	})

	it("toggleApiConfigPin removes pin when already pinned", async () => {
		;(context.getGlobalState as any).mockReturnValue({ "config-1": true })

		await router.route(context, { type: "toggleApiConfigPin", text: "config-1" } as WebviewMessage)

		expect(context.updateGlobalState).toHaveBeenCalledWith("pinnedApiConfigs", {})
	})

	it("autoApprovalEnabled updates global state", async () => {
		await router.route(context, { type: "autoApprovalEnabled", bool: true } as any)

		expect(context.updateGlobalState).toHaveBeenCalledWith("autoApprovalEnabled", true)
	})

	it("autoApprovalEnabled defaults to false when bool is undefined", async () => {
		await router.route(context, { type: "autoApprovalEnabled" } as WebviewMessage)

		expect(context.updateGlobalState).toHaveBeenCalledWith("autoApprovalEnabled", false)
	})

	it("enhancementApiConfigId updates global state", async () => {
		await router.route(context, { type: "enhancementApiConfigId", text: "config-id" } as WebviewMessage)

		expect(context.updateGlobalState).toHaveBeenCalledWith("enhancementApiConfigId", "config-id")
	})

	it("hasOpenedModeSelector updates global state", async () => {
		await router.route(context, { type: "hasOpenedModeSelector", bool: true } as any)

		expect(context.updateGlobalState).toHaveBeenCalledWith("hasOpenedModeSelector", true)
	})
})

describe("settingsMessageHandler — P0 bypass-exit guard", () => {
	let router: MessageRouter
	let context: ReturnType<typeof createMockContext>

	beforeEach(() => {
		vi.clearAllMocks()
		router = new MessageRouter()
		context = createMockContext()
		registerSettingsHandlers(router)
	})

	it("skips confirmBypassTransition when only alwaysAllowAll is set to false", async () => {
		await router.route(context, {
			type: "updateSettings",
			updatedSettings: { alwaysAllowAll: false },
		} as any)

		expect(confirmBypassTransition).not.toHaveBeenCalled()
		expect(context.provider.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("skips confirmBypassTransition when alwaysAllowAll:false is sent alongside all other toggles true", async () => {
		;(context.getGlobalState as any).mockImplementation((key: string) => {
			if (key === "autoApprovalEnabled") return true
			if (key === "alwaysAllowExecute") return true
			if (key === "alwaysAllowWrite") return true
			if (key === "alwaysAllowReadOnly") return true
			if (key === "alwaysAllowMcp") return true
			if (key === "alwaysAllowModeSwitch") return true
			if (key === "alwaysAllowSubtasks") return true
			return undefined
		})

		await router.route(context, {
			type: "updateSettings",
			updatedSettings: { alwaysAllowAll: false },
		} as any)

		expect(confirmBypassTransition).not.toHaveBeenCalled()
		expect(context.provider.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("calls confirmBypassTransition when entering bypass mode (alwaysAllowAll:true)", async () => {
		vi.mocked(confirmBypassTransition).mockResolvedValue(true)

		await router.route(context, {
			type: "updateSettings",
			updatedSettings: { alwaysAllowAll: true },
		} as any)

		expect(confirmBypassTransition).toHaveBeenCalledOnce()
	})
})

describe("settingsMessageHandler - sandbox", () => {
	let router: MessageRouter
	let context: ReturnType<typeof createMockContext>

	beforeEach(() => {
		vi.clearAllMocks()
		router = new MessageRouter()
		context = createMockContext()
		registerSettingsHandlers(router)
	})

	it("validates the merged sandbox snapshot before writing and refreshes Docker once", async () => {
		await router.route(context, {
			type: "updateSettings",
			updatedSettings: {
				sandboxNetworkMode: "bridge",
				sandboxMemoryMb: 1024,
			},
		} as WebviewMessage)

		expect(sandboxMocks.buildValidatedSettings).toHaveBeenCalledWith({
			...defaultSandboxConfig,
			networkMode: "bridge",
			memoryMb: 1024,
		})
		expect(vscodeMocks.updateConfiguration).toHaveBeenCalledTimes(2)
		expect(vscodeMocks.updateConfiguration).toHaveBeenCalledWith("networkMode", "bridge", 1)
		expect(vscodeMocks.updateConfiguration).toHaveBeenCalledWith("memoryMb", 1024, 1)
		expect(context.provider.contextProxy.setValue).not.toHaveBeenCalled()
		expect(sandboxMocks.refreshDockerBackend).toHaveBeenCalledOnce()
	})

	it("writes sandbox fields globally even when legacy workspace overrides exist", async () => {
		vscodeMocks.inspectConfiguration.mockImplementation((key: string) => {
			if (key === "networkMode") {
				return { workspaceFolderValue: "none", workspaceValue: "bridge", globalValue: "none" }
			}
			if (key === "memoryMb") {
				return { workspaceValue: 512, globalValue: 256 }
			}
			return undefined
		})

		await router.route(context, {
			type: "updateSettings",
			updatedSettings: {
				sandboxNetworkMode: "bridge",
				sandboxMemoryMb: 1024,
			},
		} as WebviewMessage)

		expect(vscodeMocks.updateConfiguration).toHaveBeenCalledWith("networkMode", "bridge", 1)
		expect(vscodeMocks.updateConfiguration).toHaveBeenCalledWith("memoryMb", 1024, 1)
		expect(vscodeMocks.inspectConfiguration).not.toHaveBeenCalled()
	})

	it("writes no sandbox fields when any value is invalid", async () => {
		sandboxMocks.buildValidatedSettings.mockImplementationOnce(() => {
			throw new Error("memoryMb is out of range")
		})

		await router.route(context, {
			type: "updateSettings",
			updatedSettings: {
				sandboxDockerImage: "njust-ai/sandbox:latest",
				sandboxMemoryMb: 0,
			},
		} as WebviewMessage)

		expect(vscodeMocks.updateConfiguration).not.toHaveBeenCalled()
		expect(sandboxMocks.refreshDockerBackend).not.toHaveBeenCalled()
		expect(vscodeMocks.showErrorMessage).toHaveBeenCalledOnce()
		expect(context.provider.postStateToWebview).toHaveBeenCalledOnce()
	})

	it("returns a correlated Docker status result", async () => {
		await router.route(context, { type: "sandboxTest", requestId: "test-1" } as WebviewMessage)

		const response = vi.mocked(context.provider.postMessageToWebview).mock.calls[0][0]
		expect(sandboxExtensionMessageSchema.safeParse(response).success).toBe(true)
		expect(response).toEqual({
			type: "sandboxTestResult",
			requestId: "test-1",
			payload: {
				success: true,
				status: "available",
				message: "Docker is available and running",
			},
		})
	})

	it("does not report a fake cleanup count when cleanup fails", async () => {
		sandboxMocks.cleanupStaleContainers.mockRejectedValueOnce(new Error("daemon unavailable"))

		await router.route(context, { type: "sandboxCleanup", requestId: "cleanup-1" } as WebviewMessage)

		const response = vi.mocked(context.provider.postMessageToWebview).mock.calls[0][0]
		expect(sandboxExtensionMessageSchema.safeParse(response).success).toBe(true)
		expect(response).toEqual({
			type: "sandboxCleanupResult",
			requestId: "cleanup-1",
			payload: { success: false, message: "Cleanup failed: daemon unavailable" },
		})
		expect(response.payload).not.toHaveProperty("count")
	})

	it("validates and pulls the requested image with correlated progress", async () => {
		sandboxMocks.pullImage.mockImplementationOnce(async (_image, onProgress) => {
			onProgress("layer 1")
			onProgress("layer 2")
		})

		await router.route(context, {
			type: "sandboxPullImage",
			requestId: "pull-1",
			image: "node:20-alpine",
		} as WebviewMessage)

		expect(sandboxMocks.validateDockerImage).toHaveBeenCalledWith("node:20-alpine")
		expect(sandboxMocks.pullImage).toHaveBeenCalledWith("node:20-alpine", expect.any(Function))
		const responses = vi.mocked(context.provider.postMessageToWebview).mock.calls.map(([value]) => value)
		expect(responses.every((response) => sandboxExtensionMessageSchema.safeParse(response).success)).toBe(true)
		expect(responses).toEqual([
			{
				type: "sandboxPullProgress",
				requestId: "pull-1",
				payload: { image: "node:20-alpine", line: "layer 1" },
			},
			{
				type: "sandboxPullProgress",
				requestId: "pull-1",
				payload: { image: "node:20-alpine", line: "layer 2" },
			},
			{
				type: "sandboxPullComplete",
				requestId: "pull-1",
				payload: {
					success: true,
					image: "node:20-alpine",
					message: "Successfully pulled node:20-alpine",
				},
			},
		])
	})

	it("defensively rejects an invalid image before invoking the service", async () => {
		sandboxMocks.validateDockerImage.mockImplementationOnce(() => {
			throw new Error("invalid image")
		})

		await router.route(context, {
			type: "sandboxPullImage",
			requestId: "pull-2",
			image: "invalid image",
		} as WebviewMessage)

		expect(sandboxMocks.pullImage).not.toHaveBeenCalled()
		const response = vi.mocked(context.provider.postMessageToWebview).mock.calls[0][0]
		expect(sandboxExtensionMessageSchema.safeParse(response).success).toBe(true)
		expect(response).toEqual({
			type: "sandboxPullComplete",
			requestId: "pull-2",
			payload: {
				success: false,
				image: "invalid image",
				message: "Pull failed: invalid image",
			},
		})
	})
})
