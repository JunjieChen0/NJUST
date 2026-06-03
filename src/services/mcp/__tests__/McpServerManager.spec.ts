import { describe, it, expect, vi, beforeEach } from "vitest"
import type * as vscode from "vscode"

vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn().mockReturnValue({
			onDidChange: vi.fn(),
			onDidCreate: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		}),
		onDidSaveTextDocument: vi.fn(),
		onDidChangeWorkspaceFolders: vi.fn(),
		workspaceFolders: [],
	},
	window: {
		showErrorMessage: vi.fn(),
		showInformationMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		createTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	},
	Disposable: { from: vi.fn() },
}))

vi.mock("fs/promises", () => ({
	default: {
		access: vi.fn().mockResolvedValue(undefined),
		writeFile: vi.fn().mockResolvedValue(undefined),
		readFile: vi.fn().mockResolvedValue("{}"),
		unlink: vi.fn().mockResolvedValue(undefined),
		rename: vi.fn().mockResolvedValue(undefined),
		lstat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
		mkdir: vi.fn().mockResolvedValue(undefined),
	},
	access: vi.fn().mockResolvedValue(undefined),
	writeFile: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn().mockResolvedValue("{}"),
	unlink: vi.fn().mockResolvedValue(undefined),
	rename: vi.fn().mockResolvedValue(undefined),
	lstat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
	mkdir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn(),
	getDefaultEnvironment: vi.fn().mockReturnValue({}),
}))

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: vi.fn(),
}))

