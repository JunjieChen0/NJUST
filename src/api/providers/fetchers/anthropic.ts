import type { DynamicModelRecord, ListModelsOptions } from "../modelTypes"
import { safeFetch, readBodyWithLimit, DEFAULT_MAX_BODY_BYTES } from "./safeFetch"

export async function fetchAnthropicModels(options: ListModelsOptions = {}): Promise<DynamicModelRecord> {
	const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY
	if (!apiKey) {
		throw new Error("Missing Anthropic API key")
	}

	const baseUrl = options.baseUrl || "https://api.anthropic.com/v1"

	const res = await safeFetch(
		`${baseUrl.replace(/\/$/, "")}/models`,
		{
			headers: {
				"x-api-key": apiKey,
				"anthropic-version": "2023-06-01",
				Accept: "application/json",
			},
		},
		{ retries: 2 },
	)

	if (!res.ok) {
		const body = await readBodyWithLimit(res, 100 * 1024).catch(() => "")
		throw new Error(`Failed to fetch Anthropic models: ${res.status} ${body}`)
	}

	const text = await readBodyWithLimit(res, DEFAULT_MAX_BODY_BYTES)
	const json = JSON.parse(text)
	const list = Array.isArray(json.data) ? json.data : []

	const models: DynamicModelRecord = {}

	for (const item of list) {
		if (!item.id) continue

		models[item.id] = {
			maxTokens: item.max_tokens ?? undefined,
			contextWindow: item.max_input_tokens ?? 200_000,
			supportsImages: item.capabilities?.image_input?.supported ?? undefined,
			supportsPromptCache: item.capabilities?.prompt_cache?.supported ?? false,
			supportsReasoningBudget: item.capabilities?.thinking?.supported ?? undefined,
			deprecated: Boolean(item.deprecated),
			source: "api",
		}
	}

	return models
}
