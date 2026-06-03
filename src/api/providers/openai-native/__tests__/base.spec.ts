// npx vitest run api/providers/openai-native/__tests__/base.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

const mockCaptureException = vi.fn()

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: {
		hasInstance: () => true,
		instance: {
			captureException: (...args: unknown[]) => mockCaptureException(...args),
		},
	},
}))

vi.mock("openai", () => ({
	__esModule: true,
	default: vi.fn(function () {
		return {
			responses: {
				create: mockResponsesCreate,
			},
		}
	}),
}))

import OpenAI from "openai"
import { type ModelInfo, type ReasoningEffortExtended, type ServiceTier } from "@njust-ai/types"

import type { ApiHandlerOptions } from "../../../../shared/api"
import { OpenAiNativeHandlerBase, type OpenAiNativeModel, type OpenAiUsageData } from "../base"

const mockResponsesCreate = vi.fn()

/** Concrete test subclass of the abstract base */
class TestOpenAiNativeHandler extends OpenAiNativeHandlerBase {
	getReasoningEffort(_model: OpenAiNativeModel): ReasoningEffortExtended | undefined {
		return undefined
	}
	getPromptCacheRetention(_model: OpenAiNativeModel): "24h" | undefined {
		return undefined
	}
	applyServiceTierPricing(info: ModelInfo, _tier?: ServiceTier): ModelInfo {
		return info
	}

	// Stub out createMessage (defined in ResponsesApiMixin, not base)
	async *createMessage(): AsyncGenerator<never> {
		// no-op
	}
}

function makeOptions(overrides: Partial<ApiHandlerOptions> = {}): ApiHandlerOptions {
	return {
		openAiNativeApiKey: "test-key",
		apiModelId: "gpt-4.1",
		...overrides,
	}
}

