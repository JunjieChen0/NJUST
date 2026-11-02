import { describe, it, expect, vi, beforeEach } from "vitest"

const { created } = vi.hoisted(() => ({ created: [] as Array<{ close: ReturnType<typeof vi.fn> }> }))

vi.mock("chokidar", () => ({
	default: {
		watch: vi.fn(() => {
			const watcher = { on: vi.fn(), close: vi.fn() }
			created.push(watcher)
			return watcher
		}),
	},
}))
vi.mock("../../../shared/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock("@njust-ai/telemetry", () => ({ TelemetryService: { reportError: vi.fn() } }))

import { McpHubFileWatcherManager } from "../McpHubFileWatcherManager"

const config = { type: "stdio", command: "node", watchPaths: ["/srv/src"] } as never
const restart = vi.fn(async () => undefined)

const open = () => created.filter((w) => w.close.mock.calls.length === 0).length

describe("McpHubFileWatcherManager", () => {
	beforeEach(() => {
		created.length = 0
		vi.clearAllMocks()
	})

	it("keeps same-named servers from different sources apart", () => {
		const manager = new McpHubFileWatcherManager()
		manager.setupFileWatcher("srv", config, "global", restart)
		manager.setupFileWatcher("srv", config, "project", restart)

		manager.removeForServer("srv", "global")

		expect(open()).toBe(1)
		expect(created[0]!.close).toHaveBeenCalled()
		expect(created[1]!.close).not.toHaveBeenCalled()
	})

	it("replaces rather than duplicates watchers when set up twice", () => {
		const manager = new McpHubFileWatcherManager()
		manager.setupFileWatcher("srv", config, "global", restart)
		manager.setupFileWatcher("srv", config, "global", restart)

		expect(open()).toBe(1)
	})

	it("removes every source when no source is given", () => {
		const manager = new McpHubFileWatcherManager()
		manager.setupFileWatcher("srv", config, "global", restart)
		manager.setupFileWatcher("srv", config, "project", restart)

		manager.removeForServer("srv")

		expect(open()).toBe(0)
	})
})
