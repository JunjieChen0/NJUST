import { getApiKeyFromEnv, getProviderSettings } from "../provider.ts"

describe("getApiKeyFromEnv", () => {
	const originalEnv = process.env

	beforeEach(() => {
		// Reset process.env before each test.
		process.env = { ...originalEnv }
	})

	afterEach(() => {
		process.env = originalEnv
	})

	it("should return API key from environment variable for anthropic", () => {
		process.env.ANTHROPIC_API_KEY = "test-anthropic-key"
		expect(getApiKeyFromEnv("anthropic")).toBe("test-anthropic-key")
	})

	it("should return API key from environment variable for openrouter", () => {
		process.env.OPENROUTER_API_KEY = "test-openrouter-key"
		expect(getApiKeyFromEnv("openrouter")).toBe("test-openrouter-key")
	})

	it("should return API key from environment variable for openai", () => {
		process.env.OPENAI_API_KEY = "test-openai-key"
		expect(getApiKeyFromEnv("openai-native")).toBe("test-openai-key")
	})

	it("should return undefined when API key is not set", () => {
		delete process.env.ANTHROPIC_API_KEY
		expect(getApiKeyFromEnv("anthropic")).toBeUndefined()
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
