import type { DynamicModelRecord, ListModelsOptions } from "../modelTypes"
import { safeFetch, readBodyWithLimit, DEFAULT_MAX_BODY_BYTES, DEFAULT_FETCH_TIMEOUT_MS, joinUrl } from "./safeFetch"

export async function fetchAnthropicModels(options: ListModelsOptions = {}): Promise<DynamicModelRecord> {
	const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
	if (!apiKey) throw new Error("Missing Anthropic API key")
	const url = new URL(joinUrl(options.baseUrl || "https://api.anthropic.com/v1", "models"))
	const deadline = AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)
	const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
	const models: DynamicModelRecord = {}
	const seen = new Set<string>()
	const headers: Record<string, string> = {
		"x-api-key": apiKey,
		"anthropic-version": "2023-06-01",
		Accept: "application/json",
		...options.headers,
	}
	if (headers["x-api-key"] === "") delete headers["x-api-key"]
	for (let page = 0; page < 100; page++) {
		const res = await safeFetch(url.toString(), { headers }, { retries: 2, signal })
		if (!res.ok) {
			await readBodyWithLimit(res, 100 * 1024)
			throw Object.assign(new Error("Failed to fetch Anthropic models: " + res.status), { status: res.status })
		}
		const json = JSON.parse(await readBodyWithLimit(res, DEFAULT_MAX_BODY_BYTES))
		if (!Array.isArray(json.data)) throw new SyntaxError("Invalid Anthropic model list")
		for (const item of json.data) {
			if (!item || typeof item.id !== "string") continue
			models[item.id] = {
				maxTokens: item.max_tokens ?? undefined,
				contextWindow: item.max_input_tokens ?? 200_000,
				supportsImages: item.capabilities?.image_input?.supported ?? undefined,
				supportsPromptCache: item.capabilities?.prompt_cache?.supported ?? false,
				supportsReasoningBudget: item.capabilities?.thinking?.supported ?? undefined,
				...(typeof item.deprecated === "boolean" ? { deprecated: item.deprecated } : {}),
				estimatedFields: [
					...(item.max_input_tokens ? [] : ["contextWindow"]),
					...(item.max_tokens ? [] : ["maxTokens"]),
					...(typeof item.capabilities?.prompt_cache?.supported === "boolean" ? [] : ["supportsPromptCache"]),
				],
				metadataSource: "api",
				pricingUnknown: true,
				source: "api",
			}
		}
		if (!json.has_more) return models
		if (typeof json.last_id !== "string" || !json.last_id || seen.has(json.last_id))
			throw new SyntaxError("Incomplete Anthropic pagination")
		seen.add(json.last_id)
		url.searchParams.set("after_id", json.last_id)
	}
	throw new SyntaxError("Anthropic pagination limit exceeded")
}
