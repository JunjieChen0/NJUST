/**
 * End-to-end: CloudAgentClient → McpProtocolAdapter → real MCP SDK (InMemory transport).
 * Covers response parsing (workspace_ops inside content[].text) and
 * cancellation / timeout propagation to the server.
 */
import { describe, expect, it, afterEach, vi } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { z } from "zod"

import { CloudAgentClient } from "../CloudAgentClient"
import { McpProtocolAdapter } from "../adapters/McpProtocolAdapter"
import type { CloudAgentProfile } from "../types/profile"
import type { CloudAgentCallbacks } from "../types"
import { asMock } from "../../../__tests__/helpers/asMock"

vi.mock("../../../shared/logger", () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const profile: CloudAgentProfile = {
	id: "mcp-e2e",
	name: "MCP e2e",
	protocolType: "mcp",
	serverUrl: "http://127.0.0.1:4000",
	auth: { type: "api-key", apiKey: "test-key", deviceTokenSource: "global" },
	createdAt: Date.now(),
	updatedAt: Date.now(),
}

const callbacks: CloudAgentCallbacks = {
	onText: vi.fn(async () => {}),
	onReasoning: vi.fn(async () => {}),
	onDone: vi.fn(async () => {}),
	onError: vi.fn(async () => {}),
}

const submitTaskShape = { sessionId: z.string(), message: z.string(), workspacePath: z.string().optional() }

let cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
	for (const fn of cleanup) await fn().catch(() => {})
	cleanup = []
})

async function connectClient(
	server: McpServer,
	options: { signal?: AbortSignal; requestTimeoutMs?: number } = {},
): Promise<CloudAgentClient> {
	const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
	await server.connect(serverTransport)

	const adapter = new McpProtocolAdapter()
	adapter.initialize(profile)
	const sdkClient = new Client({ name: "njust-ai", version: "1.0.0" }, { capabilities: {} })
	await sdkClient.connect(clientTransport)
	Object.assign(asMock<Record<string, unknown>>(adapter), {
		transport: clientTransport,
		client: sdkClient,
		connected: true,
	})
	cleanup.push(
		() => adapter.disconnect(),
		() => server.close(),
	)

	return new CloudAgentClient(callbacks, { profile, ...options }, { create: () => adapter })
}

describe("CloudAgentClient over MCP (InMemory)", () => {
	it("extracts workspace_ops from the JSON inside content[].text", async () => {
		const server = new McpServer({ name: "t", version: "1.0.0" }, { capabilities: { tools: {} } })
		server.tool("submit_task", "submit", submitTaskShape, async () => ({
			content: [
				{
					type: "text" as const,
					text: JSON.stringify({
						ok: true,
						status: "done",
						workspace_ops: {
							version: 1,
							operations: [{ op: "write_file", path: "src/hello.cj", content: "main() {}" }],
						},
					}),
				},
			],
		}))

		const client = await connectClient(server)
		const result = await client.submitTask("s1", "write hello", "/ws")

		expect(result.workspaceOpsParseError).toBeUndefined()
		expect(result.workspaceOps).toEqual([{ op: "write_file", path: "src/hello.cj", content: "main() {}" }])
	})

	/** A submit_task that only finishes when the client cancels it (or after 5s). */
	function slowServer(): { server: McpServer; wasCancelled: () => boolean } {
		let cancelled = false
		const server = new McpServer({ name: "t", version: "1.0.0" }, { capabilities: { tools: {} } })
		server.tool("submit_task", "submit", submitTaskShape, async (_args, extra) => {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, 5_000)
				extra.signal.addEventListener("abort", () => {
					cancelled = true
					clearTimeout(timer)
					resolve()
				})
			})
			return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, status: "done" }) }] }
		})
		return { server, wasCancelled: () => cancelled }
	}

	it("propagates user cancellation to the server", async () => {
		const { server, wasCancelled } = slowServer()
		const abort = new AbortController()
		const client = await connectClient(server, { signal: abort.signal })

		const started = Date.now()
		const pending = client.submitTask("s1", "slow", "/ws")
		setTimeout(() => abort.abort(), 20)

		await expect(pending).rejects.toThrow()
		expect(Date.now() - started).toBeLessThan(2_000)
		await vi.waitFor(() => expect(wasCancelled()).toBe(true), { timeout: 1_000 })
	})

	it("honours the configured request timeout", async () => {
		const { server, wasCancelled } = slowServer()
		const client = await connectClient(server, { requestTimeoutMs: 30 })

		const started = Date.now()
		await expect(client.submitTask("s1", "slow", "/ws")).rejects.toThrow(/timed out/i)
		expect(Date.now() - started).toBeLessThan(2_000)
		await vi.waitFor(() => expect(wasCancelled()).toBe(true), { timeout: 1_000 })
	})
})
