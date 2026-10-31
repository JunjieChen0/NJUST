import { vi } from "vitest"
import type * as vscode from "vscode"

export function createMockExtensionContext(overrides: Record<string, unknown> = {}): vscode.ExtensionContext {
	return {
		extensionPath: "/test/path",
		extensionUri: {},
		globalState: { get: vi.fn(), update: vi.fn(), keys: vi.fn(() => []) },
		workspaceState: { get: vi.fn(), update: vi.fn(), keys: vi.fn(() => []) },
		secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
		subscriptions: [],
		extension: { packageJSON: { version: "1.0.0" } },
		globalStorageUri: { fsPath: "/test/storage/path" },
		...overrides,
	} as unknown as vscode.ExtensionContext
}

export function createMockOutputChannel(overrides: Record<string, unknown> = {}): vscode.OutputChannel {
	return {
		name: "test",
		append: vi.fn(),
		appendLine: vi.fn(),
		replace: vi.fn(),
		clear: vi.fn(),
		show: vi.fn(),
		hide: vi.fn(),
		dispose: vi.fn(),
		...overrides,
	} as unknown as vscode.OutputChannel
}

export function createMockWebviewView(overrides: Record<string, unknown> = {}): vscode.WebviewView {
	return {
		webview: {
			html: "",
			options: {},
			postMessage: vi.fn(),
			onDidReceiveMessage: vi.fn(),
			asWebviewUri: vi.fn(),
			cspSource: "vscode-webview://test-csp-source",
		},
		visible: true,
		onDidDispose: vi.fn(),
		onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
		...overrides,
	} as unknown as vscode.WebviewView
}

export function createMockClineProvider(
	overrides: Record<string, unknown> = {},
): import("../../core/webview/ClineProvider").ClineProvider {
	return {
		log: vi.fn(),
		postMessageToWebview: vi.fn().mockResolvedValue(undefined),
		postStateToWebview: vi.fn().mockResolvedValue(undefined),
		refreshWorkspace: vi.fn().mockResolvedValue(undefined),
		getState: vi.fn().mockResolvedValue({}),
		getCurrentTask: vi.fn(),
		getSkillsManager: vi.fn(),
		getMcpHub: vi.fn(),
		contextProxy: {
			getValue: vi.fn(),
			setValue: vi.fn().mockResolvedValue(undefined),
			globalStorageUri: { fsPath: "/test/storage" },
		},
		providerSettingsManager: {},
		...overrides,
	} as unknown as import("../../core/webview/ClineProvider").ClineProvider
}

export function createMockTextDocument(overrides: Record<string, unknown> = {}): vscode.TextDocument {
	return {
		uri: { fsPath: "/test/file.ts" },
		fileName: "/test/file.ts",
		languageId: "typescript",
		lineAt: () => ({ text: "" }),
		getText: () => "",
		...overrides,
	} as unknown as vscode.TextDocument
}

export function createMockTask(overrides: Record<string, unknown> = {}): import("../../core/task/Task").Task {
	return {
		taskId: "mock-task",
		instanceId: "mock-instance",
		cwd: "/mock/workspace",
		abort: false,
		abandoned: false,
		apiConversationHistory: [],
		clineMessages: [],
		todoList: [],
		emit: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		abortTask: vi.fn().mockResolvedValue(undefined),
		cancelCurrentRequest: vi.fn(),
		...overrides,
	} as unknown as import("../../core/task/Task").Task
}
