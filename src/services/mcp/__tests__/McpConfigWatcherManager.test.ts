import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("fs/promises", () => ({ readFile: vi.fn() }))
vi.mock("../../../i18n", () => ({ t: (key: string) => key }))
vi.mock("../../../shared/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock("@njust-ai/telemetry", () => ({ TelemetryService: { reportError: vi.fn() } }))
vi.mock("../../../utils/path", () => ({ arePathsEqual: (a: string, b: string) => a === b }))

const vscodeMocks = vi.hoisted(() => ({
	createFileSystemWatcher: vi.fn(),
	onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
	showErrorMessage: vi.fn(),
	showInformationMessage: vi.fn(),
}))

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/work" } }],
		createFileSystemWatcher: vscodeMocks.createFileSystemWatcher,
		onDidChangeWorkspaceFolders: vscodeMocks.onDidChangeWorkspaceFolders,
	},
	RelativePattern: class {
		constructor(
			public base: unknown,
			public pattern: string,
		) {}
	},
	Disposable: { from: vi.fn(() => ({ dispose: vi.fn() })) },
	window: {
		showErrorMessage: vscodeMocks.showErrorMessage,
		showInformationMessage: vscodeMocks.showInformationMessage,
	},
}))

import * as fs from "fs/promises"

import { TIMING } from "../../../shared/constants"
import { McpConfigWatcherManager, type McpConfigWatcherHost } from "../McpConfigWatcherManager"

const makeWatcher = () => {
	const handlers: Record<string, (uri?: { fsPath: string }) => unknown> = {}
	const watcher = {
		onDidChange: vi.fn((cb: (uri: { fsPath: string }) => unknown) => {
			handlers.change = cb
			return { dispose: vi.fn() }
		}),
		onDidCreate: vi.fn((cb: (uri: { fsPath: string }) => unknown) => {
			handlers.create = cb
			return { dispose: vi.fn() }
		}),
		onDidDelete: vi.fn((cb: () => unknown) => {
			handlers.delete = cb
			return { dispose: vi.fn() }
		}),
		dispose: vi.fn(),
	}

	return { watcher, handlers }
}

const makeHost = (overrides: Partial<McpConfigWatcherHost> = {}): McpConfigWatcherHost => ({
	getWorkspaceFolderPath: () => "/work",
	getProjectMcpPath: vi.fn(async () => "/work/.njust_ai/mcp.json"),
	getMcpSettingsFilePath: vi.fn(async () => "/global/settings.json"),
	ensureProjectMcpTrusted: vi.fn(async () => true),
	updateServerConnections: vi.fn(async () => undefined),
	deleteConnection: vi.fn(async () => undefined),
	getProjectConnectionNames: vi.fn(() => []),
	notifyWebviewOfServerChanges: vi.fn(async () => undefined),
	showErrorMessage: vi.fn(),
	...overrides,
})

