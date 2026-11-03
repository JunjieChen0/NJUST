import type { DynamicModelRecord, ListModelsOptions } from "../modelTypes"
import { safeFetch, readBodyWithLimit, DEFAULT_MAX_BODY_BYTES, DEFAULT_FETCH_TIMEOUT_MS, joinUrl } from "./safeFetch"

export async function fetchGeminiModels(options: ListModelsOptions = {}): Promise<DynamicModelRecord> {
	const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY
	if (!apiKey) throw new Error("Missing Gemini API key")
	const baseUrl = options.baseUrl || "https://generativelanguage.googleapis.com/v1beta"
	const url = new URL(joinUrl(baseUrl, "models"))
	const deadline = AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)
	const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline
	const models: DynamicModelRecord = {}
	const seen = new Set<string>()
	for (let page = 0; page < 100; page++) {
		const res = await safeFetch(
			url.toString(),
			{ headers: { Accept: "application/json", "x-goog-api-key": apiKey, ...options.headers } },
			{ retries: 2, signal },
		)
		if (!res.ok) {
			await readBodyWithLimit(res, 100 * 1024)
			throw Object.assign(new Error("Failed to fetch Gemini models: " + res.status), { status: res.status })
		}
		const json = JSON.parse(await readBodyWithLimit(res, DEFAULT_MAX_BODY_BYTES))
		if (!Array.isArray(json.models)) throw new SyntaxError("Invalid Gemini model list")
		Object.assign(models, parseGeminiModels(json.models))
		if (!json.nextPageToken) return models
		if (typeof json.nextPageToken !== "string" || seen.has(json.nextPageToken))
			throw new SyntaxError("Incomplete Gemini pagination")
		seen.add(json.nextPageToken)
		url.searchParams.set("pageToken", json.nextPageToken)
	}
	throw new SyntaxError("Gemini pagination limit exceeded")
}

/** Parse the raw `models` array from a Gemini models response. */
function parseGeminiModels(list: unknown[]): DynamicModelRecord {
	const models: DynamicModelRecord = {}

	for (const item of list as Array<Record<string, unknown>>) {
		if (!item || typeof item !== "object") continue
		const rawName: string | undefined = item.name as string | undefined
		if (!rawName) continue

		const id = rawName.replace(/^models\//, "")

		const methods: string[] = Array.isArray(item.supportedGenerationMethods)
			? (item.supportedGenerationMethods as string[])
			: []

		if (!methods.includes("generateContent")) {
			continue
		}

		models[id] = {
			maxTokens: item.outputTokenLimit as number | undefined,
			contextWindow: (item.inputTokenLimit as number | undefined) ?? 1_000_000,
			supportsPromptCache: false,
			source: "api",
			metadataSource: "api",
			pricingUnknown: true,
			estimatedFields: [
				...(item.inputTokenLimit ? [] : ["contextWindow"]),
				...(item.outputTokenLimit ? [] : ["maxTokens"]),
				"supportsPromptCache",
			],
		}
	}

	return models
}
