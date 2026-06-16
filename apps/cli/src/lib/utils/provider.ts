import { NJUST_AISettings } from "@njust-ai/types"

import type { SupportedProvider } from "@/types/index.js"

const envVarMap: Record<SupportedProvider, string> = {
	anthropic: "ANTHROPIC_API_KEY",
	bedrock: "AWS_ACCESS_KEY_ID",
	baseten: "BASETEN_API_KEY",
	deepseek: "DEEPSEEK_API_KEY",
	fireworks: "FIREWORKS_API_KEY",
	gemini: "GOOGLE_API_KEY",
	"gemini-cli": "GOOGLE_API_KEY",
	mistral: "MISTRAL_API_KEY",
	moonshot: "MOONSHOT_API_KEY",
	minimax: "MINIMAX_API_KEY",
	qwen: "QWEN_API_KEY",
	"qwen-code": "QWEN_API_KEY",
	doubao: "DOUBAO_API_KEY",
	glm: "GLM_API_KEY",
	"openai-codex": "OPENAI_API_KEY",
	"openai-native": "OPENAI_API_KEY",
	openai: "OPENAI_API_KEY",
	sambanova: "SAMBANOVA_API_KEY",
	vertex: "GOOGLE_API_KEY",
	xai: "XAI_API_KEY",
	zai: "ZAI_API_KEY",
	mimo: "MIMO_API_KEY",
	"mimo-token-plan": "MIMO_TOKEN_PLAN_API_KEY",
	openrouter: "OPENROUTER_API_KEY",
	"vercel-ai-gateway": "VERCEL_AI_GATEWAY_API_KEY",
	litellm: "LITELLM_API_KEY",
	requesty: "REQUESTY_API_KEY",
	"njust-ai": "NJUST_AI_API_KEY",
	unbound: "UNBOUND_API_KEY",
	ollama: "", // Local, no API key needed
	lmstudio: "", // Local, no API key needed
}

export function getEnvVarName(provider: SupportedProvider): string {
	return envVarMap[provider]
}

export function getApiKeyFromEnv(provider: SupportedProvider): string | undefined {
	const envVar = getEnvVarName(provider)
	return process.env[envVar]
}

export function getProviderSettings(
	provider: SupportedProvider,
	apiKey: string | undefined,
	model: string | undefined,
): NJUST_AISettings {
	const config: NJUST_AISettings = { apiProvider: provider }

	// Map provider to its specific API key field and model ID field
	const providerConfigMap: Record<string, { apiKeyField?: string; modelIdField?: string }> = {
		anthropic: { apiKeyField: "apiKey", modelIdField: "apiModelId" },
		openai: { apiKeyField: "openAiApiKey", modelIdField: "openAiModelId" },
		"openai-native": { apiKeyField: "openAiNativeApiKey", modelIdField: "apiModelId" },
		gemini: { apiKeyField: "geminiApiKey", modelIdField: "apiModelId" },
		"gemini-cli": { apiKeyField: undefined, modelIdField: "apiModelId" },
		openrouter: { apiKeyField: "openRouterApiKey", modelIdField: "openRouterModelId" },
		"vercel-ai-gateway": { apiKeyField: "vercelAiGatewayApiKey", modelIdField: "vercelAiGatewayModelId" },
		"njust-ai": { apiKeyField: "rooApiKey", modelIdField: "apiModelId" },
		deepseek: { apiKeyField: "deepSeekApiKey", modelIdField: "apiModelId" },
		bedrock: { apiKeyField: "awsApiKey", modelIdField: "apiModelId" },
		vertex: { apiKeyField: undefined, modelIdField: "apiModelId" },
		mistral: { apiKeyField: "mistralApiKey", modelIdField: "apiModelId" },
		moonshot: { apiKeyField: "moonshotApiKey", modelIdField: "apiModelId" },
		minimax: { apiKeyField: "minimaxApiKey", modelIdField: "apiModelId" },
		qwen: { apiKeyField: "qwenApiKey", modelIdField: "apiModelId" },
		"qwen-code": { apiKeyField: undefined, modelIdField: "apiModelId" },
		doubao: { apiKeyField: "doubaoApiKey", modelIdField: "apiModelId" },
		glm: { apiKeyField: "glmApiKey", modelIdField: "apiModelId" },
		mimo: { apiKeyField: "mimoApiKey", modelIdField: "apiModelId" },
		"mimo-token-plan": { apiKeyField: "mimoTokenPlanApiKey", modelIdField: "apiModelId" },
		requesty: { apiKeyField: "requestyApiKey", modelIdField: "requestyModelId" },
		unbound: { apiKeyField: "unboundApiKey", modelIdField: "unboundModelId" },
		xai: { apiKeyField: "xaiApiKey", modelIdField: "apiModelId" },
		litellm: { apiKeyField: "litellmApiKey", modelIdField: "litellmModelId" },
		sambanova: { apiKeyField: "sambaNovaApiKey", modelIdField: "apiModelId" },
		zai: { apiKeyField: "zaiApiKey", modelIdField: "apiModelId" },
		fireworks: { apiKeyField: "fireworksApiKey", modelIdField: "apiModelId" },
		baseten: { apiKeyField: "basetenApiKey", modelIdField: "apiModelId" },
		ollama: { apiKeyField: "ollamaApiKey", modelIdField: "ollamaModelId" },
		lmstudio: { apiKeyField: undefined, modelIdField: "lmStudioModelId" },
		"openai-codex": { apiKeyField: undefined, modelIdField: "apiModelId" },
		"vscode-lm": { apiKeyField: undefined, modelIdField: "apiModelId" },
		"fake-ai": { apiKeyField: undefined, modelIdField: "apiModelId" },
	}

	const mapping = providerConfigMap[provider]
	if (mapping) {
		const mutableConfig = config as Record<string, string | undefined>
		if (apiKey && mapping.apiKeyField) {
			mutableConfig[mapping.apiKeyField] = apiKey
		}
		if (model && mapping.modelIdField) {
			mutableConfig[mapping.modelIdField] = model
		}
	} else {
		// Fallback for unknown providers
		if (apiKey) config.apiKey = apiKey
		if (model) config.apiModelId = model
	}

	return config
}
