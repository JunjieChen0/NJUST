import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
	SSEClientTransport: vi.fn(function (this: any, url: URL, options: any) {
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

import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"

import { SseTransportStrategy } from "../SseTransportStrategy"
import type { TransportCallbacks } from "../ITransportStrategy"

describe("SseTransportStrategy", () => {
	let strategy: SseTransportStrategy
	let callbacks: TransportCallbacks

	const createOptions = async (config: Record<string, any>) => {
		await strategy.createTransport("testServer", config, callbacks)
		return vi.mocked(SSEClientTransport).mock.calls[0][1] as any
	}

	beforeEach(() => {
		vi.clearAllMocks()
		strategy = new SseTransportStrategy()
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

	it("has the sse transport type", () => {
		expect(strategy.type).toBe("sse")
	})

	it("creates the SDK transport with the configured URL and headers", async () => {
		const options = await createOptions({
			url: "https://example.test/sse",
			headers: { Authorization: "Bearer token" },
		})

		const url = vi.mocked(SSEClientTransport).mock.calls[0][0] as URL
		expect(url.toString()).toBe("https://example.test/sse")
		expect(options.requestInit.headers).toEqual({ Authorization: "Bearer token" })
	})

	it("rejects an invalid URL", async () => {
		await expect(strategy.createTransport("testServer", { url: "not a url" }, callbacks)).rejects.toThrow()
	})

	it("merges configured headers into the handshake fetch", async () => {
		const options = await createOptions({
			url: "https://example.test/sse",
			headers: { Authorization: "Bearer token" },
		})
		const fetchSpy = vi.fn(async () => new Response("ok"))
		vi.stubGlobal("fetch", fetchSpy)

		await options.eventSourceInit.fetch("https://example.test/sse", { headers: { "X-Base": "1" } })

		const init = fetchSpy.mock.calls[0][1] as RequestInit
		const headers = new Headers(init.headers)
		expect(headers.get("X-Base")).toBe("1")
		expect(headers.get("Authorization")).toBe("Bearer token")
	})

	it("aborts the handshake fetch after 15 seconds", async () => {
		const options = await createOptions({ url: "https://example.test/sse" })
		let captured: RequestInit | undefined
		const pending = new Promise<Response>(() => {})
		vi.stubGlobal(
			"fetch",
			vi.fn((_url: any, init: RequestInit) => {
				captured = init
				return pending
			}),
		)
		vi.useFakeTimers()

		void options.eventSourceInit.fetch("https://example.test/sse", {})

		await vi.advanceTimersByTimeAsync(14_999)
		expect(captured?.signal?.aborted).toBe(false)

		await vi.advanceTimersByTimeAsync(1)
		expect(captured?.signal?.aborted).toBe(true)
	})

	it("reports transport errors through the callback", async () => {
		await createOptions({ url: "https://example.test/sse" })
		const transport = vi.mocked(SSEClientTransport).mock.instances[0] as any
		const error = new Error("sse boom")

		await transport.onerror(error)

		expect(callbacks.onError).toHaveBeenCalledWith(error)
	})

	it("surfaces disconnects as reconnect-exhausted before closing", async () => {
		await createOptions({ url: "https://example.test/sse" })
		const transport = vi.mocked(SSEClientTransport).mock.instances[0] as any

		await transport.onclose()

		expect(callbacks.onReconnectExhausted).toHaveBeenCalledWith("testServer")
		expect(callbacks.onClose).toHaveBeenCalled()
	})

	it("still closes when no reconnect-exhausted handler is provided", async () => {
		callbacks = { onError: vi.fn(), onClose: vi.fn() } as TransportCallbacks
		await createOptions({ url: "https://example.test/sse" })
		const transport = vi.mocked(SSEClientTransport).mock.instances[0] as any

		await expect(transport.onclose()).resolves.toBeUndefined()
		expect(callbacks.onClose).toHaveBeenCalled()
	})
})
