/**
 * Default API base URLs for all supported providers.
 *
 * Centralised here so that endpoint changes only require editing one file.
 * Both provider handlers (src/api/providers/*.ts) and model-list fetchers
 * (src/api/providers/fetchers/*.ts) import from this module.
 *
 * Convention: the value is the root API URL **without** a trailing slash.
 * Provider handlers may append `/v1`, `/models`, etc. as needed.
 */

export const PROVIDER_BASE_URLS = {
	anthropic: "https://api.anthropic.com",
	baseten: "https://inference.baseten.co",
	bing: "https://api.bing.microsoft.com",
	deepseek: "https://api.deepseek.com",
	fireworks: "https://api.fireworks.ai",
	gemini: "https://generativelanguage.googleapis.com",
	glm: "https://open.bigmodel.cn",
	googleCustomSearch: "https://www.googleapis.com",
	minimax: "https://api.minimax.io",
	minimaxAnthropic: "https://api.minimax.io/anthropic",
	mistral: "https://api.mistral.ai",
	moonshot: "https://api.moonshot.ai",
	openai: "https://api.openai.com",
	openrouter: "https://openrouter.ai",
	qwen: "https://dashscope.aliyuncs.com",
	requesty: "https://api.requesty.ai",
	sambanova: "https://api.sambanova.ai",
	tavily: "https://api.tavily.com",
	unbound: "https://api.getunbound.ai",
	vercelAiGateway: "https://ai-gateway.vercel.sh",
	volcengine: "https://ark.cn-beijing.volces.com",
	xai: "https://api.x.ai",
	xiaomiMimo: "https://api.xiaomimimo.com",
	xiaomiMimoTokenPlan: "https://token-plan-cn.xiaomimimo.com",
} as const

/** Common path suffixes used by providers. */
export const API_PATHS = {
	anthropicVersion: "/v1",
	openaiVersion: "/v1",
	mistralVersion: "",
	fireworksInference: "/inference/v1",
	geminiVersion: "/v1beta",
	glmVersion: "/api/paas/v4",
	qwenCompatible: "/compatible-mode/v1",
	volcengineVersion: "/api/v3",
} as const
