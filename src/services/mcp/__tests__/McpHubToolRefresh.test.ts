import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../shared/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: { reportError: vi.fn() },
}))

import type { McpTool } from "@njust-ai/types"

import { refreshToolsWithHub, type McpToolRefreshHost } from "../McpHubToolRefresh"

const makeConnection = (name: string, type: "connected" | "disconnected" = "connected", source = "global") => ({
	type,
	server: { name, source, tools: [] as McpTool[] },
})

const makeHost = (
	connections: ReturnType<typeof makeConnection>[],
	fetchToolsList: (name: string, source?: string) => Promise<McpTool[]> = async () => [],
): McpToolRefreshHost => ({
	connections,
	fetchToolsList,
	notifyWebviewOfServerChanges: vi.fn().mockResolvedValue(undefined),
})

describe("refreshToolsWithHub", () => {
	beforeEach(() => vi.clearAllMocks())

	it("returns an empty map and warns when nothing is connected", async () => {
		const host = makeHost([makeConnection("srv", "disconnected")])
		const { logger } = await import("../../../shared/logger")

		const result = await refreshToolsWithHub(host)

		expect(result.size).toBe(0)
		expect(logger.warn).toHaveBeenCalled()
		expect(host.notifyWebviewOfServerChanges).not.toHaveBeenCalled()
	})

	it("mentions the requested server when it is not connected", async () => {
		const host = makeHost([makeConnection("other")])
		const { logger } = await import("../../../shared/logger")

		await refreshToolsWithHub(host, "missing")

		expect(logger.warn).toHaveBeenCalledWith("McpHub", expect.stringContaining('for "missing"'))
	})

	it("updates the tool list and reports counts", async () => {
		const connection = makeConnection("srv")
		const fetchToolsList = vi.fn(async () => [{ name: "a" }, { name: "b" }] as McpTool[])
		const host = makeHost([connection], fetchToolsList)

		const result = await refreshToolsWithHub(host)

		expect(result.get("srv")).toBe(2)
		expect(connection.server.tools).toHaveLength(2)
		expect(fetchToolsList).toHaveBeenCalledWith("srv", "global")
		expect(host.notifyWebviewOfServerChanges).toHaveBeenCalled()
	})

	it("marks failed refreshes with -1 and still notifies", async () => {
		const connection = makeConnection("srv", "connected", "project")
		const fetchToolsList = vi.fn(async () => {
			throw new Error("boom")
		})
		const host = makeHost([connection], fetchToolsList)
		const { TelemetryService } = await import("@njust-ai/telemetry")

		const result = await refreshToolsWithHub(host)

		expect(result.get("srv")).toBe(-1)
		expect(TelemetryService.reportError).toHaveBeenCalled()
		expect(host.notifyWebviewOfServerChanges).toHaveBeenCalled()
	})

	it("only refreshes the requested server", async () => {
		const a = makeConnection("a")
		const b = makeConnection("b")
		const fetchToolsList = vi.fn(async () => [] as McpTool[])
		const host = makeHost([a, b], fetchToolsList)

		await refreshToolsWithHub(host, "b")

		expect(fetchToolsList).toHaveBeenCalledTimes(1)
		expect(fetchToolsList).toHaveBeenCalledWith("b", "global")
	})
})
