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
