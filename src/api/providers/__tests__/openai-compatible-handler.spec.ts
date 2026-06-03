// npx vitest run api/providers/__tests__/openai-compatible-handler.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock AI SDK dependencies
const mockStreamText = vi.fn()
const mockGenerateText = vi.fn()
const mockProviderInstance = vi.fn().mockReturnValue("mock-language-model")

vi.mock("@ai-sdk/openai-compatible", () => ({
	createOpenAICompatible: vi.fn(() => mockProviderInstance),
}))

// Mock the "ai" package with all exports that ai-sdk.ts needs
vi.mock("ai", () => ({
	streamText: (...args: unknown[]) => mockStreamText(...args),
	generateText: (...args: unknown[]) => mockGenerateText(...args),
	tool: vi.fn((config: any) => config),
	jsonSchema: vi.fn((schema: any) => schema),
}))

// Mock the ai-sdk transform utilities
vi.mock("../../transform/ai-sdk", () => ({
	convertToAiSdkMessages: vi.fn((msgs: unknown[]) =>
		msgs.map((m: any) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "converted" })),
	),
	convertToolsForAiSdk: vi.fn((tools: unknown) => tools),
	processAiSdkStreamPart: function* (part: any) {
		if (part.type === "text-delta") {
			yield { type: "text", text: part.textDelta }
		} else if (part.type === "reasoning") {
			yield { type: "reasoning", text: part.textDelta }
		}
	},
}))

import type { ModelInfo } from "@njust-ai/types"
import type { ApiHandlerOptions } from "../../../shared/api"
import { OpenAICompatibleHandler, type OpenAICompatibleConfig } from "../openai-compatible"

/** Concrete test subclass of the abstract handler */
class TestCompatibleHandler extends OpenAICompatibleHandler {
	override getModel() {
		return {
			id: this.config.modelId,
			info: this.config.modelInfo,
			maxTokens: this.config.modelMaxTokens,
			temperature: this.config.temperature,
		}
	}

	// Expose protected methods for testing
	public testMapToolChoice(toolChoice: any) {
		return this.mapToolChoice(toolChoice)
	}
	public testProcessUsageMetrics(usage: any) {
		return this.processUsageMetrics(usage)
	}
	public testGetMaxOutputTokens() {
		return this.getMaxOutputTokens()
	}
	public testShouldUseStrictMode() {
		return this.shouldUseStrictMode()
	}
}

const baseModelInfo: ModelInfo = {
	maxTokens: 4096,
	contextWindow: 128000,
	supportsImages: false,
	supportsPromptCache: false,
	inputPrice: 1.0,
	outputPrice: 3.0,
}

function makeConfig(overrides: Partial<OpenAICompatibleConfig> = {}): OpenAICompatibleConfig {
	return {
		providerName: "TestProvider",
		baseURL: "https://test.example.com/v1",
		apiKey: "test-api-key",
		modelId: "test-model",
		modelInfo: baseModelInfo,
		...overrides,
	}
}

function makeOptions(overrides: Partial<ApiHandlerOptions> = {}): ApiHandlerOptions {
	return {
		openAiNativeApiKey: "test-key",
		...overrides,
	}
}

