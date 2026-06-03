// npx vitest run api/providers/__tests__/register-all.spec.ts

import { describe, it, expect, vi } from "vitest"

// Mock every provider module so we don't load real dependencies.
// Each mock exports a constructor function that returns a mock handler.

const mockHandler = { getModel: vi.fn(), createMessage: vi.fn() }

function mockProviderModule(className: string) {
	// Use a regular function (not arrow) so it can be called with `new`
	const MockClass = vi.fn(function (this: any) {
		return mockHandler
	} as any)
	return {
		[className]: MockClass,
	}
}

vi.mock("../anthropic", () => mockProviderModule("AnthropicHandler"))
vi.mock("../bedrock", () => mockProviderModule("AwsBedrockHandler"))
vi.mock("../openrouter", () => mockProviderModule("OpenRouterHandler"))
vi.mock("../vertex", () => mockProviderModule("VertexHandler"))
vi.mock("../anthropic-vertex", () => mockProviderModule("AnthropicVertexHandler"))
vi.mock("../openai", () => mockProviderModule("OpenAiHandler"))
vi.mock("../openai-codex", () => mockProviderModule("OpenAiCodexHandler"))
vi.mock("../lm-studio", () => mockProviderModule("LmStudioHandler"))
vi.mock("../gemini", () => mockProviderModule("GeminiHandler"))
vi.mock("../openai-native", () => mockProviderModule("OpenAiNativeHandler"))
vi.mock("../deepseek", () => mockProviderModule("DeepSeekHandler"))
vi.mock("../moonshot", () => mockProviderModule("MoonshotHandler"))
vi.mock("../mistral", () => mockProviderModule("MistralHandler"))
vi.mock("../vscode-lm", () => mockProviderModule("VsCodeLmHandler"))
vi.mock("../requesty", () => mockProviderModule("RequestyHandler"))
vi.mock("../unbound", () => mockProviderModule("UnboundHandler"))
vi.mock("../fake-ai", () => mockProviderModule("FakeAIHandler"))
vi.mock("../xai", () => mockProviderModule("XAIHandler"))
vi.mock("../lite-llm", () => mockProviderModule("LiteLLMHandler"))
vi.mock("../qwen-code", () => mockProviderModule("QwenCodeHandler"))
vi.mock("../sambanova", () => mockProviderModule("SambaNovaHandler"))
vi.mock("../zai", () => mockProviderModule("ZAiHandler"))
vi.mock("../fireworks", () => mockProviderModule("FireworksHandler"))
vi.mock("../njust-ai", () => mockProviderModule("RooHandler"))
vi.mock("../vercel-ai-gateway", () => mockProviderModule("VercelAiGatewayHandler"))
vi.mock("../minimax", () => mockProviderModule("MiniMaxHandler"))
vi.mock("../baseten", () => mockProviderModule("BasetenHandler"))
vi.mock("../qwen", () => mockProviderModule("QwenHandler"))
vi.mock("../doubao", () => mockProviderModule("DoubaoHandler"))
vi.mock("../glm", () => mockProviderModule("GlmHandler"))
vi.mock("../native-ollama", () => mockProviderModule("NativeOllamaHandler"))
vi.mock("../mimo", () => mockProviderModule("MimoHandler"))
vi.mock("../mimo-token-plan", () => mockProviderModule("MimoTokenPlanHandler"))

// Mock the retry wrapper to pass through
vi.mock("../../retry/ApiRetryWrapper", () => ({
	wrapApiHandler: (handler: any) => handler,
}))

// Import register-all to trigger all provider registrations.
// Because all provider modules above are mocked, this won't load real dependencies.
import "../register-all"

// Import the singleton providerRegistry that register-all populated.
import { providerRegistry } from "../../registry/ProviderRegistry"

describe("register-all", () => {
	const EXPECTED_PROVIDER_IDS = [
		"anthropic",
		"openrouter",
		"bedrock",
		"openai",
		"ollama",
		"lmstudio",
		"gemini",
		"openai-codex",
		"openai-native",
		"deepseek",
		"qwen-code",
		"moonshot",
		"vscode-lm",
		"mistral",
		"requesty",
		"unbound",
		"fake-ai",
		"xai",
		"litellm",
		"sambanova",
		"zai",
		"fireworks",
		"njust-ai",
		"vercel-ai-gateway",
		"minimax",
		"baseten",
		"qwen",
		"doubao",
		"glm",
		"mimo",
		"mimo-token-plan",
		"vertex",
	]

	it("should register all expected providers", () => {
		const registeredIds = providerRegistry.getRegisteredIds()
		for (const id of EXPECTED_PROVIDER_IDS) {
			expect(registeredIds).toContain(id)
		}
	})

	it("should have exactly the expected number of providers", () => {
		expect(providerRegistry.size()).toBe(EXPECTED_PROVIDER_IDS.length)
	})

	it("should register each provider as a factory function", () => {
		for (const id of EXPECTED_PROVIDER_IDS) {
			const reg = providerRegistry.get(id as any)
			expect(reg).toBeDefined()
			expect(typeof reg!.factory).toBe("function")
		}
	})

	describe("token counting strategies", () => {
		const nativeProviders = ["anthropic", "bedrock", "vertex"]
		const estimatedProviders = ["ollama", "lmstudio", "fake-ai"]
		const tiktokenProviders = EXPECTED_PROVIDER_IDS.filter(
			(id) => !nativeProviders.includes(id) && !estimatedProviders.includes(id),
		)

		it("should use 'native' strategy for anthropic, bedrock, vertex", () => {
			for (const id of nativeProviders) {
				expect(providerRegistry.getTokenCountingStrategy(id as any)).toBe("native")
			}
		})

		it("should use 'estimated' strategy for ollama, lmstudio, fake-ai", () => {
			for (const id of estimatedProviders) {
				expect(providerRegistry.getTokenCountingStrategy(id as any)).toBe("estimated")
			}
		})

		it("should use 'tiktoken' (default) strategy for remaining providers", () => {
			for (const id of tiktokenProviders) {
				expect(providerRegistry.getTokenCountingStrategy(id as any)).toBe("tiktoken")
			}
		})
	})

	describe("factory functions", () => {
		it("should create handler instances when calling factories", () => {
			for (const id of EXPECTED_PROVIDER_IDS) {
				if (id === "vertex") continue // vertex has special conditional logic
				const reg = providerRegistry.get(id as any)
				const handler = reg!.factory({ openAiNativeApiKey: "test" } as any)
				expect(handler).toBeDefined()
			}
		})
	})

	describe("vertex special handling", () => {
		it("should register vertex provider", () => {
			expect(providerRegistry.has("vertex" as any)).toBe(true)
		})

		it("vertex factory should return a handler for non-claude model", () => {
			const reg = providerRegistry.get("vertex" as any)
			const handler = reg!.factory({ apiModelId: "gemini-2.0-flash" } as any)
			expect(handler).toBeDefined()
		})

		it("vertex factory should return a handler for claude model", () => {
			const reg = providerRegistry.get("vertex" as any)
			const handler = reg!.factory({ apiModelId: "claude-3-5-sonnet" } as any)
			expect(handler).toBeDefined()
		})
	})

	describe("no duplicate registrations", () => {
		it("should have stable registration count across accesses", () => {
			const sizeFirst = providerRegistry.size()
			const sizeSecond = providerRegistry.size()
			expect(sizeFirst).toBe(sizeSecond)
			expect(sizeFirst).toBe(EXPECTED_PROVIDER_IDS.length)
		})
	})
})
