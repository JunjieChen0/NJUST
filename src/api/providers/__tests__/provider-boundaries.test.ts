import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
const { streamText } = vi.hoisted(() => ({ streamText: vi.fn() }))
vi.mock("ai", () => ({
	streamText,
	generateText: vi.fn(),
	tool: (value: unknown) => value,
	jsonSchema: (value: unknown) => value,
}))

import { OpenAiNativeHandler } from "../openai-native"
import { QwenHandler } from "../qwen"
import { GlmHandler } from "../glm"
import { MimoHandler } from "../mimo"
import { MimoTokenPlanHandler } from "../mimo-token-plan"
import { MoonshotHandler } from "../moonshot"
import { OpenAiCodexHandler } from "../openai-codex"
import { openAiCodexOAuthManager } from "../../../integrations/openai-codex/oauth"
import { wrapApiHandler } from "../../retry/ApiRetryWrapper"
import { safeFetch, readBodyWithLimit } from "../fetchers/safeFetch"

const messages = [{ role: "user" as const, content: "review fixture" }]
const native = (baseUrl?: string) =>
	new OpenAiNativeHandler({
		apiModelId: "gpt-4.1",
		openAiNativeApiKey: "fixture",
		openAiNativeBaseUrl: baseUrl,
	})
const collect = async (iterable: AsyncIterable<unknown>) => {
	const chunks: unknown[] = []
	for await (const chunk of iterable) chunks.push(chunk)
	return chunks
}
const sse = (text: string) =>
	new Response(
		new ReadableStream({
			start(controller) {
				controller.enqueue(
					new TextEncoder().encode(
						"data: " + JSON.stringify({ type: "response.output_text.delta", delta: text }) + "\n\n",
					),
				)
				controller.close()
			},
		}),
		{ headers: { "content-type": "text/event-stream" } },
	)
const usage = {
	inputTokens: 100,
	outputTokens: 40,
	inputTokenDetails: { noCacheTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0 },
	outputTokenDetails: { textTokens: 30, reasoningTokens: 10 },
}
beforeEach(() => {
	streamText.mockReset()
	streamText.mockImplementation(() => ({
		fullStream: (async function* () {
			yield { type: "text-delta", text: "fixture" }
		})(),
		usage: Promise.resolve(usage),
	}))
})
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})