describe("OpenAICompatibleHandler", () => {
	let handler: TestCompatibleHandler

	beforeEach(() => {
		vi.clearAllMocks()
		handler = new TestCompatibleHandler(makeOptions(), makeConfig())
	})

	describe("constructor", () => {
		it("should create a handler with the given config", () => {
			expect(handler).toBeInstanceOf(TestCompatibleHandler)
		})

		it("should create the OpenAI-compatible provider", async () => {
			const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible")
			expect(createOpenAICompatible).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "TestProvider",
					baseURL: "https://test.example.com/v1",
					apiKey: "test-api-key",
				}),
			)
		})

		it("should include default headers", async () => {
			const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible")
			const callArgs = (createOpenAICompatible as any).mock.calls[0][0]
			expect(callArgs.headers).toHaveProperty("X-Title")
			expect(callArgs.headers).toHaveProperty("User-Agent")
		})

		it("should merge custom headers with defaults", () => {
			const customHandler = new TestCompatibleHandler(
				makeOptions(),
				makeConfig({ headers: { "X-Custom": "value" } }),
			)
			expect(customHandler).toBeDefined()
		})
	})

	describe("shouldUseStrictMode", () => {
		it("should return false", () => {
			expect(handler.testShouldUseStrictMode()).toBe(false)
		})
	})

	describe("mapToolChoice", () => {
		it("should return undefined for undefined input", () => {
			expect(handler.testMapToolChoice(undefined)).toBeUndefined()
		})

		it("should return 'auto' for string 'auto'", () => {
			expect(handler.testMapToolChoice("auto")).toBe("auto")
		})

		it("should return 'none' for string 'none'", () => {
			expect(handler.testMapToolChoice("none")).toBe("none")
		})

		it("should return 'required' for string 'required'", () => {
			expect(handler.testMapToolChoice("required")).toBe("required")
		})

		it("should return 'auto' for unknown string values", () => {
			expect(handler.testMapToolChoice("unknown_value")).toBe("auto")
		})

		it("should handle named function tool choice object", () => {
			const toolChoice = {
				type: "function",
				function: { name: "my_function" },
			}
			expect(handler.testMapToolChoice(toolChoice)).toEqual({
				type: "tool",
				toolName: "my_function",
			})
		})

		it("should return undefined for object without function name", () => {
			const toolChoice = {
				type: "function",
				function: { name: "" },
			}
			expect(handler.testMapToolChoice(toolChoice)).toBeUndefined()
		})

		it("should return undefined for object without type", () => {
			expect(handler.testMapToolChoice({})).toBeUndefined()
		})
	})

	describe("processUsageMetrics", () => {
		it("should map basic usage to ApiStreamUsageChunk", () => {
			const result = handler.testProcessUsageMetrics({
				inputTokens: 100,
				outputTokens: 50,
			})
			expect(result).toEqual({
				type: "usage",
				inputTokens: 100,
				outputTokens: 50,
				cacheReadTokens: undefined,
				reasoningTokens: undefined,
			})
		})

		it("should default to 0 when tokens are missing", () => {
			const result = handler.testProcessUsageMetrics({})
			expect(result.inputTokens).toBe(0)
			expect(result.outputTokens).toBe(0)
		})

		it("should pass through cached input tokens", () => {
			const result = handler.testProcessUsageMetrics({
				inputTokens: 100,
				outputTokens: 50,
				details: { cachedInputTokens: 30 },
			})
			expect(result.cacheReadTokens).toBe(30)
		})

		it("should pass through reasoning tokens", () => {
			const result = handler.testProcessUsageMetrics({
				inputTokens: 100,
				outputTokens: 50,
				details: { reasoningTokens: 15 },
			})
			expect(result.reasoningTokens).toBe(15)
		})
	})

	describe("getMaxOutputTokens", () => {
		it("should use modelMaxTokens when set", () => {
			const h = new TestCompatibleHandler(makeOptions(), makeConfig({ modelMaxTokens: 8192 }))
			expect(h.testGetMaxOutputTokens()).toBe(8192)
		})

		it("should fall back to modelInfo.maxTokens", () => {
			expect(handler.testGetMaxOutputTokens()).toBe(4096)
		})

		it("should return undefined when neither is set", () => {
			const h = new TestCompatibleHandler(
				makeOptions(),
				makeConfig({ modelInfo: { ...baseModelInfo, maxTokens: undefined } }),
			)
			expect(h.testGetMaxOutputTokens()).toBeUndefined()
		})
	})

	describe("createMessage", () => {
		it("should stream text parts through AI SDK", async () => {
			// Create a mock fullStream async iterable
			const mockParts = [
				{ type: "text-delta", textDelta: "Hello " },
				{ type: "text-delta", textDelta: "world" },
			]

			const mockResult = {
				fullStream: (async function* () {
					for (const part of mockParts) {
						yield part
					}
				})(),
				usage: Promise.resolve({ inputTokens: 10, outputTokens: 5 }),
			}
			mockStreamText.mockReturnValue(mockResult)

			const messages = [{ role: "user" as const, content: "Hi" }]
			const chunks: any[] = []
			for await (const chunk of handler.createMessage("System prompt", messages)) {
				chunks.push(chunk)
			}

			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks).toHaveLength(2)
			expect(textChunks[0].text).toBe("Hello ")
			expect(textChunks[1].text).toBe("world")
		})

		it("should yield usage at the end of the stream", async () => {
			mockStreamText.mockReturnValue({
				fullStream: (async function* () {
					yield { type: "text-delta", textDelta: "ok" }
				})(),
				usage: Promise.resolve({ inputTokens: 20, outputTokens: 10 }),
			})

			const chunks: any[] = []
			for await (const chunk of handler.createMessage("sys", [{ role: "user", content: "hi" }])) {
				chunks.push(chunk)
			}

			const usageChunks = chunks.filter((c) => c.type === "usage")
			expect(usageChunks).toHaveLength(1)
			expect(usageChunks[0].inputTokens).toBe(20)
			expect(usageChunks[0].outputTokens).toBe(10)
		})

		it("should pass tools and tool choice to streamText", async () => {
			// Must yield at least one text chunk to satisfy guardEmptyStream
			mockStreamText.mockReturnValue({
				fullStream: (async function* () {
					yield { type: "text-delta", textDelta: "ok" }
				})(),
				usage: Promise.resolve(undefined),
			})

			const metadata = {
				tools: [{ type: "function" as const, function: { name: "test_tool", description: "A test tool" } }],
				tool_choice: "auto" as const,
			}

			for await (const _ of handler.createMessage("sys", [{ role: "user", content: "hi" }], metadata)) {
				// consume
			}

			expect(mockStreamText).toHaveBeenCalledWith(
				expect.objectContaining({
					toolChoice: "auto",
				}),
			)
		})
	})

	describe("completePrompt", () => {
		it("should call generateText and return text", async () => {
			mockGenerateText.mockResolvedValue({ text: "Generated response" })

			const result = await handler.completePrompt("Test prompt")

			expect(result).toBe("Generated response")
			expect(mockGenerateText).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "Test prompt",
					temperature: 0,
				}),
			)
		})

		it("should use config temperature", async () => {
			const h = new TestCompatibleHandler(makeOptions(), makeConfig({ temperature: 0.7 }))
			mockGenerateText.mockResolvedValue({ text: "ok" })

			await h.completePrompt("prompt")

			expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.7 }))
		})

		it("should include maxOutputTokens when configured", async () => {
			const h = new TestCompatibleHandler(makeOptions(), makeConfig({ modelMaxTokens: 2048 }))
			mockGenerateText.mockResolvedValue({ text: "ok" })

			await h.completePrompt("prompt")

			expect(mockGenerateText).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 2048 }))
		})
	})

	describe("getLanguageModel", () => {
		it("should call provider with the configured model ID", () => {
			// Access the protected method through cast
			const model = (handler as any).getLanguageModel()
			expect(mockProviderInstance).toHaveBeenCalledWith("test-model")
			expect(model).toBe("mock-language-model")
		})
	})
})
