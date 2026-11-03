import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Messages as AnthropicMessages } from "@anthropic-ai/sdk/resources/messages"
import { ProviderRegistry } from "../../registry/ProviderRegistry"
import { OpenAiNativeHandler } from "../openai-native"
import { AnthropicHandler } from "../anthropic"
import { GeminiHandler } from "../gemini"
import { listProviderModels } from "../fetchers/modelCache"
import { setModelCacheStore } from "../fetchers/modelCacheStore"
import { resolveModelInfo } from "../resolveModelInfo"

const json = (value: unknown) => new Response(JSON.stringify(value))
beforeEach(() => setModelCacheStore(undefined))
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe("model preparation before request construction", () => {
	it("freezes the selected model's discovered limits until the next preparation", async () => {
		const id = "discovered-request-model"
		const key = "preparation-fixture"
		const fetch = vi.fn(async () => json({ data: [{ id, context_window: 777777, max_tokens: 12345 }] }))
		vi.stubGlobal("fetch", fetch)
		const registry = new ProviderRegistry()
		let native!: OpenAiNativeHandler
		registry.register("openai-native", (options) => (native = new OpenAiNativeHandler(options)))
		const api = registry.createHandler({ apiProvider: "openai-native", apiModelId: id, openAiNativeApiKey: key })
		await api.prepareModel?.()
		expect(api.getModel()).toMatchObject({
			id,
			info: { contextWindow: 777777, maxTokens: 12345, pricingUnknown: true },
		})
		const request = vi.spyOn(native.client.responses, "create").mockResolvedValue(
			(async function* () {
				yield { type: "response.output_text.delta", delta: "ok" }
			})() as never,
		)
		for await (const chunk of api.createMessage("system", [{ role: "user", content: "fixture" }]))
			expect(chunk.type).toBe("text")
		expect(request.mock.calls[0][0]).toMatchObject({ model: id, max_output_tokens: 12345 })
		fetch.mockImplementation(async () => json({ data: [{ id, context_window: 888888, max_tokens: 23456 }] }))
		await listProviderModels("openai-native", { apiKey: key, forceRefresh: true })
		expect(api.getModel().info.contextWindow).toBe(777777)
		await api.prepareModel?.()
		expect(api.getModel().info.contextWindow).toBe(888888)
	})
	it("Anthropic sends a new selected model ID to the SDK", async () => {
		const handler = new AnthropicHandler({ apiKey: "fixture", apiModelId: "new-anthropic-model" })
		const request = vi
			.spyOn(AnthropicMessages.prototype, "create")
			.mockResolvedValue({ content: [{ type: "text", text: "ok" }] } as never)
		await handler.completePrompt("fixture")
		expect(request.mock.calls[0][0]).toMatchObject({ model: "new-anthropic-model" })
	})
	it("Gemini sends a new selected model ID to the SDK", async () => {
		const handler = new GeminiHandler({ geminiApiKey: "fixture", apiModelId: "new-gemini-model" })
		const request = vi.spyOn(handler._client.models, "generateContent").mockResolvedValue({ text: "ok" } as never)
		await handler.completePrompt("fixture")
		expect(request.mock.calls[0][0]).toMatchObject({ model: "new-gemini-model" })
	})
	it("keeps curated capabilities of an exact model when listing omits them", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json({ data: [{ id: "exact-model" }] })),
		)
		await listProviderModels("qwen", { apiKey: "curated-fixture", forceRefresh: true })
		const info = resolveModelInfo("qwen", { qwenApiKey: "curated-fixture" }, "exact-model", {
			contextWindow: 64000,
			maxTokens: 8192,
			supportsPromptCache: true,
			supportsImages: true,
			inputPrice: 1,
			outputPrice: 2,
		})
		expect(info).toMatchObject({
			contextWindow: 64000,
			maxTokens: 8192,
			supportsPromptCache: true,
			supportsImages: true,
			pricingUnknown: false,
		})
	})
	it("does not borrow another model's capabilities or claim unknown pricing is free", () => {
		const info = resolveModelInfo("qwen", { qwenApiKey: "unknown-fixture" }, "unknown-model")
		expect(info).toMatchObject({ metadataSource: "estimated", pricingUnknown: true })
		expect(info.inputPrice).toBeUndefined()
		expect(info.supportsImages).toBeUndefined()
	})
})
