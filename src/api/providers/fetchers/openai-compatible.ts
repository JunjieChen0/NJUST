import type { ProviderName } from "@njust-ai/types"
import type { DynamicModelRecord, ListModelsOptions } from "../modelTypes"
import { safeFetch, readBodyWithLimit, DEFAULT_MAX_BODY_BYTES, joinUrl } from "./safeFetch"
import { PROVIDER_BASE_URLS, API_PATHS } from "../../../shared/provider-endpoints"

interface ProviderConfig {
	apiKeyEnv: string
	baseUrlEnv: string
	defaultBaseUrl: string
	path: string
}

const configs: Partial<Record<ProviderName, ProviderConfig>> = {
	openai: {
		apiKeyEnv: "OPENAI_API_KEY",
		baseUrlEnv: "OPENAI_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.openai}${API_PATHS.openaiVersion}`,
		path: "/models",
	},
	mistral: {
		apiKeyEnv: "MISTRAL_API_KEY",
		baseUrlEnv: "MISTRAL_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.mistral}${API_PATHS.openaiVersion}`,
		path: "/models",
	},
	xai: {
		apiKeyEnv: "XAI_API_KEY",
		baseUrlEnv: "XAI_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.xai}${API_PATHS.openaiVersion}`,
		path: "/models",
	},
	qwen: {
		apiKeyEnv: "QWEN_API_KEY",
		baseUrlEnv: "QWEN_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.qwen}${API_PATHS.qwenCompatible}`,
		path: "/models",
	},
	moonshot: {
		apiKeyEnv: "MOONSHOT_API_KEY",
		baseUrlEnv: "MOONSHOT_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.moonshot}${API_PATHS.openaiVersion}`,
		path: "/models",
	},
	glm: {
		apiKeyEnv: "GLM_API_KEY",
		baseUrlEnv: "GLM_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.glm}${API_PATHS.glmVersion}`,
		path: "/models",
	},
	minimax: {
		apiKeyEnv: "MINIMAX_API_KEY",
		baseUrlEnv: "MINIMAX_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.minimax}${API_PATHS.openaiVersion}`,
		path: "/models",
	},
	deepseek: {
		apiKeyEnv: "DEEPSEEK_API_KEY",
		baseUrlEnv: "DEEPSEEK_BASE_URL",
		defaultBaseUrl: PROVIDER_BASE_URLS.deepseek,
		path: "/models",
	},
	"openai-native": {
		apiKeyEnv: "OPENAI_NATIVE_API_KEY",
		baseUrlEnv: "OPENAI_NATIVE_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.openai}${API_PATHS.openaiVersion}`,
		path: "/models",
	},
	fireworks: {
		apiKeyEnv: "FIREWORKS_API_KEY",
		baseUrlEnv: "FIREWORKS_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.fireworks}${API_PATHS.fireworksInference}`,
		path: "/models",
	},
	sambanova: {
		apiKeyEnv: "SAMBANOVA_API_KEY",
		baseUrlEnv: "SAMBANOVA_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.sambanova}${API_PATHS.openaiVersion}`,
		path: "/models",
	},
	baseten: {
		apiKeyEnv: "BASETEN_API_KEY",
		baseUrlEnv: "BASETEN_BASE_URL",
		defaultBaseUrl: `${PROVIDER_BASE_URLS.baseten}${API_PATHS.openaiVersion}`,
		path: "/models",
	},
	doubao: {
		apiKeyEnv: "DOUBAO_API_KEY",
		baseUrlEnv: "DOUBAO_BASE_URL",
		defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
		path: "/models",
	},
	mimo: {
		apiKeyEnv: "MIMO_API_KEY",
		baseUrlEnv: "MIMO_BASE_URL",
		defaultBaseUrl: "https://api.xiaomimimo.com/v1",
		path: "/models",
	},
}

export async function fetchOpenAICompatibleModels(
	provider: ProviderName,
	options: ListModelsOptions = {},
): Promise<DynamicModelRecord> {
	const config = configs[provider]
	if (!config) {
		throw new Error(`Unsupported OpenAI-compatible provider: ${provider}`)
	}

	const apiKey = options.apiKey ?? process.env[config.apiKeyEnv]
	if (!apiKey) {
		throw new Error(`Missing API key for provider: ${provider}`)
	}

	const baseUrl = options.baseUrl || process.env[config.baseUrlEnv] || config.defaultBaseUrl

	const res = await safeFetch(
		joinUrl(baseUrl, config.path),
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
		},
		{ retries: 2 },
	)

	if (!res.ok) {
		const body = await readBodyWithLimit(res, 100 * 1024).catch(() => "")
		throw new Error(`Failed to fetch models for ${provider}: ${res.status} ${body}`)
	}

	const text = await readBodyWithLimit(res, DEFAULT_MAX_BODY_BYTES)
	const json = JSON.parse(text)
	const list = Array.isArray(json.data) ? json.data : Array.isArray(json.models) ? json.models : []

	const models: DynamicModelRecord = {}

	for (const item of list) {
		const id: string | undefined = item.id ?? item.name
		if (!id || typeof id !== "string") continue

		models[id] = {
			maxTokens: item.max_tokens ?? item.maxTokens ?? undefined,
			contextWindow: item.context_window ?? item.contextWindow ?? 128_000,
			supportsPromptCache: false,
			deprecated: Boolean(item.deprecated),
			source: "api",
		}
	}

	return models
}
