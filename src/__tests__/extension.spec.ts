// npx vitest run __tests__/extension.spec.ts

import { describe, expect, vi, beforeEach, it } from "vitest"

import type * as vscode from "vscode"
import { createMockExtensionContext } from "./helpers/vscodeMocks"
import * as fsModule from "fs"
import * as dotenvxModule from "@dotenvx/dotenvx"

import { TelemetryService } from "@njust-ai/telemetry"

import * as vscodeModule from "vscode"

import { activate, deactivate } from "../extension"
import { logger } from "../shared/logger"
import { McpServerManager } from "../services/mcp/McpServerManager"

vi.mock("vscode", () => {
	const mockRegFn = () =>
		vi.fn().mockReturnValue({
			dispose: vi.fn(),
		})
	const mockFolder = {
		uri: { fsPath: "/test/workspace", scheme: "file", path: "/test/workspace" },
		name: "workspace",
		index: 0,
	}
	return {
		window: {
			createOutputChannel: vi.fn().mockReturnValue({ appendLine: vi.fn() }),
			registerWebviewViewProvider: vi.fn(),
			registerUriHandler: vi.fn(),
			tabGroups: { onDidChangeTabs: vi.fn() },
			onDidChangeActiveTextEditor: vi.fn(),
			createStatusBarItem: vi.fn().mockReturnValue({ show: vi.fn(), dispose: vi.fn() }),
			showInformationMessage: vi.fn().mockResolvedValue(undefined),
			showErrorMessage: vi.fn().mockResolvedValue(undefined),
			showWarningMessage: vi.fn().mockResolvedValue(undefined),
			createTerminal: vi.fn(),
			activeTextEditor: undefined,
		},
		workspace: {
			registerTextDocumentContentProvider: vi.fn(),
			getConfiguration: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue("") }),
			createFileSystemWatcher: vi.fn().mockReturnValue({
				onDidCreate: vi.fn(),
				onDidChange: vi.fn(),
				onDidDelete: vi.fn(),
				dispose: vi.fn(),
			}),
			onDidChangeWorkspaceFolders: vi.fn(),
			onDidChangeConfiguration: vi.fn(),
			onDidSaveTextDocument: vi.fn(),
			getWorkspaceFolder: vi.fn().mockReturnValue(mockFolder),
			workspaceFolders: [],
		},
		languages: {
			registerCodeActionsProvider: vi.fn(),
			createDiagnosticCollection: vi.fn().mockReturnValue({ set: vi.fn(), clear: vi.fn(), delete: vi.fn() }),
			onDidChangeDiagnostics: vi.fn(),
			registerInlineCompletionItemProvider: mockRegFn(),
			registerDocumentSymbolProvider: vi.fn(),
			registerFoldingRangeProvider: vi.fn(),
			registerHoverProvider: vi.fn(),
			registerCodeLensProvider: vi.fn(),
			registerDocumentSemanticTokensProvider: vi.fn(),
			registerInlayHintsProvider: vi.fn(),
			registerDefinitionProvider: vi.fn(),
			registerReferenceProvider: vi.fn(),
			registerRenameProvider: vi.fn(),
			registerCallHierarchyProvider: vi.fn(),
			registerTypeHierarchyProvider: vi.fn(),
			registerWorkspaceSymbolProvider: vi.fn(),
		},
		debug: {
			registerDebugAdapterDescriptorFactory: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			registerDebugConfigurationProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			startDebugging: vi.fn().mockResolvedValue(undefined),
		},
		commands: {
			executeCommand: vi.fn(),
			registerCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		},
		chat: {
			createChatParticipant: vi.fn().mockReturnValue({
				iconPath: undefined,
				followupProvider: undefined,
				onDidReceiveFeedback: vi.fn().mockReturnValue({ dispose: vi.fn() }),
			}),
		},
		ChatResultFeedbackKind: { Helpful: 1, Unhelpful: 2 },
		lm: {
			registerTool: vi.fn().mockReturnValue({ dispose: vi.fn() }),
		},
		env: { language: "en" },
		ExtensionMode: { Production: 1 },
		Uri: {
			parse: vi.fn(),
			file: vi.fn(function () {
				return {
					fsPath: "/test",
					with: vi.fn(),
				}
			}),
			joinPath: vi.fn(function () {
				return {
					fsPath: "/test",
				}
			}),
		},
		EventEmitter: vi.fn(function () {
			return {
				event: vi.fn(),
				fire: vi.fn(),
				dispose: vi.fn(),
			}
		}),
		StatusBarAlignment: { Left: 1, Right: 2 },
		ThemeColor: class {
			constructor(id) {
				this.id = id
			}
		},
	}
})

