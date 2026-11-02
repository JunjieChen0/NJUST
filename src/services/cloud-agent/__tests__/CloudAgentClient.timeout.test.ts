/**
 * REST: the request timeout and the task abort signal must stay armed until the
 * response body has been fully read, not just until the headers arrive.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import { CloudAgentClient } from "../CloudAgentClient"
import type { CloudAgentProfile } from "../types/profile"
import { setDeviceToken } from "../deviceToken"
import { asMock } from "../../../__tests__/helpers/asMock"

setDeviceToken("device-token")

const profile: CloudAgentProfile = {
	id: "rest-timeout",
	name: "REST timeout",
	protocolType: "rest",
	serverUrl: "http://localhost:8765",
	auth: { type: "api-key", apiKey: "secret-key", deviceTokenSource: "global" },
	createdAt: Date.now(),
	updatedAt: Date.now(),
}

const callbacks = {
	onText: vi.fn(async () => {}),
	onReasoning: vi.fn(async () => {}),
	onDone: vi.fn(async () => {}),
	onError: vi.fn(async () => {}),
}

/** fetch that sends headers immediately but never finishes the body unless the request signal aborts. */
function stallingBodyFetch(): typeof fetch {
	return asMock<typeof fetch>(
		vi.fn(async (_url: unknown, init?: RequestInit) => {
			const signal = init?.signal
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new TextEncoder().encode('{"ok":true,'))
					signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")))
				},
			})
			return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } })
		}),
	)
}

const originalFetch = globalThis.fetch
afterEach(() => {
	globalThis.fetch = originalFetch
})

const calls: Array<[string, (c: CloudAgentClient) => Promise<unknown>]> = [
	["submitTask", (c) => c.submitTask("s1", "goal", "/ws")],
	["compile", (c) => c.compile("s1", "/ws")],
	["deferredStart", (c) => c.deferredStart("s1", "goal", "/ws")],
]

describe("CloudAgentClient REST body read", () => {
	it.each(calls)(
		"%s: request timeout still applies while reading the body",
		async (_name, call) => {
			globalThis.fetch = stallingBodyFetch()
			const client = new CloudAgentClient(callbacks, { profile, requestTimeoutMs: 50 })

			const started = Date.now()
			await expect(call(client)).rejects.toThrow()
			expect(Date.now() - started).toBeLessThan(1_500)
		},
		3_000,
	)

	it.each(calls)(
		"%s: task abort still applies while reading the body",
		async (_name, call) => {
			globalThis.fetch = stallingBodyFetch()
			const abort = new AbortController()
			// A long timeout forces the merged-signal path, which is where the bug lived.
			const client = new CloudAgentClient(callbacks, { profile, signal: abort.signal, requestTimeoutMs: 60_000 })

			const started = Date.now()
			const pending = call(client)
			setTimeout(() => abort.abort(), 30)
			await expect(pending).rejects.toThrow()
			expect(Date.now() - started).toBeLessThan(1_500)
		},
		3_000,
	)
})