describe("McpConfigWatcherManager", () => {
	const originalNodeEnv = process.env.NODE_ENV

	beforeEach(() => {
		vi.clearAllMocks()
		process.env.NODE_ENV = "production"
	})

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv
		vi.useRealTimers()
	})

	it("does not install watchers in the test environment", async () => {
		process.env.NODE_ENV = "test"
		const manager = new McpConfigWatcherManager(makeHost())

		await manager.watchMcpSettingsFile()
		await manager.watchProjectMcpFile()

		expect(vscodeMocks.createFileSystemWatcher).not.toHaveBeenCalled()
	})

	it("reloads global servers after a debounced settings change", async () => {
		vi.useFakeTimers()
		const { watcher, handlers } = makeWatcher()
		vscodeMocks.createFileSystemWatcher.mockReturnValue(watcher)
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ mcpServers: { a: { command: "node" } } }) as never)
		const host = makeHost()
		const manager = new McpConfigWatcherManager(host)

		await manager.watchMcpSettingsFile()
		await handlers.change({ fsPath: "/global/settings.json" })
		await vi.advanceTimersByTimeAsync(TIMING.MCP_CONFIG_CHANGE_DEBOUNCE_MS)

		expect(host.updateServerConnections).toHaveBeenCalledWith(
			expect.objectContaining({ a: expect.objectContaining({ command: "node" }) }),
			"global",
		)
	})

	it("ignores changes while a programmatic update is in flight", async () => {
		vi.useFakeTimers()
		const { watcher, handlers } = makeWatcher()
		vscodeMocks.createFileSystemWatcher.mockReturnValue(watcher)
		const host = makeHost()
		const manager = new McpConfigWatcherManager(host)

		await manager.watchMcpSettingsFile()
		manager.setProgrammaticUpdateFlag()
		await handlers.change({ fsPath: "/global/settings.json" })
		await vi.advanceTimersByTimeAsync(TIMING.MCP_CONFIG_CHANGE_DEBOUNCE_MS)

		expect(host.updateServerConnections).not.toHaveBeenCalled()
	})

	it("reports invalid JSON instead of applying it", async () => {
		vi.useFakeTimers()
		const { watcher, handlers } = makeWatcher()
		vscodeMocks.createFileSystemWatcher.mockReturnValue(watcher)
		vi.mocked(fs.readFile).mockResolvedValue("{not json" as never)
		const host = makeHost()
		const manager = new McpConfigWatcherManager(host)

		await manager.watchMcpSettingsFile()
		await handlers.change({ fsPath: "/global/settings.json" })
		await vi.advanceTimersByTimeAsync(TIMING.MCP_CONFIG_CHANGE_DEBOUNCE_MS)

		expect(host.updateServerConnections).not.toHaveBeenCalled()
		expect(vscodeMocks.showErrorMessage).toHaveBeenCalled()
	})

	it("requires trust before applying project configs", async () => {
		vi.useFakeTimers()
		const { watcher, handlers } = makeWatcher()
		vscodeMocks.createFileSystemWatcher.mockReturnValue(watcher)
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ mcpServers: { p: { command: "node" } } }) as never)
		const host = makeHost({ ensureProjectMcpTrusted: vi.fn(async () => false) })
		const manager = new McpConfigWatcherManager(host)

		await manager.watchProjectMcpFile()
		await handlers.change({ fsPath: "/work/.njust_ai/mcp.json" })
		await vi.advanceTimersByTimeAsync(TIMING.MCP_CONFIG_CHANGE_DEBOUNCE_MS)

		expect(host.updateServerConnections).not.toHaveBeenCalled()
	})

	it("cleans up project servers when the config file disappears", async () => {
		vi.useFakeTimers()
		const { watcher, handlers } = makeWatcher()
		vscodeMocks.createFileSystemWatcher.mockReturnValue(watcher)
		const missing = Object.assign(new Error("missing"), { code: "ENOENT" })
		vi.mocked(fs.readFile).mockRejectedValue(missing as never)
		const host = makeHost({ getProjectConnectionNames: vi.fn(() => ["p1", "p2"]) })
		const manager = new McpConfigWatcherManager(host)

		await manager.watchProjectMcpFile()
		await handlers.change({ fsPath: "/work/.njust_ai/mcp.json" })
		await vi.advanceTimersByTimeAsync(TIMING.MCP_CONFIG_CHANGE_DEBOUNCE_MS)

		expect(host.deleteConnection).toHaveBeenCalledWith("p1", "project")
		expect(host.updateServerConnections).toHaveBeenCalledWith({}, "project", false)
		expect(vscodeMocks.showInformationMessage).toHaveBeenCalled()
	})

	it("cancels pending work on dispose", async () => {
		vi.useFakeTimers()
		const { watcher, handlers } = makeWatcher()
		vscodeMocks.createFileSystemWatcher.mockReturnValue(watcher)
		vi.mocked(fs.readFile).mockResolvedValue("{}" as never)
		const host = makeHost()
		const manager = new McpConfigWatcherManager(host)

		await manager.watchMcpSettingsFile()
		await handlers.change({ fsPath: "/global/settings.json" })
		manager.dispose()
		await vi.advanceTimersByTimeAsync(TIMING.MCP_CONFIG_CHANGE_DEBOUNCE_MS)

		expect(host.updateServerConnections).not.toHaveBeenCalled()
		expect(watcher.dispose).toHaveBeenCalled()
	})
})
