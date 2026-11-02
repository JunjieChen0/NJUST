import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("vscode", () => ({ window: { showInformationMessage: vi.fn() } }))
vi.mock("delay", () => ({ default: vi.fn(async () => undefined) }))
vi.mock("fs/promises", () => ({ readFile: vi.fn() }))
vi.mock("../../i18n", () => ({ t: (key: string) => key }))
vi.mock("../../shared/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock("@njust-ai/telemetry", () => ({ TelemetryService: { reportError: vi.fn() } }))

import * as fs from "fs/promises"

import {
	type McpConnectionLifecycleHost,
	type McpLifecycleConnection,
	type McpServerConfig,
	type McpSource,
	refreshAllConnectionsWithHub,
	restartConnectionWithHub,
	updateServerConnectionsWithHub,
} from "../McpHubConnectionLifecycle"

const makeConnection = (
	name: string,
	options: { source?: "global" | "project"; config?: string } = {},
): McpLifecycleConnection => ({
	type: "connected",
	server: {
		name,
		source: options.source ?? "global",
		config: options.config ?? JSON.stringify({ command: name }),
		disabled: false,
		status: "connected",
		error: "",
	},
})

type HostState = { connections: McpLifecycleConnection[]; isConnecting: boolean }

const makeHost = (
	initial: Partial<HostState> = {},
	overrides: Partial<McpConnectionLifecycleHost> = {},
): { host: McpConnectionLifecycleHost; state: HostState } => {
	const state: HostState = {
		connections: initial.connections ?? [],
		isConnecting: initial.isConnecting ?? false,
	}

	const host: McpConnectionLifecycleHost = {
		getConnections: () => state.connections,
		getIsConnecting: () => state.isConnecting,
		setIsConnecting: (value) => {
			state.isConnecting = value
		},
		isMcpEnabled: vi.fn(async () => true),
		deleteConnection: vi.fn(async () => undefined),
		findConnection: vi.fn(() => undefined),
		validateServerConfig: vi.fn((config: unknown) => config as McpServerConfig),
		showErrorMessage: vi.fn(),
		connectToServer: vi.fn(async () => undefined),
		notifyWebviewOfServerChanges: vi.fn(async () => undefined),
		initializeMcpServers: vi.fn(async () => undefined),
		getMcpSettingsFilePath: vi.fn(async () => "/global/mcp_settings.json"),
		getProjectMcpPath: vi.fn(async () => null),
		...overrides,
	}

	return { host, state }
}

describe("updateServerConnectionsWithHub", () => {
	beforeEach(() => vi.clearAllMocks())

	it("deletes servers that disappeared from the config", async () => {
		const { host } = makeHost({ connections: [makeConnection("old")] })

		await updateServerConnectionsWithHub(host, {})

		expect(host.deleteConnection).toHaveBeenCalledWith("old", "global")
	})

	it("connects new servers (connectToServer installs their watchers)", async () => {
		const { host } = makeHost()

		await updateServerConnectionsWithHub(host, { fresh: { command: "node" } })

		expect(host.connectToServer).toHaveBeenCalledWith("fresh", expect.anything(), "global")
	})

	it("still connects disabled servers (connectToServer skips their watchers)", async () => {
		const { host } = makeHost(
			{},
			{
				validateServerConfig: vi.fn(
					(config: unknown) => ({ ...(config as object), disabled: true }) as McpServerConfig,
				),
			},
		)

		await updateServerConnectionsWithHub(host, { off: { command: "node" } })

		expect(host.connectToServer).toHaveBeenCalledWith("off", expect.objectContaining({ disabled: true }), "global")
	})

	it("reconnects when the stored config differs", async () => {
		const existing = makeConnection("srv", { config: JSON.stringify({ command: "old" }) })
		const { host } = makeHost({ connections: [existing] }, { findConnection: vi.fn(() => existing) })

		await updateServerConnectionsWithHub(host, { srv: { command: "new" } })

		expect(host.deleteConnection).toHaveBeenCalledWith("srv", "global")
		expect(host.connectToServer).toHaveBeenCalled()
	})

	it("leaves unchanged servers alone", async () => {
		const config = { command: "same" }
		const existing = makeConnection("srv", { config: JSON.stringify(config) })
		const { host } = makeHost({ connections: [existing] }, { findConnection: vi.fn(() => existing) })

		await updateServerConnectionsWithHub(host, { srv: config })

		expect(host.deleteConnection).not.toHaveBeenCalled()
		expect(host.connectToServer).not.toHaveBeenCalled()
	})

	it("reports invalid configs without connecting", async () => {
		const { host } = makeHost(
			{},
			{
				validateServerConfig: vi.fn(() => {
					throw new Error("bad config")
				}),
			},
		)

		await updateServerConnectionsWithHub(host, { broken: {} })

		expect(host.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("broken"), expect.any(Error))
		expect(host.connectToServer).not.toHaveBeenCalled()
	})

	describe("file watchers", () => {
		/** Models McpHub: connectToServer installs a server's watchers, deleteConnection removes them. */
		const withWatcherRegistry = (connections: McpLifecycleConnection[]) => {
			const watchers = new Map<string, number>()
			const key = (name: string, source?: string) => `${source ?? "global"}:${name}`
			const install = (name: string, config: McpServerConfig, source?: McpSource) => {
				if (!config.disabled) watchers.set(key(name, source), (watchers.get(key(name, source)) ?? 0) + 1)
			}
			const { host } = makeHost(
				{ connections },
				{
					findConnection: vi.fn((name: string, source?: McpSource) =>
						connections.find((c) => c.server.name === name && c.server.source === source),
					),
					deleteConnection: vi.fn(async (name: string, source?: McpSource) => {
						watchers.delete(key(name, source))
					}),
					connectToServer: vi.fn(async (name: string, config: McpServerConfig, source?: McpSource) =>
						install(name, config, source),
					),
				},
			)
			for (const c of connections) {
				install(c.server.name, JSON.parse(c.server.config) as McpServerConfig, c.server.source)
			}
			return { host, watchers }
		}

		it("keeps watchers of unchanged servers and of the other source", async () => {
			const { host, watchers } = withWatcherRegistry([
				makeConnection("a", { source: "global" }),
				makeConnection("b", { source: "project" }),
			])

			await updateServerConnectionsWithHub(host, { a: { command: "a" } }, "global")

			expect([...watchers.entries()]).toEqual([
				["global:a", 1],
				["project:b", 1],
			])
		})

		it("ends with exactly one watcher set for a changed server", async () => {
			const { host, watchers } = withWatcherRegistry([
				makeConnection("a", { config: JSON.stringify({ command: "old" }) }),
			])

			await updateServerConnectionsWithHub(host, { a: { command: "new" } }, "global")

			expect(watchers.get("global:a")).toBe(1)
		})

		it("installs exactly one watcher set for a new server", async () => {
			const { host, watchers } = withWatcherRegistry([])

			await updateServerConnectionsWithHub(host, { fresh: { command: "node" } }, "global")

			expect(watchers.get("global:fresh")).toBe(1)
		})
	})

	it("clears the connecting flag only when it manages the state", async () => {
		const managed = makeHost()
		await updateServerConnectionsWithHub(managed.host, {})
		expect(managed.state.isConnecting).toBe(false)

		const unmanaged = makeHost({ isConnecting: true })
		await updateServerConnectionsWithHub(unmanaged.host, {}, "global", false)
		expect(unmanaged.state.isConnecting).toBe(true)
	})
})

describe("restartConnectionWithHub", () => {
	beforeEach(() => vi.clearAllMocks())

	it("returns early when MCP is disabled", async () => {
		const { host, state } = makeHost({}, { isMcpEnabled: vi.fn(async () => false) })

		await restartConnectionWithHub(host, "srv")

		expect(host.deleteConnection).not.toHaveBeenCalled()
		expect(state.isConnecting).toBe(false)
	})

	it("only notifies when the server has no config", async () => {
		const { host } = makeHost({}, { findConnection: vi.fn(() => undefined) })

		await restartConnectionWithHub(host, "missing")

		expect(host.deleteConnection).not.toHaveBeenCalled()
		expect(host.notifyWebviewOfServerChanges).toHaveBeenCalled()
	})

	it("deletes and reconnects a server with config", async () => {
		const connection = makeConnection("srv")
		const { host } = makeHost({ connections: [connection] }, { findConnection: vi.fn(() => connection) })

		await restartConnectionWithHub(host, "srv")

		expect(host.deleteConnection).toHaveBeenCalledWith("srv", "global")
		expect(host.connectToServer).toHaveBeenCalledWith("srv", expect.anything(), "global")
	})

	it("reports validation failures during restart", async () => {
		const connection = makeConnection("srv")
		const { host } = makeHost(
			{ connections: [connection] },
			{
				findConnection: vi.fn(() => connection),
				validateServerConfig: vi.fn(() => {
					throw new Error("invalid")
				}),
			},
		)

		await restartConnectionWithHub(host, "srv")

		expect(host.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("srv"), expect.anything())
	})
})

describe("refreshAllConnectionsWithHub", () => {
	beforeEach(() => vi.clearAllMocks())

	it("does nothing while another connection attempt is running", async () => {
		const { host } = makeHost({ isConnecting: true })

		await refreshAllConnectionsWithHub(host)

		expect(host.isMcpEnabled).not.toHaveBeenCalled()
	})

	it("clears connections and re-initializes when MCP is disabled", async () => {
		const { host } = makeHost(
			{ connections: [makeConnection("a"), makeConnection("b")] },
			{ isMcpEnabled: vi.fn(async () => false) },
		)

		await refreshAllConnectionsWithHub(host)

		expect(host.deleteConnection).toHaveBeenCalledTimes(2)
		expect(host.initializeMcpServers).toHaveBeenCalledWith("global")
		expect(host.initializeMcpServers).toHaveBeenCalledWith("project")
		expect(host.notifyWebviewOfServerChanges).toHaveBeenCalled()
	})

	it("reloads servers from disk", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ mcpServers: { a: {} } }) as never)
		const { host, state } = makeHost({ connections: [makeConnection("old")] })

		await refreshAllConnectionsWithHub(host)

		expect(host.deleteConnection).toHaveBeenCalledWith("old", "global")
		expect(host.initializeMcpServers).toHaveBeenCalledTimes(2)
		expect(state.isConnecting).toBe(false)
	})

	it("reports failures while refreshing", async () => {
		vi.mocked(fs.readFile).mockResolvedValue("{}" as never)
		const { host, state } = makeHost(
			{},
			{ getMcpSettingsFilePath: vi.fn(async () => Promise.reject(new Error("io"))) },
		)

		await refreshAllConnectionsWithHub(host)

		expect(host.showErrorMessage).toHaveBeenCalledWith("Failed to refresh MCP servers", expect.any(Error))
		expect(state.isConnecting).toBe(false)
	})
})