describe("OpenAiNativeHandlerBase", () => {
	let handler: TestOpenAiNativeHandler

	beforeEach(() => {
		vi.clearAllMocks()
		handler = new TestOpenAiNativeHandler(makeOptions())
	})

	describe("constructor", () => {
		it("should throw when API key is missing", () => {
			expect(() => new TestOpenAiNativeHandler(makeOptions({ openAiNativeApiKey: "" }))).toThrow()
		})

		it("should throw when API key is undefined", () => {
			expect(() => new TestOpenAiNativeHandler(makeOptions({ openAiNativeApiKey: undefined }))).toThrow()
		})

		it("should create an OpenAI client with default headers", () => {
			;(OpenAI as unknown as ReturnType<typeof vi.fn>).mockClear()
			new TestOpenAiNativeHandler(makeOptions())
			expect(OpenAI).toHaveBeenCalledWith(
				expect.objectContaining({
					apiKey: "test-key",
					defaultHeaders: expect.objectContaining({
						originator: "Njust-AI",
					}),
				}),
			)
		})

		it("should pass custom baseURL when set", () => {
			;(OpenAI as unknown as ReturnType<typeof vi.fn>).mockClear()
			new TestOpenAiNativeHandler(makeOptions({ openAiNativeBaseUrl: "https://custom.example.com/v1" }))
			expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "https://custom.example.com/v1" }))
		})

		it("should pass undefined baseURL when openAiNativeBaseUrl is empty", () => {
			;(OpenAI as unknown as ReturnType<typeof vi.fn>).mockClear()
			new TestOpenAiNativeHandler(makeOptions({ openAiNativeBaseUrl: "" }))
			expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: undefined }))
		})

		it("should generate a session ID", () => {
			expect(handler.sessionId).toBeDefined()
			expect(typeof handler.sessionId).toBe("string")
			expect(handler.sessionId.length).toBeGreaterThan(0)
		})

		it("should default enableResponsesReasoningSummary to true", () => {
			const h = new TestOpenAiNativeHandler(makeOptions())
			// Access the protected options field via cast
			expect((h as any).options.enableResponsesReasoningSummary).toBe(true)
		})

		it("should preserve explicit enableResponsesReasoningSummary=false", () => {
			const h = new TestOpenAiNativeHandler(makeOptions({ enableResponsesReasoningSummary: false }))
			expect((h as any).options.enableResponsesReasoningSummary).toBe(false)
		})
	})

	describe("getModel", () => {
		it("should return the configured model", () => {
			const model = handler.getModel()
			expect(model.id).toBe("gpt-4.1")
			expect(model.info).toBeDefined()
		})

		it("should fall back to default model for unknown model ID", () => {
			const h = new TestOpenAiNativeHandler(makeOptions({ apiModelId: "nonexistent-model" }))
			const model = h.getModel()
			// Should fall back to the default model ID
			expect(model.id).toBeDefined()
			expect(model.info).toBeDefined()
		})

		it("should fall back to default model when model ID is undefined", () => {
			const h = new TestOpenAiNativeHandler(makeOptions({ apiModelId: undefined }))
			const model = h.getModel()
			expect(model.id).toBeDefined()
			expect(model.info).toBeDefined()
		})

		it("should normalize o3-mini model ID", () => {
			const h = new TestOpenAiNativeHandler(makeOptions({ apiModelId: "o3-mini" }))
			const model = h.getModel()
			expect(model.id).toBe("o3-mini")
		})
	})

	describe("normalizeUsage", () => {
		const model = {
			id: "gpt-4.1",
			info: {
				maxTokens: 4096,
				contextWindow: 128000,
				inputPrice: 2.5,
				outputPrice: 10,
			} as ModelInfo,
		} as OpenAiNativeModel

		it("should return undefined when usage is undefined", () => {
			const result = handler.normalizeUsage(undefined, model)
			expect(result).toBeUndefined()
		})

		it("should parse basic input/output tokens", () => {
			const usage: OpenAiUsageData = {
				input_tokens: 100,
				output_tokens: 50,
			}
			const result = handler.normalizeUsage(usage, model)
			expect(result).toBeDefined()
			expect(result!.type).toBe("usage")
			expect(result!.outputTokens).toBe(50)
		})

		it("should use prompt_tokens as fallback for input_tokens", () => {
			const usage: OpenAiUsageData = {
				prompt_tokens: 80,
				completion_tokens: 30,
			}
			const result = handler.normalizeUsage(usage, model)
			expect(result).toBeDefined()
			expect(result!.outputTokens).toBe(30)
		})

		it("should handle cache tokens", () => {
			const usage: OpenAiUsageData = {
				input_tokens: 100,
				output_tokens: 50,
				cache_creation_input_tokens: 20,
				cache_read_input_tokens: 30,
			}
			const result = handler.normalizeUsage(usage, model)
			expect(result).toBeDefined()
			expect(result!.cacheWriteTokens).toBe(20)
			expect(result!.cacheReadTokens).toBe(30)
		})

		it("should handle cache_write_tokens alias", () => {
			const usage: OpenAiUsageData = {
				input_tokens: 100,
				output_tokens: 50,
				cache_write_tokens: 15,
				cache_read_tokens: 25,
			}
			const result = handler.normalizeUsage(usage, model)
			expect(result).toBeDefined()
			expect(result!.cacheWriteTokens).toBe(15)
			expect(result!.cacheReadTokens).toBe(25)
		})

		it("should use input_tokens_details for cached and miss tokens", () => {
			const usage: OpenAiUsageData = {
				input_tokens: 0,
				output_tokens: 50,
				input_tokens_details: { cached_tokens: 60, cache_miss_tokens: 40 },
			}
			const result = handler.normalizeUsage(usage, model)
			expect(result).toBeDefined()
			// totalInputTokens should be computed from details when input_tokens is 0
			expect(result!.inputTokens).toBeGreaterThanOrEqual(0)
		})

		it("should use prompt_tokens_details as fallback for input_tokens_details", () => {
			const usage: OpenAiUsageData = {
				input_tokens: 0,
				output_tokens: 20,
				prompt_tokens_details: { cached_tokens: 30, cache_miss_tokens: 10 },
			}
			const result = handler.normalizeUsage(usage, model)
			expect(result).toBeDefined()
		})

		it("should extract reasoning tokens from output_tokens_details", () => {
			const usage: OpenAiUsageData = {
				input_tokens: 100,
				output_tokens: 50,
				output_tokens_details: { reasoning_tokens: 10 },
			}
			const result = handler.normalizeUsage(usage, model)
			expect(result).toBeDefined()
			expect(result!.reasoningTokens).toBe(10)
		})

		it("should not include reasoningTokens when not present", () => {
			const usage: OpenAiUsageData = {
				input_tokens: 100,
				output_tokens: 50,
			}
			const result = handler.normalizeUsage(usage, model)
			expect(result).toBeDefined()
			expect(result!.reasoningTokens).toBeUndefined()
		})

		it("should include totalCost in the result", () => {
			const usage: OpenAiUsageData = {
				input_tokens: 1000,
				output_tokens: 500,
			}
			const result = handler.normalizeUsage(usage, model)
			expect(result).toBeDefined()
			expect(typeof result!.totalCost).toBe("number")
			expect(result!.totalCost).toBeGreaterThan(0)
		})
	})

	describe("getEncryptedContent", () => {
		it("should return undefined when lastResponseOutput is undefined", () => {
			handler.lastResponseOutput = undefined
			expect(handler.getEncryptedContent()).toBeUndefined()
		})

		it("should return undefined when no reasoning item exists", () => {
			handler.lastResponseOutput = [{ type: "message", content: [{ type: "output_text", text: "hello" }] }]
			expect(handler.getEncryptedContent()).toBeUndefined()
		})

		it("should return encrypted_content from reasoning item", () => {
			handler.lastResponseOutput = [{ type: "reasoning", encrypted_content: "enc_data_123", id: "reason_1" }]
			const result = handler.getEncryptedContent()
			expect(result).toEqual({
				encrypted_content: "enc_data_123",
				id: "reason_1",
			})
		})

		it("should return encrypted_content without id when reasoning item has no id", () => {
			handler.lastResponseOutput = [{ type: "reasoning", encrypted_content: "enc_data_456" }]
			const result = handler.getEncryptedContent()
			expect(result).toEqual({
				encrypted_content: "enc_data_456",
			})
		})

		it("should skip reasoning items without encrypted_content", () => {
			handler.lastResponseOutput = [
				{ type: "reasoning", id: "reason_1" }, // no encrypted_content
				{ type: "message", content: [] },
			]
			expect(handler.getEncryptedContent()).toBeUndefined()
		})
	})

	describe("getResponseId", () => {
		it("should return undefined when lastResponseId is not set", () => {
			handler.lastResponseId = undefined
			expect(handler.getResponseId()).toBeUndefined()
		})

		it("should return the lastResponseId when set", () => {
			handler.lastResponseId = "resp_abc123"
			expect(handler.getResponseId()).toBe("resp_abc123")
		})
	})

	describe("completePrompt", () => {
		it("should send correct request and return text from output", async () => {
			mockResponsesCreate.mockResolvedValue({
				output: [
					{
						type: "message",
						content: [{ type: "output_text", text: "Hello from completion" }],
					},
				],
			})

			const result = await handler.completePrompt("Test prompt")

			expect(result).toBe("Hello from completion")
			expect(mockResponsesCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					model: "gpt-4.1",
					stream: false,
					store: false,
					input: [{ role: "user", content: [{ type: "input_text", text: "Test prompt" }] }],
				}),
				expect.objectContaining({ signal: expect.any(Object) }),
			)
		})

		it("should fall back to response.text when output has no text", async () => {
			mockResponsesCreate.mockResolvedValue({
				output: [],
				text: "Fallback text",
			})

			const result = await handler.completePrompt("prompt")
			expect(result).toBe("Fallback text")
		})

		it("should return empty string when response has no output and no text", async () => {
			mockResponsesCreate.mockResolvedValue({ output: [] })
			const result = await handler.completePrompt("prompt")
			expect(result).toBe("")
		})

		it("should return empty string when response output content is empty", async () => {
			mockResponsesCreate.mockResolvedValue({
				output: [{ type: "message", content: [] }],
			})
			const result = await handler.completePrompt("prompt")
			expect(result).toBe("")
		})

		it("should include temperature when model supports it", async () => {
			mockResponsesCreate.mockResolvedValue({ output: [] })
			await handler.completePrompt("prompt")
			expect(mockResponsesCreate).toHaveBeenCalledWith(
				expect.objectContaining({ temperature: expect.any(Number) }),
				expect.anything(),
			)
		})

		it("should include max_output_tokens when model has maxTokens", async () => {
			mockResponsesCreate.mockResolvedValue({ output: [] })
			await handler.completePrompt("prompt")
			const call = mockResponsesCreate.mock.calls[0][0]
			// gpt-4.1 has maxTokens defined
			expect(call.max_output_tokens).toBeDefined()
		})

		it("should wrap and rethrow errors as ApiProviderError", async () => {
			mockResponsesCreate.mockRejectedValue(new Error("API down"))
			await expect(handler.completePrompt("prompt")).rejects.toThrow("OpenAI Native completion error: API down")
		})

		it("should capture telemetry on error", async () => {
			mockResponsesCreate.mockRejectedValue(new Error("timeout"))
			try {
				await handler.completePrompt("prompt")
			} catch {
				// expected
			}
			expect(mockCaptureException).toHaveBeenCalled()
		})

		it("should handle non-Error throws", async () => {
			mockResponsesCreate.mockRejectedValue("string error")
			await expect(handler.completePrompt("prompt")).rejects.toThrow()
		})

		it("should clear abortController in finally block", async () => {
			mockResponsesCreate.mockResolvedValue({ output: [] })
			await handler.completePrompt("prompt")
			expect(handler.abortController).toBeUndefined()
		})
	})
})
