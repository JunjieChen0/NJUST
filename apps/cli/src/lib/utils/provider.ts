import { NJUST_AISettings, isProviderName } from "@njust-ai/types"
import type { ProviderName } from "@njust-ai/types"

/**
 * Provider-agnostic configuration mapper.
 *
 * The CLI accepts any provider name that the core extension recognizes
 * (see {@link https://github.com/njust-ai/njust-ai/blob/main/packages/types/src/provider-settings.ts | providerNames}).
 * Provider-specific NJUST_AISettings key/model field names are defined once
 * here in two lookup tables. Adding a new provider only requires appending a
 * row; falling back to the convention (`apiModelId` + camelCased key) covers
 * any future simple provider automatically.
 */

// ---------------------------------------------------------------------------
// Env-var name resolution
// ---------------------------------------------------------------------------

/**
 * Providers whose API-key env var does NOT follow the
 * `${SHOUT_SNAKE(provider)}_API_KEY` convention.
 */
const ENV_VAR_OVERRIDES: Record<string, string> = {
	// Google's Gemini provider has always used the generic GOOGLE_API_KEY.
	gemini: "GOOGLE_API_KEY",
	// OpenAI Native reuses the plain OPENAI_API_KEY (no "_NATIVE_" infix).
	"openai-native": "OPENAI_API_KEY",
	// The custom "openai" provider shares the same key.
	openai: "OPENAI_API_KEY",
	// njust-ai cloud uses its own namespaced variable.
	"njust-ai": "NJUST_AI_API_KEY",
}

function toEnvVarName(provider: string): string {
	const override = ENV_VAR_OVERRIDES[provider]
	if (override) return override
	return provider.replace(/-/g, "_").toUpperCase() + "_API_KEY"
}

export function getEnvVarName(provider: ProviderName): string {
	return toEnvVarName(provider)
}

export function getApiKeyFromEnv(provider: ProviderName): string | undefined {
	return process.env[toEnvVarName(provider)]
}

// ---------------------------------------------------------------------------
// Settings field-name resolution
// ---------------------------------------------------------------------------

/**
 * Canonical NJUST_AISettings field that holds the API key for each provider.
 * Mirrors the camelCased schema fields defined in
 * `packages/types/src/provider-settings.ts`.
 *
 * Providers absent from this map either:
 *  - have no simple API key (OAuth / AWS / GCP / local), listed in
 *    {@link PROVIDERS_WITHOUT_API_KEY}, or
 *  - follow the simple `${camelCase(provider)}ApiKey` convention, handled by
 *    {@link toCamelCase}.
 */
const API_KEY_FIELDS: Record<string, string> = {
	anthropic: "apiKey", // legacy: no "anthropic" prefix
	"njust-ai": "rooApiKey", // legacy: branded
	openai: "openAiApiKey",
	"openai-native": "openAiNativeApiKey",
	openrouter: "openRouterApiKey",
	"vercel-ai-gateway": "vercelAiGatewayApiKey",
	gemini: "geminiApiKey",
	deepseek: "deepSeekApiKey",
	mistral: "mistralApiKey",
	moonshot: "moonshotApiKey",
	minimax: "minimaxApiKey",
	qwen: "qwenApiKey",
	doubao: "doubaoApiKey",
	glm: "glmApiKey",
	mimo: "mimoApiKey",
	"mimo-token-plan": "mimoTokenPlanApiKey",
	xai: "xaiApiKey",
	fireworks: "fireworksApiKey",
	sambanova: "sambaNovaApiKey",
	zai: "zaiApiKey",
	baseten: "basetenApiKey",
	requesty: "requestyApiKey",
	unbound: "unboundApiKey",
	litellm: "litellmApiKey",
	ollama: "ollamaApiKey",
}

/**
 * Providers that do NOT accept a simple API key.
 *
 * These rely on OAuth, VS Code auth, AWS credentials, GCP credentials,
 * or are local/fake providers that ignore the API key entirely.
 */
const PROVIDERS_WITHOUT_API_KEY = new Set<string>([
	"bedrock", // uses AWS access key + secret key
	"vertex", // uses GCP service-account JSON
	"vscode-lm", // backed by VS Code's built-in language models
	"openai-codex", // OAuth
	"gemini-cli", // OAuth
	"qwen-code", // OAuth
	"fake-ai", // test fixture
	"lmstudio", // local server, no auth
])

/**
 * Canonical NJUST_AISettings field that holds the model id for each provider.
 * Mirrors the schema fields in `packages/types/src/provider-settings.ts`.
 * Default is `apiModelId` when the provider is not listed here.
 */
const MODEL_ID_FIELDS: Record<string, string> = {
	openrouter: "openRouterModelId",
	"vercel-ai-gateway": "vercelAiGatewayModelId",
	openai: "openAiModelId",
	ollama: "ollamaModelId",
	lmstudio: "lmStudioModelId",
	requesty: "requestyModelId",
	unbound: "unboundModelId",
	litellm: "litellmModelId",
}

function toCamelCase(provider: string): string {
	// "xai" -> "xai", "fireworks" -> "fireworks" (no hyphens, unchanged)
	// Used only as a fallback for future providers we haven't mapped yet.
	return provider.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * Map generic CLI options into the provider-specific NJUST_AISettings shape
 * expected by the extension's ProviderRegistry.
 *
 * Unknown providers fall through to the convention and still produce a
 * usable config object; the extension will fail later if the provider id is
 * not registered.
 */
export function getProviderSettings(
	provider: ProviderName,
	apiKey: string | undefined,
	model: string | undefined,
): NJUST_AISettings {
	const config: NJUST_AISettings = { apiProvider: provider }

	if (apiKey && !PROVIDERS_WITHOUT_API_KEY.has(provider)) {
		const keyField = API_KEY_FIELDS[provider] ?? toCamelCase(provider) + "ApiKey"
		// Provider-specific key field, e.g. deepSeekApiKey / xaiApiKey.
		// NJUST_AISettings is a union; we assign dynamically to the right member.
		;(config as Record<string, unknown>)[keyField] = apiKey
	}

	if (model) {
		const modelField = MODEL_ID_FIELDS[provider]
		if (modelField) {
			;(config as Record<string, unknown>)[modelField] = model
		} else {
			config.apiModelId = model
		}
	}

	return config
}

/**
 * Validate a provider name against the canonical list exported by
 * `@njust-ai/types`. Used by the CLI to reject typos early instead of
 * letting the extension fail with a less helpful error.
 */
export function isValidProvider(provider: string): provider is ProviderName {
	return isProviderName(provider)
}
