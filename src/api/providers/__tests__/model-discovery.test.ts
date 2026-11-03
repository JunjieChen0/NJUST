import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { OpenAiNativeHandler } from "../openai-native"
import { AnthropicHandler } from "../anthropic"
import { GeminiHandler } from "../gemini"
import { QwenHandler } from "../qwen"
import { listProviderModels } from "../fetchers/modelCache"
import { setModelCacheStore } from "../fetchers/modelCacheStore"
import { fetchAnthropicModels } from "../fetchers/anthropic"
import { fetchGeminiModels } from "../fetchers/gemini"

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
beforeEach(() => setModelCacheStore(undefined))
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe("model discovery and selected model resolution", () => {
	it.each(["anthropic", "gemini"] as const)("%s rejects repeated pagination cursors", async (provider) => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				json(
					provider === "anthropic"
						? { data: [{ id: "page-one" }], has_more: true, last_id: "cursor" }
						: {
								models: [{ name: "models/page-one", supportedGenerationMethods: ["generateContent"] }],
								nextPageToken: "cursor",
							},
				),
			),
		)
		await expect(
			(provider === "anthropic" ? fetchAnthropicModels : fetchGeminiModels)({ apiKey: "fixture" }),
		).rejects.toThrow(/pagination/i)
	})
	it.each(["openai-native", "anthropic", "gemini"] as const)(
		"%s uses a new model actually returned by its API",
		async (provider) => {
			const id = `review-new-${provider}-model`
			vi.stubGlobal(
				"fetch",
				vi.fn(async () =>
					json(
						provider === "gemini"
							? {
									models: [
										{
											name: `models/${id}`,
											supportedGenerationMethods: ["generateContent"],
											inputTokenLimit: 777777,
										},
									],
								}
							: { data: [{ id, context_window: 777777, max_input_tokens: 777777 }] },
					),
				),
			)
			const models = await listProviderModels(provider, { apiKey: "fixture", forceRefresh: true })
			expect(models[id]).toBeDefined()
			const options = {
				apiModelId: id,
				apiKey: "fixture",
				openAiNativeApiKey: "fixture",
				geminiApiKey: "fixture",
			}
			const handler =
				provider === "openai-native"
					? new OpenAiNativeHandler(options)
					: provider === "anthropic"
						? new AnthropicHandler(options)
						: new GeminiHandler(options)
			expect(handler.getModel().id).toBe(id)
		},
	)
	it("Qwen uses the capabilities of a newly discovered model", async () => {
		const id = "review-new-qwen-model"
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json({ data: [{ id, context_window: 777777, max_tokens: 12345 }] })),
		)
		const models = await listProviderModels("qwen", { apiKey: "fixture", forceRefresh: true })
		expect(models[id]?.contextWindow).toBe(777777)
		const handler = new QwenHandler({ apiModelId: id, qwenApiKey: "fixture" })
		expect(handler.getModel().id).toBe(id)
		expect(handler.getModel().info.contextWindow).toBe(777777)
	})
	it("Anthropic follows has_more rather than returning only the first page", async () => {
		const request = vi.fn(async (url: string) =>
			json(
				new URL(url).searchParams.has("after_id")
					? { data: [{ id: "review-page-2" }], has_more: false, last_id: "review-page-2" }
					: { data: [{ id: "review-page-1" }], has_more: true, last_id: "review-page-1" },
			),
		)
		vi.stubGlobal("fetch", request)
		const models = await fetchAnthropicModels({ apiKey: "fixture" })
		expect(Object.keys(models)).toEqual(["review-page-1", "review-page-2"])
	})
	it("Gemini follows nextPageToken rather than returning only the first page", async () => {
		const request = vi.fn(async (url: string) =>
			json(
				new URL(url).searchParams.has("pageToken")
					? { models: [{ name: "models/review-page-2", supportedGenerationMethods: ["generateContent"] }] }
					: {
							models: [{ name: "models/review-page-1", supportedGenerationMethods: ["generateContent"] }],
							nextPageToken: "next",
						},
			),
		)
		vi.stubGlobal("fetch", request)
		const models = await fetchGeminiModels({ apiKey: "fixture" })
		expect(Object.keys(models)).toEqual(["review-page-1", "review-page-2"])
	})
	it("MiMo Token Plan honestly reports unsupported listing and retains custom model IDs", async () => {
		const request = vi.fn()
		vi.stubGlobal("fetch", request)
		const { resolveProviderCatalog } = await import("../fetchers/modelCache")
		const { MimoTokenPlanHandler } = await import("../mimo-token-plan")
		const result = await resolveProviderCatalog("mimo-token-plan", { apiKey: "fixture", forceRefresh: true })
		expect(request).not.toHaveBeenCalled()
		expect(result).toMatchObject({ source: "hardcoded-fallback", refreshError: "unsupported" })
		expect(
			new MimoTokenPlanHandler({ apiModelId: "new-token-plan-model", mimoTokenPlanApiKey: "fixture" }).getModel()
				.id,
		).toBe("new-token-plan-model")
	})
})