vi.mock("@dotenvx/dotenvx", () => ({
	config: vi.fn(),
}))

// Mock vscode-languageclient/node to prevent deep import of "vscode" after vi.resetModules()
vi.mock("vscode-languageclient/node", () => ({
	LanguageClient: vi.fn(),
	TransportKind: { stdio: 0 },
}))

// Mock all cangjie-lsp modules to prevent deep vscode dependency chains after resetModules.
// Use mockResolvedValue for functions that extension.ts awaits or calls .then() on.
// Factory variables must be hoisted because vi.mock is hoisted to the top of the file.
const { mockAsyncFn, mockConstructor } = vi.hoisted(() => {
	const mockAsyncFn = () => vi.fn().mockResolvedValue(undefined)
	const mockConstructor = () =>
		vi.fn(function () {
			return {
				initialize: vi.fn().mockResolvedValue(undefined),
				dispose: vi.fn(),
				onCangjieActivated: vi.fn(),
				start: vi.fn().mockResolvedValue(undefined),
				stop: vi.fn().mockResolvedValue(undefined),
			}
		})
	return { mockAsyncFn, mockConstructor }
})
vi.mock("../services/cangjie-lsp/CangjieLspClient", () => ({ CangjieLspClient: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CangjieLspStatusBar", () => ({ CangjieLspStatusBar: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CjfmtFormatter", () => ({ CjfmtFormatter: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CjlintDiagnostics", () => ({ CjlintDiagnostics: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CjpmTaskProvider", () => ({ CjpmTaskProvider: mockConstructor() }))
vi.mock("../services/cangjie-lsp/cangjieCommands", () => ({ registerCangjieCommands: vi.fn() }))
vi.mock("../services/cangjie-lsp/cangjieGeneratedTestCleanup", () => ({
	scanGeneratedFilesForCleanup: vi.fn().mockReturnValue({ active: [], detached: [], legacy: [] }),
	initTestCleanup: vi.fn(),
}))
vi.mock("../services/cangjie-lsp/CangjieCodeActionProvider", () => ({ CangjieCodeActionProvider: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CangjieSdkSetup", () => ({ checkAndPromptSdkSetup: mockAsyncFn() }))
vi.mock("../services/cangjie-lsp/cangjieToolUtils", () => ({
	probeCangjieToolchain: mockAsyncFn(),
	invalidateCangjieToolEnvCache: vi.fn(),
}))
vi.mock("../services/cangjie-lsp/CangjieDocumentSymbolProvider", () => ({
	CangjieDocumentSymbolProvider: mockConstructor(),
}))
vi.mock("../services/cangjie-lsp/CangjieFoldingRangeProvider", () => ({
	CangjieFoldingRangeProvider: mockConstructor(),
}))
vi.mock("../services/cangjie-lsp/CangjieHoverProvider", () => ({ CangjieHoverProvider: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CangjieTestCodeLensProvider", () => ({
	CangjieTestCodeLensProvider: mockConstructor(),
}))
vi.mock("../services/cangjie-lsp/CangjieDebugAdapterFactory", () => ({
	CangjieDebugAdapterFactory: mockConstructor(),
	CangjieDebugConfigurationProvider: mockConstructor(),
}))
vi.mock("../services/cangjie-lsp/CangjieSymbolIndex", () => ({ CangjieSymbolIndex: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CangjieDefinitionProvider", () => ({ CangjieDefinitionProvider: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CangjieReferenceProvider", () => ({ CangjieReferenceProvider: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CangjieEnhancedRenameProvider", () => ({
	CangjieEnhancedRenameProvider: mockConstructor(),
}))
vi.mock("../services/cangjie-lsp/CangjieMacroProvider", () => ({
	CangjieMacroCodeLensProvider: mockConstructor(),
	CangjieMacroHoverProvider: mockConstructor(),
	registerMacroCommands: vi.fn(),
}))
vi.mock("../services/cangjie-lsp/CangjieSemanticTokensProvider", () => ({
	CangjieSemanticTokensProvider: mockConstructor(),
}))
vi.mock("../services/cangjie-lsp/CangjieInlayHintsProvider", () => ({ CangjieInlayHintsProvider: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CangjieCallHierarchyProvider", () => ({
	CangjieCallHierarchyProvider: mockConstructor(),
}))
vi.mock("../services/cangjie-lsp/CangjieTypeHierarchyProvider", () => ({
	CangjieTypeHierarchyProvider: mockConstructor(),
}))
vi.mock("../services/cangjie-lsp/CangjieWorkspaceSymbolProvider", () => ({
	CangjieWorkspaceSymbolProvider: mockConstructor(),
}))
vi.mock("../services/cangjie-lsp/CangjieCompileGuard", () => ({ CangjieCompileGuard: mockConstructor() }))
vi.mock("../services/cangjie-lsp/cangjieRulesHotReload", () => ({ registerCangjieRulesHotReload: vi.fn() }))
vi.mock("../services/cangjie-lsp/cangjieDiagnosticModeSwitch", () => ({ cangjieDiagnosticModeSwitch: vi.fn() }))
vi.mock("../services/cangjie-lsp/CangjieLintConfig", () => ({ CangjieLintConfig: mockConstructor() }))
vi.mock("../services/cangjie-lsp/CangjieMetricsCollector", () => ({ CangjieMetricsCollector: mockConstructor() }))
vi.mock("../services/cloud-agent/deviceToken", () => ({ setDeviceToken: vi.fn() }))
vi.mock("../services/cloud-agent/ProfileStorageService", () => ({
	ProfileStorageService: vi.fn(function () {
		return {
			initialize: vi.fn().mockResolvedValue(undefined),
			getProfiles: vi.fn(() => []),
			getProfile: vi.fn(() => undefined),
			getActiveProfile: vi.fn(() => undefined),
			saveProfile: vi.fn().mockResolvedValue(undefined),
			deleteProfile: vi.fn().mockResolvedValue(undefined),
			setActiveProfileId: vi.fn().mockResolvedValue(undefined),
			migrateFromLegacyConfig: vi.fn().mockResolvedValue(null),
		}
	}),
	setProfileStorageService: vi.fn(),
	getProfileStorageService: vi.fn(),
}))

// Mock fs so the extension module can safely check for optional .env.
vi.mock("fs", () => ({
	existsSync: vi.fn().mockReturnValue(false),
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: {
		reportError: vi.fn(),
		createInstance: vi.fn().mockReturnValue({
			register: vi.fn(),
			setProvider: vi.fn(),
			shutdown: vi.fn(),
		}),
		hasInstance: vi.fn().mockReturnValue(false),
		get instance() {
			return {
				register: vi.fn(),
				setProvider: vi.fn(),
				shutdown: vi.fn(),
			}
		},
	},
	PostHogTelemetryClient: vi.fn(),
}))

vi.mock("../utils/outputChannelLogger", () => ({
	createOutputChannelLogger: vi.fn().mockReturnValue(vi.fn()),
	createDualLogger: vi.fn().mockReturnValue(vi.fn()),
}))

vi.mock("../shared/package", () => ({
	Package: {
		name: "test-extension",
		outputChannel: "Test Output",
		version: "1.0.0",
	},
}))

vi.mock("../shared/language", () => ({
	formatLanguage: vi.fn().mockReturnValue("en"),
}))

vi.mock("../core/config/ContextProxy", () => ({
	ContextProxy: {
		getInstance: vi.fn().mockResolvedValue({
			getValue: vi.fn(),
			setValue: vi.fn(),
			getValues: vi.fn().mockReturnValue({}),
			getProviderSettings: vi.fn().mockReturnValue({}),
		}),
	},
}))

vi.mock("../integrations/editor/DiffViewProvider", () => ({
	DIFF_VIEW_URI_SCHEME: "test-diff-scheme",
}))

vi.mock("../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		initialize: vi.fn(),
		cleanup: vi.fn(),
	},
}))

// Real sandbox and audit services probe Docker and write files on activate/deactivate,
// which made deactivate() slow enough to time out on CI runners.
vi.mock("../services/sandbox", () => {
	const sandboxService = {
		initializeDocker: vi.fn().mockResolvedValue("unavailable"),
		refreshDockerBackend: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
	}
	return {
		SandboxExecutionService: {
			getInstance: vi.fn(() => sandboxService),
			resetInstance: vi.fn(),
		},
		VSCodeSandboxConfigProvider: vi.fn(function () {
			return {}
		}),
	}
})

vi.mock("../services/AuditLogger", () => ({
	AuditLogger: vi.fn(function () {
		return { log: vi.fn(), dispose: vi.fn().mockResolvedValue(undefined) }
	}),
}))

vi.mock("../services/AuditSink", () => ({
	AuditSink: vi.fn(function () {
		return { dispose: vi.fn() }
	}),
}))

vi.mock("../services/mcp/McpServerManager", () => ({
	McpServerManager: {
		cleanup: vi.fn().mockResolvedValue(undefined),
		getInstance: vi.fn().mockResolvedValue(null),
		unregisterProvider: vi.fn(),
	},
}))

vi.mock("../services/code-index/manager", () => ({
	CodeIndexManager: {
		getInstance: vi.fn().mockReturnValue(null),
	},
}))

vi.mock("../services/mdm/MdmService", () => ({
	MdmService: {
		createInstance: vi.fn().mockResolvedValue(null),
	},
}))

vi.mock("../utils/migrateSettings", () => ({
	migrateSettings: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../core/config/autoImportSettings", () => ({
	autoImportSettings: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../extension/api", () => ({
	API: vi.fn(function () {
		return {}
	}),
}))

vi.mock("../activate", () => ({
	handleUri: vi.fn(),
	registerCommands: vi.fn(),
	registerCodeActions: vi.fn(),
	registerTerminalActions: vi.fn(),
	CodeActionProvider: vi.fn(function () {
		return {
			providedCodeActionKinds: [],
		}
	}),
}))

vi.mock("../i18n", () => ({
	initializeI18n: vi.fn(),
	t: vi.fn((key) => key),
}))

// Mock ClineProvider
vi.mock("../core/webview/ClineProvider", async () => {
	const mockInstance = {
		resolveWebviewView: vi.fn(),
		postMessageToWebview: vi.fn(),
		postStateToWebview: vi.fn(),
		postStateToWebviewWithoutClineMessages: vi.fn(),
		getState: vi.fn().mockResolvedValue({}),
		initializeCloudProfileSyncWhenReady: vi.fn().mockResolvedValue(undefined),
		providerSettingsManager: {},
		contextProxy: { getGlobalState: vi.fn() },
		customModesManager: {},
		upsertProviderProfile: vi.fn().mockResolvedValue(undefined),
	}
	return {
		ClineProvider: Object.assign(
			vi.fn(function () {
				return mockInstance
			}),
			{
				// Static method used by extension.ts
				getVisibleInstance: vi.fn().mockReturnValue(mockInstance),
				sideBarId: "njust-ai.SidebarProvider",
			},
		),
	}
})

// Mock modelCache to prevent network requests during module loading
const mockRefreshModels = vi.hoisted(() => vi.fn().mockResolvedValue({}))
vi.mock("../api/providers/fetchers/modelCache", () => ({
	flushModels: vi.fn(),
	getModels: vi.fn().mockResolvedValue([]),
	initializeModelCacheRefresh: vi.fn(),
	refreshModels: mockRefreshModels,
}))

describe("extension.ts", () => {
	let mockContext: vscode.ExtensionContext

	beforeEach(() => {
		vi.clearAllMocks()

		mockContext = createMockExtensionContext({
			extensionPath: "/test/path",
			globalState: {
				get: vi.fn().mockReturnValue(undefined),
				update: vi.fn(),
			},
			globalStorageUri: { fsPath: "/test/global-storage", scheme: "file", path: "/test/global-storage" },
			storageUri: { fsPath: "/test/storage", scheme: "file", path: "/test/storage" },
			subscriptions: [],
			secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn(), onDidChange: vi.fn() },
		})
	})

	it("does not call dotenvx.config when optional .env does not exist", async () => {
		vi.clearAllMocks()
		vi.mocked(fsModule.existsSync).mockReturnValue(false)

		await activate(mockContext)

		expect(dotenvxModule.config).not.toHaveBeenCalled()
	})

	it("calls dotenvx.config when optional .env exists", async () => {
		vi.clearAllMocks()
		vi.mocked(fsModule.existsSync).mockReturnValue(true)

		await activate(mockContext)

		expect(dotenvxModule.config).toHaveBeenCalledTimes(1)
	})

	it("reports an uncaught exception once without re-throwing it", async () => {
		const before = process.listeners("uncaughtException")
		await activate(mockContext)
		const listener = process.listeners("uncaughtException").find((l) => !before.includes(l))
		expect(listener).toBeDefined()

		vi.useFakeTimers()
		try {
			const error = new Error("boom")
			listener!(error, "uncaughtException")

			// A re-throw would surface here and re-enter the same listener forever.
			expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
			const reports = vi.mocked(TelemetryService.reportError).mock.calls.filter(([e]) => e === error)
			expect(reports).toHaveLength(1)
		} finally {
			vi.useRealTimers()
			process.removeListener("uncaughtException", listener!)
		}
	})

	describe("process-level listeners", () => {
		type Listener = (...args: unknown[]) => void
		const EVENTS = ["uncaughtException", "unhandledRejection"] as const

		/** Listeners this extension added on top of the given snapshot. */
		function added(before: Record<string, unknown[]>) {
			return Object.fromEntries(
				EVENTS.map((event) => [
					event,
					process.listeners(event).filter((l) => !before[event]!.includes(l)) as Listener[],
				]),
			) as Record<(typeof EVENTS)[number], Listener[]>
		}
		function snapshot(): Record<string, unknown[]> {
			return Object.fromEntries(EVENTS.map((event) => [event, [...process.listeners(event)]]))
		}

		it("keeps a single pair of listeners across repeated activation", async () => {
			await deactivate().catch(() => undefined)
			const before = snapshot()

			await activate(mockContext)
			await activate(mockContext)

			const ours = added(before)
			expect(ours.uncaughtException).toHaveLength(1)
			expect(ours.unhandledRejection).toHaveLength(1)
			await deactivate()
		})

		it("leaves a host listener registered and removes only its own on deactivate", async () => {
			await deactivate().catch(() => undefined)
			const hostListener = vi.fn()
			process.on("uncaughtException", hostListener)
			try {
				const before = snapshot()
				await activate(mockContext)
				expect(added(before).uncaughtException).toHaveLength(1)

				await deactivate()

				expect(added(before).uncaughtException).toHaveLength(0)
				expect(added(before).unhandledRejection).toHaveLength(0)
				expect(process.listeners("uncaughtException")).toContain(hostListener)
			} finally {
				process.removeListener("uncaughtException", hostListener)
			}
		})

		it("never throws from a listener, even when logging and telemetry fail", async () => {
			await deactivate().catch(() => undefined)
			const before = snapshot()
			await activate(mockContext)
			const ours = added(before)
			vi.spyOn(logger, "error").mockImplementation(() => {
				throw new Error("logger broken")
			})
			vi.mocked(TelemetryService.reportError).mockImplementation(() => {
				throw new Error("telemetry broken")
			})

			try {
				expect(() => ours.uncaughtException[0]!(new Error("boom"), "uncaughtException")).not.toThrow()
				expect(() => ours.unhandledRejection[0]!(new Error("rejected"), Promise.resolve())).not.toThrow()
			} finally {
				vi.mocked(logger.error).mockRestore()
				vi.mocked(TelemetryService.reportError).mockReset()
				await deactivate()
			}
		})

		it("never throws from the inspector-error branch when its debug log fails", async () => {
			await deactivate().catch(() => undefined)
			const before = snapshot()
			await activate(mockContext)
			const ours = added(before)
			const inspectorError = Object.assign(new Error("Missing dataLength in event"), {
				stack: [
					"Error",
					"    at broadcastToFrontend (node:inspector:1:1)",
					"    at dataReceived (node:inspector:2:2)",
				].join("\n"),
			})
			vi.spyOn(logger, "debug").mockImplementation(() => {
				throw new Error("logger broken")
			})

			try {
				expect(() => ours.uncaughtException[0]!(inspectorError, "uncaughtException")).not.toThrow()
				expect(logger.debug).toHaveBeenCalled()
			} finally {
				vi.mocked(logger.debug).mockRestore()
				await deactivate()
			}
		})

		it("reports a rejection whose reason cannot be turned into a string", async () => {
			await deactivate().catch(() => undefined)
			const before = snapshot()
			await activate(mockContext)
			const ours = added(before)
			// String() throws for an object without a prototype (no toString / valueOf).
			const reason = Object.create(null)

			try {
				expect(() => ours.unhandledRejection[0]!(reason, Promise.resolve())).not.toThrow()
				expect(TelemetryService.reportError).toHaveBeenCalledWith(expect.any(Error), expect.anything())
			} finally {
				await deactivate()
			}
		})

		it("removes its listeners when activation fails", async () => {
			await deactivate().catch(() => undefined)
			const before = snapshot()
			vi.mocked(vscodeModule.window.createOutputChannel).mockImplementationOnce(() => {
				throw new Error("activation failed")
			})

			await expect(activate(mockContext)).rejects.toThrow("activation failed")

			expect(added(before).uncaughtException).toHaveLength(0)
			expect(added(before).unhandledRejection).toHaveLength(0)
		})

		it("removes its listeners even when an earlier deactivation step fails", async () => {
			await deactivate().catch(() => undefined)
			const before = snapshot()
			await activate(mockContext)
			vi.mocked(McpServerManager.cleanup).mockRejectedValueOnce(new Error("cleanup failed"))

			await expect(deactivate()).rejects.toThrow("cleanup failed")

			expect(added(before).uncaughtException).toHaveLength(0)
			expect(added(before).unhandledRejection).toHaveLength(0)
		})
	})

	// Cloud-related auth tests removed in simplified version
})