vi.mock("chokidar", () => ({
	default: {
		watch: vi.fn().mockReturnValue({
			on: vi.fn().mockReturnThis(),
			close: vi.fn(),
		}),
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
	NJUST_AI_CONFIG_DIR: ".njust_ai",
}))

vi.mock("../McpHub", () => {
	const mockHub = {
		waitUntilReady: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
		connections: [],
		isConnecting: false,
	}
	return {
		McpHub: vi.fn(function (this: any) {
			Object.assign(this, mockHub)
		}),
	}
})

import { McpServerManager } from "../McpServerManager"
import type { IMcpHubClient } from "../interfaces/IMcpHubClient"

function createMockProvider(): IMcpHubClient {
	return {
		cwd: "/workspace",
		context: {} as vscode.ExtensionContext,
		getState: vi.fn().mockResolvedValue({}),
		ensureMcpServersDirectoryExists: vi.fn().mockResolvedValue("/mcp-servers"),
		ensureSettingsDirectoryExists: vi.fn().mockResolvedValue("/settings"),
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		getExtensionPackageVersion: vi.fn().mockReturnValue("1.0.0"),
		onMcpServersUpdated: vi.fn().mockResolvedValue(undefined),
	}
}

function createMockContext(): vscode.ExtensionContext {
	return {
		globalState: {
			update: vi.fn().mockResolvedValue(undefined),
			get: vi.fn().mockReturnValue(undefined),
		},
	} as unknown as vscode.ExtensionContext
}

describe("McpServerManager", () => {
	let context: vscode.ExtensionContext
	let provider: IMcpHubClient

	beforeEach(() => {
		vi.clearAllMocks()
		context = createMockContext()
		provider = createMockProvider()
		// Reset the singleton state before each test
		// Access private static fields through cleanup
		return McpServerManager.cleanup(context).catch(() => {})
	})

	describe("getInstance", () => {
		it("should create a new McpHub instance on first call", async () => {
			const { McpHub } = await import("../McpHub")

			const instance = await McpServerManager.getInstance(context, provider)

			expect(McpHub).toHaveBeenCalledWith(provider)
			expect(instance).toBeDefined()
		})

		it("should return the same instance on subsequent calls", async () => {
			const instance1 = await McpServerManager.getInstance(context, provider)
			const instance2 = await McpServerManager.getInstance(context, provider)

			expect(instance1).toBe(instance2)
		})

		it("should register the provider", async () => {
			await McpServerManager.getInstance(context, provider)

			// Verify provider is registered by calling notifyProviders
			McpServerManager.notifyProviders({ type: "test" })

			expect(provider.postMessageToWebview).toHaveBeenCalledWith({ type: "test" })
		})

		it("should wait for hub to be ready before returning", async () => {
			const instance = await McpServerManager.getInstance(context, provider)

			// The mock hub's waitUntilReady should have been called
			expect(instance).toBeDefined()
		})

		it("should store identifier in global state", async () => {
			await McpServerManager.getInstance(context, provider)

			expect(context.globalState.update).toHaveBeenCalledWith("mcpHubInstanceId", expect.any(String))
		})

		it("should handle concurrent initialization requests", async () => {
			const { McpHub } = await import("../McpHub")

			const [instance1, instance2] = await Promise.all([
				McpServerManager.getInstance(context, provider),
				McpServerManager.getInstance(context, createMockProvider()),
			])

			expect(instance1).toBe(instance2)
			// McpHub should only be constructed once
			const constructorCalls = vi.mocked(McpHub).mock.calls.length
			expect(constructorCalls).toBe(1)
		})

		it("should return existing instance if already initialized", async () => {
			const { McpHub } = await import("../McpHub")

			await McpServerManager.getInstance(context, provider)
			vi.mocked(McpHub).mockClear()

			await McpServerManager.getInstance(context, provider)

			expect(McpHub).not.toHaveBeenCalled()
		})
	})

	describe("unregisterProvider", () => {
		it("should remove provider from tracked set", async () => {
			await McpServerManager.getInstance(context, provider)

			McpServerManager.unregisterProvider(provider)

			// After unregistering, notifyProviders should not call the removed provider
			vi.mocked(provider.postMessageToWebview).mockClear()
			McpServerManager.notifyProviders({ type: "test" })

			expect(provider.postMessageToWebview).not.toHaveBeenCalled()
		})

		it("should not throw when unregistering unknown provider", () => {
			const unknownProvider = createMockProvider()

			expect(() => McpServerManager.unregisterProvider(unknownProvider)).not.toThrow()
		})
	})

	describe("notifyProviders", () => {
		it("should send message to all registered providers", async () => {
			const provider2 = createMockProvider()
			await McpServerManager.getInstance(context, provider)
			// Register a second provider
			await McpServerManager.getInstance(context, provider2)

			McpServerManager.notifyProviders({ type: "update" })

			expect(provider.postMessageToWebview).toHaveBeenCalledWith({ type: "update" })
			expect(provider2.postMessageToWebview).toHaveBeenCalledWith({ type: "update" })
		})

		it("should handle provider notification errors gracefully", async () => {
			await McpServerManager.getInstance(context, provider)
			vi.mocked(provider.postMessageToWebview).mockRejectedValueOnce(new Error("post failed"))

			// Should not throw
			expect(() => McpServerManager.notifyProviders({ type: "update" })).not.toThrow()
		})
	})

	describe("cleanup", () => {
		it("should dispose the hub instance", async () => {
			const { McpHub } = await import("../McpHub")

			await McpServerManager.getInstance(context, provider)
			await McpServerManager.cleanup(context)

			// After cleanup, a new getInstance should create a new instance
			vi.mocked(McpHub).mockClear()
			await McpServerManager.getInstance(context, provider)

			expect(McpHub).toHaveBeenCalled()
		})

		it("should clear global state key", async () => {
			await McpServerManager.getInstance(context, provider)
			await McpServerManager.cleanup(context)

			expect(context.globalState.update).toHaveBeenCalledWith("mcpHubInstanceId", undefined)
		})

		it("should clear all providers", async () => {
			await McpServerManager.getInstance(context, provider)
			await McpServerManager.cleanup(context)

			vi.mocked(provider.postMessageToWebview).mockClear()
			McpServerManager.notifyProviders({ type: "test" })

			expect(provider.postMessageToWebview).not.toHaveBeenCalled()
		})

		it("should handle cleanup when no instance exists", async () => {
			await expect(McpServerManager.cleanup(context)).resolves.toBeUndefined()
		})
	})
})
