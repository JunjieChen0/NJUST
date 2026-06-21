import type { DynamicModelRecord, ListModelsOptions } from "../modelTypes"
import { safeFetch, readBodyWithLimit, DEFAULT_MAX_BODY_BYTES } from "./safeFetch"

export async function fetchGeminiModels(options: ListModelsOptions = {}): Promise<DynamicModelRecord> {
	const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY
	if (!apiKey) {
		throw new Error("Missing Gemini API key")
	}

	const baseUrl = options.baseUrl || "https://generativelanguage.googleapis.com/v1beta"

	const url = new URL(`${baseUrl.replace(/\/$/, "")}/models`)

	// Prefer the `x-goog-api-key` header over the `?key=` query parameter: the
	// query form leaks the key into proxy/CDN/server access logs and error
	// stacks. Some reverse proxies, however, strip the `x-goog-api-key` header
	// (see LibreChat docs), so when the user has configured a non-default
	// baseUrl we fall back to the query parameter for compatibility.
	//
	// Compare hostname + pathname (case-insensitive, slash-normalized) rather
	// than the raw string so trailing-slash and case variants of the official
	// endpoint still get the safer header auth.
	const isDefaultEndpoint = (() => {
		try {
			const parsed = new URL(baseUrl)
			return (
				parsed.hostname.toLowerCase() === "generativelanguage.googleapis.com" &&
				parsed.pathname.replace(/\/+$/, "").toLowerCase() === "/v1beta"
			)
		} catch {
			return false
		}
	})()
	if (isDefaultEndpoint) {
		const res = await safeFetch(
			url.toString(),
			{
				headers: {
					Accept: "application/json",
					"x-goog-api-key": apiKey,
				},
			},
			{ retries: 2 },
		)

		if (!res.ok) {
			const body = await readBodyWithLimit(res, 100 * 1024).catch(() => "")
			throw new Error(`Failed to fetch Gemini models: ${res.status} ${body}`)
		}

		const text = await readBodyWithLimit(res, DEFAULT_MAX_BODY_BYTES)
		const json = JSON.parse(text)
		const list = Array.isArray(json.models) ? json.models : []

		return parseGeminiModels(list)
	}

	// Custom/proxy endpoint: keep query-param auth for compatibility with
	// proxies that strip custom headers.
	url.searchParams.set("key", apiKey)
	const res = await safeFetch(
		url.toString(),
		{
			headers: {
				Accept: "application/json",
			},
		},
		{ retries: 2 },
	)

	if (!res.ok) {
		const body = await readBodyWithLimit(res, 100 * 1024).catch(() => "")
		throw new Error(`Failed to fetch Gemini models: ${res.status} ${body}`)
	}

	const text = await readBodyWithLimit(res, DEFAULT_MAX_BODY_BYTES)
	const json = JSON.parse(text)
	const list = Array.isArray(json.models) ? json.models : []

	return parseGeminiModels(list)
}

/** Parse the raw `models` array from a Gemini models response. */
function parseGeminiModels(list: unknown[]): DynamicModelRecord {
	const models: DynamicModelRecord = {}

	for (const item of list as Array<Record<string, unknown>>) {
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
		}
	}

	return models
}
