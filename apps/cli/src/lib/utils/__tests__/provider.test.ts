import { getApiKeyFromEnv, getEnvVarName, getProviderSettings, isValidProvider } from "../provider.js"

describe("getEnvVarName", () => {
	it("uses SHOUT_SNAKE convention for unknown providers", () => {
		expect(getEnvVarName("deepseek")).toBe("DEEPSEEK_API_KEY")
		expect(getEnvVarName("xai")).toBe("XAI_API_KEY")
		expect(getEnvVarName("qwen")).toBe("QWEN_API_KEY")
	})

	it("normalizes hyphens to underscores", () => {
		expect(getEnvVarName("vercel-ai-gateway")).toBe("VERCEL_AI_GATEWAY_API_KEY")
		expect(getEnvVarName("openai-codex")).toBe("OPENAI_CODEX_API_KEY")
	})

	it("applies ENV_VAR_OVERRIDES for legacy providers", () => {
		expect(getEnvVarName("gemini")).toBe("GOOGLE_API_KEY")
		expect(getEnvVarName("openai-native")).toBe("OPENAI_API_KEY")
		expect(getEnvVarName("openai")).toBe("OPENAI_API_KEY")
		expect(getEnvVarName("njust-ai")).toBe("NJUST_AI_API_KEY")
	})
})

describe("getApiKeyFromEnv", () => {
	const originalEnv = process.env

	beforeEach(() => {
		process.env = { ...originalEnv }
	})

	afterEach(() => {
		process.env = originalEnv
	})

	it("returns API key from environment variable for anthropic", () => {
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key"
		expect(getApiKeyFromEnv("anthropic")).toBe("test-anthropic-key")
	})

	it("returns API key from environment variable for openrouter", () => {
		process.env.OPENROUTER_API_KEY = "test-openrouter-key"
		expect(getApiKeyFromEnv("openrouter")).toBe("test-openrouter-key")
	})

	it("returns API key from OPENAI_API_KEY for openai-native", () => {
		process.env.OPENAI_API_KEY = "test-openai-key"
		expect(getApiKeyFromEnv("openai-native")).toBe("test-openai-key")
	})

	it("returns undefined when API key is not set", () => {
		delete process.env.ANTHROPIC_API_KEY
		expect(getApiKeyFromEnv("anthropic")).toBeUndefined()
	})

	it("resolves dynamic providers like deepseek", () => {
		process.env.DEEPSEEK_API_KEY = "ds-key"
		expect(getApiKeyFromEnv("deepseek")).toBe("ds-key")
	})

	it("resolves dynamic providers like xai", () => {
		process.env.XAI_API_KEY = "xai-key"
		expect(getApiKeyFromEnv("xai")).toBe("xai-key")
	})
})

describe("getProviderSettings", () => {
	it("sets apiKey field for anthropic (legacy override)", () => {
		const settings = getProviderSettings("anthropic", "sk-ant", "claude-3")
		expect(settings.apiProvider).toBe("anthropic")
		expect(settings.apiKey).toBe("sk-ant")
		expect(settings.apiModelId).toBe("claude-3")
	})

	it("sets rooApiKey field for njust-ai (legacy override)", () => {
		const settings = getProviderSettings("njust-ai", "sk-roo", "sonnet")
		expect(settings.apiProvider).toBe("njust-ai")
		expect(settings.rooApiKey).toBe("sk-roo")
		expect(settings.apiModelId).toBe("sonnet")
	})

	it("sets deepSeekApiKey via camelCase convention", () => {
		const settings = getProviderSettings("deepseek", "sk-ds", "deepseek-chat")
		expect(settings.apiProvider).toBe("deepseek")
		expect((settings as Record<string, unknown>).deepSeekApiKey).toBe("sk-ds")
		expect(settings.apiModelId).toBe("deepseek-chat")
	})

	it("sets openAiNativeApiKey via camelCase convention", () => {
		const settings = getProviderSettings("openai-native", "sk-oai", "gpt-4o")
		expect((settings as Record<string, unknown>).openAiNativeApiKey).toBe("sk-oai")
		expect(settings.apiModelId).toBe("gpt-4o")
	})

	it("sets xaiApiKey via camelCase convention", () => {
		const settings = getProviderSettings("xai", "sk-xai", "grok-beta")
		expect((settings as Record<string, unknown>).xaiApiKey).toBe("sk-xai")
	})

	it("uses openRouterModelId override for openrouter model field", () => {
		const settings = getProviderSettings("openrouter", "sk-or", "anthropic/claude-3")
		expect(settings.openRouterApiKey).toBe("sk-or")
		expect(settings.openRouterModelId).toBe("anthropic/claude-3")
	})

	it("uses openAiModelId override for openai model field", () => {
		const settings = getProviderSettings("openai", "sk-oai", "gpt-4o")
		expect((settings as Record<string, unknown>).openAiApiKey).toBe("sk-oai")
		expect((settings as Record<string, unknown>).openAiModelId).toBe("gpt-4o")
	})

	it("skips API key for OAuth/local providers", () => {
		const noKeyProviders = ["openai-codex", "gemini-cli", "qwen-code", "vscode-lm", "lmstudio", "fake-ai"] as const
		for (const provider of noKeyProviders) {
			const settings = getProviderSettings(provider, "ignored-key", "model-x")
			const flat = settings as Record<string, unknown>
			expect(flat.apiKey).toBeUndefined()
			expect(flat[`${provider.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())}ApiKey`]).toBeUndefined()
		}
	})

	it("still assigns apiModelId for OAuth providers", () => {
		const settings = getProviderSettings("openai-codex", "ignored", "codex-1")
		expect(settings.apiModelId).toBe("codex-1")
	})

	it("preserves undefined values when arguments are missing", () => {
		const settings = getProviderSettings("anthropic", undefined, undefined)
		expect(settings.apiProvider).toBe("anthropic")
		expect(settings.apiKey).toBeUndefined()
		expect(settings.apiModelId).toBeUndefined()
	})
})

