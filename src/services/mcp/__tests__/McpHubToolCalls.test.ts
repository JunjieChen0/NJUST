import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../shared/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: { reportError: vi.fn() },
}))

import { callToolWithHub, readResourceWithHub, type McpToolCallHost } from "../McpHubToolCalls"

type FakeConnection = {
	type: "connected" | "disconnected"
	server: { name: string; disabled: boolean; config: string }
	client: { request: ReturnType<typeof vi.fn> } | null
}

const validConfig = JSON.stringify({ type: "stdio", command: "node", timeout: 5 })

const makeHost = (connection: FakeConnection | undefined): McpToolCallHost => ({
	findConnection: vi.fn(() => connection) as McpToolCallHost["findConnection"],
})

const makeConnection = (overrides: Partial<FakeConnection> & { disabled?: boolean; config?: string } = {}) => {
	const { disabled, config, ...rest } = overrides as any
	const connection: FakeConnection = {
		type: "connected",
		server: { name: "srv", disabled: disabled ?? false, config: config ?? validConfig },
		client: { request: vi.fn().mockResolvedValue({ content: [] }) },
		...rest,
	}
	return connection
}

describe("readResourceWithHub", () => {
	beforeEach(() => vi.clearAllMocks())

	it("throws when no connection exists", async () => {
		await expect(readResourceWithHub(makeHost(undefined), "srv", "file:///a")).rejects.toThrow(
			/No connection found for server: srv/,
		)
	})

	it("includes the source in the missing-connection message", async () => {
		await expect(readResourceWithHub(makeHost(undefined), "srv", "file:///a", "project")).rejects.toThrow(
			/with source project/,
		)
	})

	it("throws when the server is disabled", async () => {
		await expect(
			readResourceWithHub(makeHost(makeConnection({ disabled: true })), "srv", "file:///a"),
		).rejects.toThrow(/disabled/)
	})

	it("requests resources/read from the connected client", async () => {
		const connection = makeConnection()

		const result = await readResourceWithHub(makeHost(connection), "srv", "file:///a")

		expect(connection.client!.request).toHaveBeenCalledWith(
			{ method: "resources/read", params: { uri: "file:///a" } },
			expect.anything(),
		)
		expect(result).toEqual({ content: [] })
	})
})

describe("callToolWithHub", () => {
	beforeEach(() => vi.clearAllMocks())

	it("throws when no connection exists", async () => {
		await expect(callToolWithHub(makeHost(undefined), "srv", "do")).rejects.toThrow(/Connected MCP Servers/)
	})

	it("throws when the server is disabled", async () => {
		await expect(callToolWithHub(makeHost(makeConnection({ disabled: true })), "srv", "do")).rejects.toThrow(
			/disabled and cannot be used/,
		)
	})

	it("uses the timeout from the server config", async () => {
		const connection = makeConnection()

		await callToolWithHub(makeHost(connection), "srv", "do", { a: 1 })

		expect(connection.client!.request).toHaveBeenCalledWith(
			{ method: "tools/call", params: { name: "do", arguments: { a: 1 } } },
			expect.anything(),
			{ timeout: 5000 },
		)
	})

	it("falls back to 60s when the config cannot be parsed", async () => {
		const connection = makeConnection({ config: "{not json" })
		const { logger } = await import("../../../shared/logger")

		await callToolWithHub(makeHost(connection), "srv", "do")

		expect(logger.error).toHaveBeenCalled()
		expect(connection.client!.request).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
			timeout: 60_000,
		})
	})

	it("rejects arguments that cannot be serialized", async () => {
		const circular: Record<string, unknown> = {}
		circular.self = circular

		await expect(callToolWithHub(makeHost(makeConnection()), "srv", "do", circular)).rejects.toThrow(
			/Cannot serialize tool arguments for "do" on server "srv"/,
		)
	})

	it("passes undefined arguments through when omitted", async () => {
		const connection = makeConnection()

		await callToolWithHub(makeHost(connection), "srv", "do")

		expect(connection.client!.request).toHaveBeenCalledWith(
			{ method: "tools/call", params: { name: "do", arguments: undefined } },
			expect.anything(),
			{ timeout: 5000 },
		)
	})
})
