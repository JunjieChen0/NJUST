import type { ProviderName, ProviderSettings } from "@njust-ai/types"
import type { ListModelsOptions } from "./modelTypes"
import { joinUrl } from "./fetchers/safeFetch"
import { resolveMinimaxAnthropicBaseUrl, PROVIDER_BASE_URLS, API_PATHS } from "../../shared/provider-endpoints"

/** Listing uses the same endpoint and authentication fields as inference. */
export function modelConnection(
	provider: ProviderName,
	settings: Omit<ProviderSettings, "apiProvider">,
): ListModelsOptions {
	const openAiHeaders = {
		...(process.env.OPENAI_ORG_ID ? { "OpenAI-Organization": process.env.OPENAI_ORG_ID } : {}),
		...(process.env.OPENAI_PROJECT_ID ? { "OpenAI-Project": process.env.OPENAI_PROJECT_ID } : {}),
	}
	switch (provider) {
		case "anthropic":
			return {
				apiKey: settings.apiKey,
				baseUrl: joinUrl(
					settings.anthropicBaseUrl || process.env.ANTHROPIC_BASE_URL || PROVIDER_BASE_URLS.anthropic,
					"v1",
				),
				headers:
					settings.anthropicBaseUrl && settings.anthropicUseAuthToken
						? { Authorization: `Bearer ${settings.apiKey}`, "x-api-key": "" }
						: undefined,
			}
		case "openai-native":
			return {
				apiKey: settings.openAiNativeApiKey,
				baseUrl:
					settings.openAiNativeBaseUrl ||
					process.env.OPENAI_BASE_URL ||
					`${PROVIDER_BASE_URLS.openai}${API_PATHS.openaiVersion}`,
				headers: openAiHeaders,
			}
		case "openai":
			return {
				apiKey: settings.openAiApiKey,
				baseUrl: settings.openAiBaseUrl || `${PROVIDER_BASE_URLS.openai}${API_PATHS.openaiVersion}`,
				headers: { ...openAiHeaders, ...settings.openAiHeaders },
				apiVersion: settings.azureApiVersion,
				listingUnsupported:
					settings.openAiUseAzure || /\.azure\.com(?:[/:]|$)/i.test(settings.openAiBaseUrl ?? ""),
			}
		case "gemini":
			return {
				apiKey: settings.geminiApiKey,
				baseUrl: settings.googleGeminiBaseUrl ? joinUrl(settings.googleGeminiBaseUrl, "v1beta") : undefined,
			}
		case "qwen":
			return {
				apiKey: settings.qwenApiKey,
				baseUrl: settings.qwenBaseUrl || `${PROVIDER_BASE_URLS.qwen}${API_PATHS.qwenCompatible}`,
			}
		case "glm":
			return {
				apiKey: settings.glmApiKey,
				baseUrl: settings.glmBaseUrl || `${PROVIDER_BASE_URLS.glm}${API_PATHS.glmVersion}`,
			}
		case "moonshot":
			return {
				apiKey: settings.moonshotApiKey,
				baseUrl: settings.moonshotBaseUrl || `${PROVIDER_BASE_URLS.moonshot}${API_PATHS.openaiVersion}`,
			}
		case "mimo":
			return {
				apiKey: settings.mimoApiKey,
				baseUrl: settings.mimoBaseUrl || `${PROVIDER_BASE_URLS.xiaomiMimo}${API_PATHS.openaiVersion}`,
			}
		case "mimo-token-plan":
			return { apiKey: settings.mimoTokenPlanApiKey, baseUrl: "https://token-plan-cn.xiaomimimo.com/v1" }
		case "deepseek":
			return {
				apiKey: settings.deepSeekApiKey,
				baseUrl: settings.deepSeekBaseUrl || PROVIDER_BASE_URLS.deepseek,
				headers: openAiHeaders,
			}
		case "minimax":
			return {
				apiKey: settings.minimaxApiKey,
				baseUrl: joinUrl(resolveMinimaxAnthropicBaseUrl(settings.minimaxBaseUrl), "v1"),
			}
		case "mistral":
			return {
				apiKey: settings.mistralApiKey,
				baseUrl: settings.apiModelId?.startsWith("codestral-")
					? joinUrl(settings.mistralCodestralUrl || "https://codestral.mistral.ai", "v1")
					: `${PROVIDER_BASE_URLS.mistral}${API_PATHS.openaiVersion}`,
			}
		case "xai":
			return {
				apiKey: settings.xaiApiKey,
				baseUrl: `${PROVIDER_BASE_URLS.xai}${API_PATHS.openaiVersion}`,
				headers: openAiHeaders,
			}
		case "fireworks":
			return {
				apiKey: settings.fireworksApiKey,
				baseUrl: `${PROVIDER_BASE_URLS.fireworks}${API_PATHS.fireworksInference}`,
				headers: openAiHeaders,
			}
		case "sambanova":
			return {
				apiKey: settings.sambaNovaApiKey,
				baseUrl: `${PROVIDER_BASE_URLS.sambanova}${API_PATHS.openaiVersion}`,
				headers: openAiHeaders,
			}
		case "baseten":
			return {
				apiKey: settings.basetenApiKey,
				baseUrl: `${PROVIDER_BASE_URLS.baseten}${API_PATHS.openaiVersion}`,
				headers: openAiHeaders,
			}
		case "doubao":
			return {
				apiKey: settings.doubaoApiKey,
				baseUrl: settings.doubaoBaseUrl || `${PROVIDER_BASE_URLS.volcengine}${API_PATHS.volcengineVersion}`,
				headers: openAiHeaders,
			}
		default:
			return {}
	}
}