describe("isValidProvider", () => {
	it("accepts canonical provider names", () => {
		expect(isValidProvider("anthropic")).toBe(true)
		expect(isValidProvider("deepseek")).toBe(true)
		expect(isValidProvider("openai-native")).toBe(true)
		expect(isValidProvider("openrouter")).toBe(true)
		expect(isValidProvider("njust-ai")).toBe(true)
		expect(isValidProvider("xai")).toBe(true)
		expect(isValidProvider("mistral")).toBe(true)
	})

	it("rejects unknown provider names", () => {
		expect(isValidProvider("not-a-provider")).toBe(false)
		expect(isValidProvider("openai_native")).toBe(false)
		expect(isValidProvider("")).toBe(false)
	})

	it("narrows the type to ProviderName", () => {
		const value: string = "deepseek"
		if (isValidProvider(value)) {
			// Inside this branch, value should be assignable to ProviderName.
			const settings = getProviderSettings(value, "k", "m")
			expect(settings.apiProvider).toBe("deepseek")
		}
	})
})

describe("getProviderSettings", () => {
	it("maps anthropic correctly", () => {
		const result = getProviderSettings("anthropic", "key123", "claude-3")
		expect(result.apiProvider).toBe("anthropic")
		expect(result.apiKey).toBe("key123")
		expect(result.apiModelId).toBe("claude-3")
	})

	it("maps openai-native correctly", () => {
		const result = getProviderSettings("openai-native", "key123", "gpt-4")
		expect(result.apiProvider).toBe("openai-native")
		expect(result.openAiNativeApiKey).toBe("key123")
		expect(result.apiModelId).toBe("gpt-4")
	})

	it("maps deepseek correctly", () => {
		const result = getProviderSettings("deepseek", "key123", "deepseek-chat")
		expect(result.apiProvider).toBe("deepseek")
		expect(result.deepSeekApiKey).toBe("key123")
		expect(result.apiModelId).toBe("deepseek-chat")
	})

	it("maps moonshot correctly", () => {
		const result = getProviderSettings("moonshot", "key123", "moonshot-v1")
		expect(result.apiProvider).toBe("moonshot")
		expect(result.moonshotApiKey).toBe("key123")
		expect(result.apiModelId).toBe("moonshot-v1")
	})

	it("maps mistral correctly", () => {
		const result = getProviderSettings("mistral", "key123", "mistral-large")
		expect(result.apiProvider).toBe("mistral")
		expect(result.mistralApiKey).toBe("key123")
		expect(result.apiModelId).toBe("mistral-large")
	})

	it("maps ollama correctly (no apiKey)", () => {
		const result = getProviderSettings("ollama", undefined, "llama2")
		expect(result.apiProvider).toBe("ollama")
		expect(result.ollamaModelId).toBe("llama2")
	})

	it("handles missing apiKey gracefully", () => {
		const result = getProviderSettings("anthropic", undefined, "claude-3")
		expect(result.apiKey).toBeUndefined()
		expect(result.apiModelId).toBe("claude-3")
	})

	it("handles missing model gracefully", () => {
		const result = getProviderSettings("anthropic", "key123", undefined)
		expect(result.apiKey).toBe("key123")
		expect(result.apiModelId).toBeUndefined()
	})
})
