import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: vi.fn(function (this: any, url: URL, options: any) {
		this.url = url
		this.options = options
		this.onerror = null
		this.onclose = null
	}),
}))

vi.mock("../../../../shared/logger", () => ({
	logger: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	},
}))

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import { StreamableHttpTransportStrategy } from "../StreamableHttpTransportStrategy"
import type { TransportCallbacks } from "../ITransportStrategy"

describe("StreamableHttpTransportStrategy", () => {
	let strategy: StreamableHttpTransportStrategy
	let callbacks: TransportCallbacks

	const createOptions = async (config: Record<string, any>) => {
		await strategy.createTransport("testServer", config, callbacks)
		return vi.mocked(StreamableHTTPClientTransport).mock.calls[0][1] as any
	}

	/** Runs the strategy's fetch wrapper against a hanging fetch so abort timing is observable. */
	const runFetch = async (options: any, init: RequestInit) => {
		let captured: RequestInit | undefined
		const pending = new Promise<Response>(() => {})
		vi.stubGlobal(
			"fetch",
			vi.fn((_url: any, requestInit: RequestInit) => {
				captured = requestInit
				return pending
			}),
		)
		void options.fetch("https://example.test/mcp", init)
		return () => captured
	}

	beforeEach(() => {
		vi.clearAllMocks()
		strategy = new StreamableHttpTransportStrategy()
		callbacks = {
			onError: vi.fn(),
			onClose: vi.fn(),
			onReconnectExhausted: vi.fn(),
		}
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	it("has the streamable-http transport type", () => {
		expect(strategy.type).toBe("streamable-http")
	})

	it("creates the SDK transport with the configured URL and headers", async () => {
		const options = await createOptions({
			url: "https://example.test/mcp",
			headers: { Authorization: "Bearer token" },
		})

		const url = vi.mocked(StreamableHTTPClientTransport).mock.calls[0][0] as URL
		expect(url.toString()).toBe("https://example.test/mcp")
		expect(options.requestInit.headers).toEqual({ Authorization: "Bearer token" })
	})

	it("rejects an invalid URL", async () => {
		await expect(strategy.createTransport("testServer", { url: "::bad::" }, callbacks)).rejects.toThrow()
	})

	it("merges configured headers into requests", async () => {
		const options = await createOptions({
			url: "https://example.test/mcp",
			headers: { Authorization: "Bearer token" },
		})
		const fetchSpy = vi.fn(async () => new Response("ok"))
		vi.stubGlobal("fetch", fetchSpy)

		await options.fetch("https://example.test/mcp", { headers: { "X-Base": "1" } })

		const init = fetchSpy.mock.calls[0][1] as RequestInit
		const headers = new Headers(init.headers)
		expect(headers.get("X-Base")).toBe("1")
		expect(headers.get("Authorization")).toBe("Bearer token")
	})

	it("aborts non-tool requests after 15 seconds", async () => {
		const options = await createOptions({ url: "https://example.test/mcp" })
		vi.useFakeTimers()
		const captured = await runFetch(options, { body: JSON.stringify({ method: "initialize" }) })

		await vi.advanceTimersByTimeAsync(15_000)

		expect(captured()?.signal?.aborted).toBe(true)
	})

	it("grants tools/call requests the longer 120 second budget", async () => {
		const options = await createOptions({ url: "https://example.test/mcp" })
		vi.useFakeTimers()
		const captured = await runFetch(options, { body: JSON.stringify({ method: "tools/call" }) })

		await vi.advanceTimersByTimeAsync(15_000)
		expect(captured()?.signal?.aborted).toBe(false)

		await vi.advanceTimersByTimeAsync(105_000)
		expect(captured()?.signal?.aborted).toBe(true)
	})

	it("recognizes tools/call inside a batched request body", async () => {
		const options = await createOptions({ url: "https://example.test/mcp" })
		vi.useFakeTimers()
		const captured = await runFetch(options, {
			body: JSON.stringify([{ method: "initialize" }, { method: "tools/call" }]),
		})

		await vi.advanceTimersByTimeAsync(15_000)
		expect(captured()?.signal?.aborted).toBe(false)
	})

	it("falls back to the short timeout for unparsable bodies", async () => {
		const options = await createOptions({ url: "https://example.test/mcp" })
		vi.useFakeTimers()
		const captured = await runFetch(options, { body: "not json" })

		await vi.advanceTimersByTimeAsync(15_000)

		expect(captured()?.signal?.aborted).toBe(true)
		const { logger } = await import("../../../../shared/logger")
		expect(logger.debug).toHaveBeenCalled()
	})

	it("reports transport errors through the callback", async () => {
		await createOptions({ url: "https://example.test/mcp" })
		const transport = vi.mocked(StreamableHTTPClientTransport).mock.instances[0] as any
		const error = new Error("http boom")

		await transport.onerror(error)

		expect(callbacks.onError).toHaveBeenCalledWith(error)
	})

	it("surfaces disconnects as reconnect-exhausted before closing", async () => {
		await createOptions({ url: "https://example.test/mcp" })
		const transport = vi.mocked(StreamableHTTPClientTransport).mock.instances[0] as any

		await transport.onclose()

		expect(callbacks.onReconnectExhausted).toHaveBeenCalledWith("testServer")
		expect(callbacks.onClose).toHaveBeenCalled()
	})
})