describe("provider request boundaries", () => {
	it("stops an AI SDK request when its consumer stops reading", async () => {
		const iterator = new QwenHandler({ qwenApiKey: "fixture" }).createMessage("system", messages)
		await iterator.next()
		const signal = streamText.mock.calls[0]?.[0]?.abortSignal
		await iterator.return(undefined)
		expect(signal?.aborted).toBe(true)
	})
	it("OpenAI Native forwards cancellation to the SDK request", async () => {
		const handler = native()
		let release!: (value: unknown) => void
		const request = vi.spyOn(handler.client.responses, "create").mockReturnValue(
			new Promise((resolve) => {
				release = resolve
			}) as never,
		)
		const controller = new AbortController()
		const iterator = handler.createMessage("system", messages, { taskId: "review", signal: controller.signal })
		const pending = iterator.next()
		try {
			await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
			controller.abort()
			expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
		} finally {
			release(
				(async function* () {
					yield { type: "response.output_text.delta", delta: "fixture" }
				})(),
			)
			await expect(pending).rejects.toMatchObject({ name: "AbortError" })
			await iterator.return(undefined)
		}
	})
	it("Qwen and the shared AI SDK adapter forward cancellation", async () => {
		const controller = new AbortController()
		const handler = new QwenHandler({ qwenApiKey: "fixture" })
		const iterator = handler.createMessage("system", messages, { taskId: "review", signal: controller.signal })
		await iterator.next()
		try {
			controller.abort()
			expect(streamText.mock.calls[0]?.[0]?.abortSignal?.aborted).toBe(true)
		} finally {
			await iterator.return(undefined)
		}
	})
	it("OpenAI Native does not replay a request after delivering text", async () => {
		const handler = native()
		vi.spyOn(handler.client.responses, "create").mockResolvedValue(
			(async function* () {
				yield { type: "response.output_text.delta", delta: "same answer" }
				throw new Error("stream connection lost")
			})() as never,
		)
		const fallback = vi.fn(async () => sse("same answer"))
		vi.stubGlobal("fetch", fallback)
		const chunks: unknown[] = []
		let streamError: unknown
		try {
			for await (const chunk of handler.createMessage("system", messages)) chunks.push(chunk)
		} catch (error) {
			streamError = error
		}
		expect({ requests: fallback.mock.calls.length, chunks }).toEqual({
			requests: 0,
			chunks: [{ type: "text", text: "same answer" }],
		})
		expect(streamError).toBeDefined()
	})
	it.each([
		["https://review.invalid/v1", "https://review.invalid/v1/responses"],
		["https://review.invalid/proxy/v1/?tenant=fixture", "https://review.invalid/proxy/v1/responses?tenant=fixture"],
	])("OpenAI Native SDK and fallback preserve the configured endpoint %s", async (baseUrl, expectedUrl) => {
		const handler = native(baseUrl)
		vi.spyOn(handler.client.responses, "create").mockRejectedValue(new Error("stream unavailable"))
		const fallback = vi.fn(async (_url: unknown) => sse("fixture"))
		vi.stubGlobal("fetch", fallback)
		await collect(handler.createMessage("system", messages))
		expect(fallback.mock.calls[0]?.[0]).toBe(expectedUrl)
		expect(handler.client.baseURL).not.toContain("?")
	})
	it("model-list timeout remains active while reading a stalled body", async () => {
		vi.useFakeTimers()
		let control!: ReadableStreamDefaultController<Uint8Array>
		let signal: AbortSignal | undefined
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url, init) => {
				signal = init.signal
				return new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							control = controller
						},
					}),
				)
			}),
		)
		const response = await safeFetch("https://review.invalid/models", {}, { timeoutMs: 10 })
		const body = readBodyWithLimit(response, 1024).catch(() => "")
		try {
			await vi.advanceTimersByTimeAsync(20)
			expect(signal?.aborted).toBe(true)
		} finally {
			control.error(new Error("fixture cleanup"))
			await body
		}
	})
	it.each([
		new QwenHandler({ qwenApiKey: "fixture" }),
		new GlmHandler({ glmApiKey: "fixture" }),
		new MimoHandler({ mimoApiKey: "fixture" }),
		new MimoTokenPlanHandler({ mimoTokenPlanApiKey: "fixture" }),
		new MoonshotHandler({ moonshotApiKey: "fixture" }),
	])("$constructor.name reads installed SDK v6 usage fields", async (handler) => {
		const chunks = await collect(handler.createMessage("system", messages))
		expect(chunks).toContainEqual(
			expect.objectContaining({ type: "usage", cacheReadTokens: 80, reasoningTokens: 10 }),
		)
	})
	it("does not start a cancelled request or a fallback", async () => {
		const handler = native()
		const request = vi.spyOn(handler.client.responses, "create")
		const fallback = vi.fn()
		vi.stubGlobal("fetch", fallback)
		const controller = new AbortController()
		controller.abort()
		await expect(
			collect(handler.createMessage("system", messages, { taskId: "fixture", signal: controller.signal })),
		).rejects.toMatchObject({ name: "AbortError" })
		expect(request).not.toHaveBeenCalled()
		expect(fallback).not.toHaveBeenCalled()
	})
	it("cancellation during retry backoff prevents another request", async () => {
		vi.useFakeTimers()
		const handler = native()
		const request = vi
			.spyOn(handler.client.responses, "create")
			.mockRejectedValue(Object.assign(new Error("rate limit"), { status: 429 }))
		const controller = new AbortController()
		const result = collect(
			wrapApiHandler(handler).createMessage("system", messages, { taskId: "fixture", signal: controller.signal }),
		)
		const check = expect(result).rejects.toMatchObject({ name: "AbortError" })
		await vi.advanceTimersByTimeAsync(0)
		controller.abort()
		await check
		await vi.runAllTimersAsync()
		expect(request).toHaveBeenCalledTimes(1)
	})
	it.each([401, 403])("does not retry or fall back on HTTP %s", async (status) => {
		const handler = native()
		const request = vi
			.spyOn(handler.client.responses, "create")
			.mockRejectedValue(Object.assign(new Error("stream access denied"), { status }))
		const fallback = vi.fn()
		vi.stubGlobal("fetch", fallback)
		await expect(collect(wrapApiHandler(handler).createMessage("system", messages))).rejects.toMatchObject({
			status,
		})
		expect(request).toHaveBeenCalledTimes(1)
		expect(fallback).not.toHaveBeenCalled()
	})
	it("Codex does not replay after delivering partial output", async () => {
		vi.spyOn(openAiCodexOAuthManager, "getAccessToken").mockResolvedValue("fixture")
		vi.spyOn(openAiCodexOAuthManager, "getAccountId").mockResolvedValue("fixture-account")
		const handler = new OpenAiCodexHandler({})
		Object.assign(handler, {
			client: {
				responses: {
					create: vi.fn().mockResolvedValue(
						(async function* () {
							yield { type: "response.output_text.delta", delta: "partial" }
							throw new Error("stream connection lost")
						})(),
					),
				},
			},
		})
		const fallback = vi.fn()
		vi.stubGlobal("fetch", fallback)
		const iterator = handler.createMessage("system", messages)
		expect(await iterator.next()).toMatchObject({ value: { type: "text", text: "partial" } })
		await expect(iterator.next()).rejects.toThrow("stream connection lost")
		expect(fallback).not.toHaveBeenCalled()
	})
})
