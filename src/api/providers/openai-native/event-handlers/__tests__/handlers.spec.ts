// npx vitest run api/providers/openai-native/event-handlers/__tests__/handlers.spec.ts

import { describe, it, expect } from "vitest"
import type { ResponsesStreamEvent } from "../../base"
import type { EventHandlerContext } from "../types"
import { handleTextEvent } from "../text-handlers"
import { handleReasoningEvent } from "../reasoning-handlers"
import { handleToolEvent } from "../tool-handlers"
import { handleStatusEvent } from "../status-handlers"
import { handleFallback } from "../fallback-handlers"

function createMockCtx(overrides: Partial<EventHandlerContext> = {}): EventHandlerContext {
	return {
		lastServiceTier: undefined,
		lastResponseOutput: undefined,
		lastResponseId: undefined,
		pendingToolCallId: undefined,
		pendingToolCallName: undefined,
		sawTextOutputInCurrentResponse: false,
		sawTextDeltaInCurrentResponse: false,
		streamedToolCallIds: new Set(),
		normalizeUsage: () => undefined,
		...overrides,
	}
}

function createMockModel(): any {
	return { id: "gpt-5.1", info: { inputPrice: 1.25, outputPrice: 10 } }
}

async function collectChunks(stream: AsyncIterable<any>): Promise<any[]> {
	const chunks: any[] = []
	for await (const chunk of stream) {
		chunks.push(chunk)
	}
	return chunks
}

// ─── handleTextEvent ─────────────────────────────────────────────────────────

describe("handleTextEvent", () => {
	describe("response.text.delta", () => {
		it("should yield text chunk and set flags", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.text.delta", delta: "Hello" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Hello" }])
			expect(ctx.sawTextDeltaInCurrentResponse).toBe(true)
			expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
		})

		it("should skip empty delta", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.text.delta", delta: "" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})

		it("should skip undefined delta", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.text.delta" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})
	})

	describe("response.output_text.delta", () => {
		it("should yield text chunk", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.output_text.delta", delta: "World" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "World" }])
			expect(ctx.sawTextDeltaInCurrentResponse).toBe(true)
		})
	})

	describe("response.text.done", () => {
		it("should yield text from event.text when no prior text seen", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.text.done", text: "Done text" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Done text" }])
			expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
		})

		it("should skip when text already seen", async () => {
			const ctx = createMockCtx({ sawTextOutputInCurrentResponse: true })
			const event: ResponsesStreamEvent = { type: "response.text.done", text: "Done text" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})

		it("should use output_text as fallback", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.text.done", output_text: "Output text" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Output text" }])
		})

		it("should use delta as second fallback", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.text.done", delta: "Delta text" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Delta text" }])
		})
	})

	describe("response.output_text.done", () => {
		it("should yield text when not previously seen", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.output_text.done", text: "Final" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Final" }])
		})
	})

	describe("response.content_part.added", () => {
		it("should yield text from part when no delta seen", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.content_part.added",
				part: { type: "text", text: "Part text" },
			}
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Part text" }])
			expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
		})

		it("should skip when text delta already seen", async () => {
			const ctx = createMockCtx({ sawTextDeltaInCurrentResponse: true })
			const event: ResponsesStreamEvent = {
				type: "response.content_part.added",
				part: { type: "text", text: "Part text" },
			}
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})

		it("should handle part.text.value as string", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.content_part.added",
				part: { type: "text", text: { value: "Nested text" } },
			}
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Nested text" }])
		})

		it("should handle output_text part type", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.content_part.added",
				part: { type: "output_text", text: "Output part" },
			}
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Output part" }])
		})
	})

	describe("response.content_part.done", () => {
		it("should yield text from part", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.content_part.done",
				part: { type: "text", text: "Done part" },
			}
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Done part" }])
		})
	})

	describe("response.refusal.delta", () => {
		it("should yield refusal text with prefix", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.refusal.delta", delta: "Cannot help" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "[Refusal] Cannot help" }])
			expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
		})

		it("should skip empty delta", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.refusal.delta", delta: "" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})
	})

	describe("response.audio_transcript.delta", () => {
		it("should yield text from delta", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.audio_transcript.delta", delta: "Spoken" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Spoken" }])
		})

		it("should skip empty delta", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.audio_transcript.delta", delta: "" }
			const chunks = await collectChunks(handleTextEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})
	})
})

// ─── handleReasoningEvent ────────────────────────────────────────────────────

describe("handleReasoningEvent", () => {
	it("should yield reasoning chunk for response.reasoning.delta", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = { type: "response.reasoning.delta", delta: "Thinking..." }
		const chunks = await collectChunks(handleReasoningEvent(event, ctx))
		expect(chunks).toEqual([{ type: "reasoning", text: "Thinking..." }])
	})

	it("should yield reasoning for response.reasoning_text.delta", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = { type: "response.reasoning_text.delta", delta: "Reasoning text" }
		const chunks = await collectChunks(handleReasoningEvent(event, ctx))
		expect(chunks).toEqual([{ type: "reasoning", text: "Reasoning text" }])
	})

	it("should yield reasoning for response.reasoning_summary.delta", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = { type: "response.reasoning_summary.delta", delta: "Summary" }
		const chunks = await collectChunks(handleReasoningEvent(event, ctx))
		expect(chunks).toEqual([{ type: "reasoning", text: "Summary" }])
	})

	it("should yield reasoning for response.reasoning_summary_text.delta", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = { type: "response.reasoning_summary_text.delta", delta: "Summary text" }
		const chunks = await collectChunks(handleReasoningEvent(event, ctx))
		expect(chunks).toEqual([{ type: "reasoning", text: "Summary text" }])
	})

	it("should skip when delta is empty", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = { type: "response.reasoning.delta", delta: "" }
		const chunks = await collectChunks(handleReasoningEvent(event, ctx))
		expect(chunks).toHaveLength(0)
	})

	it("should skip when delta is undefined", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = { type: "response.reasoning.delta" }
		const chunks = await collectChunks(handleReasoningEvent(event, ctx))
		expect(chunks).toHaveLength(0)
	})
})

// ─── handleToolEvent ─────────────────────────────────────────────────────────

describe("handleToolEvent", () => {
	describe("response.tool_call_arguments.delta", () => {
		it("should yield tool_call_partial with call_id and name from event", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.tool_call_arguments.delta",
				call_id: "call_1",
				name: "my_tool",
				delta: '{"key":',
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toEqual([
				{ type: "tool_call_partial", index: 0, id: "call_1", name: "my_tool", arguments: '{"key":' },
			])
			expect(ctx.streamedToolCallIds.has("call_1")).toBe(true)
		})

		it("should fall back to ctx pendingToolCallId/Name", async () => {
			const ctx = createMockCtx({ pendingToolCallId: "ctx_call", pendingToolCallName: "ctx_tool" })
			const event: ResponsesStreamEvent = {
				type: "response.tool_call_arguments.delta",
				delta: "data",
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toEqual([
				{ type: "tool_call_partial", index: 0, id: "ctx_call", name: "ctx_tool", arguments: "data" },
			])
		})

		it("should use tool_call_id as fallback for call_id", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.tool_call_arguments.delta",
				tool_call_id: "tc_1",
				name: "tool",
				delta: "args",
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks[0].id).toBe("tc_1")
		})

		it("should use function_name as fallback for name", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.function_call_arguments.delta",
				call_id: "c1",
				function_name: "func_tool",
				delta: "data",
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks[0].name).toBe("func_tool")
		})

		it("should not yield when name is missing", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.tool_call_arguments.delta",
				call_id: "call_1",
				delta: "args",
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})

		it("should not yield when call_id is missing", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.tool_call_arguments.delta",
				name: "tool",
				delta: "args",
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})

		it("should use event.index when provided", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.tool_call_arguments.delta",
				call_id: "c1",
				name: "tool",
				delta: "x",
				index: 3,
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks[0].index).toBe(3)
		})
	})

	describe("response.tool_call_arguments.done", () => {
		it("should not yield anything", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.tool_call_arguments.done" }
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})
	})

	describe("response.function_call_arguments.done", () => {
		it("should not yield anything", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.function_call_arguments.done" }
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})
	})

	describe("response.output_item.added", () => {
		it("should set pending tool call for function_call items", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.added",
				item: { type: "function_call", call_id: "call_2", name: "search" },
			}
			await collectChunks(handleToolEvent(event, ctx))
			expect(ctx.pendingToolCallId).toBe("call_2")
			expect(ctx.pendingToolCallName).toBe("search")
		})

		it("should set pending tool call for tool_call items", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.added",
				item: { type: "tool_call", call_id: "tc_3", name: "compute" },
			}
			await collectChunks(handleToolEvent(event, ctx))
			expect(ctx.pendingToolCallId).toBe("tc_3")
			expect(ctx.pendingToolCallName).toBe("compute")
		})

		it("should use function.name as fallback", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.added",
				item: { type: "function_call", call_id: "c1", function: { name: "func_name" } },
			}
			await collectChunks(handleToolEvent(event, ctx))
			expect(ctx.pendingToolCallName).toBe("func_name")
		})

		it("should yield text for text items", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.added",
				item: { type: "text", text: "Direct text" },
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Direct text" }])
			expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
		})

		it("should yield text for output_text items", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.added",
				item: { type: "output_text", text: "Output text" },
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Output text" }])
			expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
		})

		it("should yield reasoning for reasoning items", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.added",
				item: { type: "reasoning", text: "My reasoning" },
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toEqual([{ type: "reasoning", text: "My reasoning" }])
		})

		it("should extract text from message items with content", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.added",
				item: {
					type: "message",
					content: [
						{ type: "text", text: "Message text 1" },
						{ type: "output_text", text: "Message text 2" },
					],
				},
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toEqual([
				{ type: "text", text: "Message text 1" },
				{ type: "text", text: "Message text 2" },
			])
			expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
		})
	})

	describe("response.output_item.done", () => {
		it("should yield tool_call for function_call items not yet streamed", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.done",
				item: {
					type: "function_call",
					call_id: "call_done",
					name: "done_tool",
					arguments: '{"x":1}',
				},
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toEqual([{ type: "tool_call", id: "call_done", name: "done_tool", arguments: '{"x":1}' }])
		})

		it("should NOT yield tool_call if already streamed via delta", async () => {
			const ctx = createMockCtx()
			ctx.streamedToolCallIds.add("call_done")
			const event: ResponsesStreamEvent = {
				type: "response.output_item.done",
				item: {
					type: "function_call",
					call_id: "call_done",
					name: "done_tool",
					arguments: '{"x":1}',
				},
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})

		it("should stringify object arguments", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.done",
				item: {
					type: "function_call",
					call_id: "c1",
					name: "tool",
					arguments: { key: "value" },
				},
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks[0].arguments).toBe('{"key":"value"}')
		})

		it("should use function.arguments as fallback", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.done",
				item: {
					type: "function_call",
					call_id: "c1",
					name: "tool",
					function: { arguments: '{"from_func":true}' },
				},
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks[0].arguments).toBe('{"from_func":true}')
		})

		it("should fallback text from output_item.done when no text seen yet", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.output_item.done",
				item: { type: "text", text: "Late text" },
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toEqual([{ type: "text", text: "Late text" }])
			expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
		})

		it("should skip text fallback when text already seen", async () => {
			const ctx = createMockCtx({ sawTextOutputInCurrentResponse: true })
			const event: ResponsesStreamEvent = {
				type: "response.output_item.done",
				item: { type: "text", text: "Skip me" },
			}
			const chunks = await collectChunks(handleToolEvent(event, ctx))
			expect(chunks).toHaveLength(0)
		})
	})
})

// ─── handleStatusEvent ───────────────────────────────────────────────────────

describe("handleStatusEvent", () => {
	describe("response.done", () => {
		it("should yield usage from normalizeUsage", async () => {
			const ctx = createMockCtx({
				normalizeUsage: () => ({ type: "usage", inputTokens: 10, outputTokens: 5, totalCost: 0.001 }),
			})
			const event: ResponsesStreamEvent = {
				type: "response.done",
				response: { usage: { prompt_tokens: 10, completion_tokens: 5 } },
			}
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			expect(chunks).toHaveLength(1)
			expect(chunks[0].type).toBe("usage")
		})

		it("should extract text from response.output when no prior text seen", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.done",
				response: {
					output: [{ type: "text", text: "Final output text" }],
				},
			}
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks).toEqual([{ type: "text", text: "Final output text" }])
			expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
		})

		it("should extract text from message content in response.output", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.done",
				response: {
					output: [
						{
							type: "message",
							content: [{ type: "output_text", text: "Message content" }],
						},
					],
				},
			}
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks).toEqual([{ type: "text", text: "Message content" }])
		})

		it("should skip text extraction when sseHasContent is true", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.done",
				response: {
					output: [{ type: "text", text: "Should skip" }],
				},
			}
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx, true))
			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks).toHaveLength(0)
		})

		it("should skip text extraction when ctx.sawTextOutputInCurrentResponse is true", async () => {
			const ctx = createMockCtx({ sawTextOutputInCurrentResponse: true })
			const event: ResponsesStreamEvent = {
				type: "response.done",
				response: {
					output: [{ type: "text", text: "Should skip" }],
				},
			}
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			const textChunks = chunks.filter((c) => c.type === "text")
			expect(textChunks).toHaveLength(0)
		})
	})

	describe("response.completed", () => {
		it("should behave like response.done", async () => {
			const ctx = createMockCtx({
				normalizeUsage: () => ({ type: "usage", inputTokens: 5, outputTokens: 3, totalCost: 0.0005 }),
			})
			const event: ResponsesStreamEvent = {
				type: "response.completed",
				response: { usage: { prompt_tokens: 5, completion_tokens: 3 } },
			}
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			expect(chunks.some((c) => c.type === "usage")).toBe(true)
		})
	})

	describe("response.created / response.in_progress", () => {
		it("should yield nothing for response.created", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.created" }
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			expect(chunks).toHaveLength(0)
		})

		it("should yield nothing for response.in_progress", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.in_progress" }
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			expect(chunks).toHaveLength(0)
		})
	})

	describe("response.error / error", () => {
		it("should throw ApiProviderError for response.error", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.error",
				error: { message: "Rate limit exceeded" },
			}
			await expect(collectChunks(handleStatusEvent(event, createMockModel(), ctx))).rejects.toThrow(
				"Rate limit exceeded",
			)
		})

		it("should throw for error type event", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "error",
				message: "Bad request",
			}
			await expect(collectChunks(handleStatusEvent(event, createMockModel(), ctx))).rejects.toThrow("Bad request")
		})

		it("should not throw when no error details available", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.error" }
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			expect(chunks).toHaveLength(0)
		})
	})

	describe("response.failed", () => {
		it("should throw ApiProviderError with failure message", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = {
				type: "response.failed",
				error: { message: "Model unavailable" },
			}
			await expect(collectChunks(handleStatusEvent(event, createMockModel(), ctx))).rejects.toThrow(
				"Model unavailable",
			)
		})

		it("should not throw when no error details", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.failed" }
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			expect(chunks).toHaveLength(0)
		})
	})

	describe("response.incomplete / response.queued", () => {
		it("should yield nothing for response.incomplete", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.incomplete" }
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			expect(chunks).toHaveLength(0)
		})

		it("should yield nothing for response.queued", async () => {
			const ctx = createMockCtx()
			const event: ResponsesStreamEvent = { type: "response.queued" }
			const chunks = await collectChunks(handleStatusEvent(event, createMockModel(), ctx))
			expect(chunks).toHaveLength(0)
		})
	})
})

// ─── handleFallback ──────────────────────────────────────────────────────────

describe("handleFallback", () => {
	it("should extract text from response.output array", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = {
			response: {
				output: [
					{
						type: "text",
						content: [{ type: "text", text: "Fallback text" }],
					},
				],
			},
		}
		const chunks = await collectChunks(handleFallback(event, createMockModel(), ctx))
		expect(chunks).toEqual([{ type: "text", text: "Fallback text" }])
	})

	it("should extract reasoning summaries from response.output", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = {
			response: {
				output: [
					{
						type: "reasoning",
						summary: [{ type: "summary_text", text: "Summary content" }],
					},
				],
			},
		}
		const chunks = await collectChunks(handleFallback(event, createMockModel(), ctx))
		expect(chunks).toEqual([{ type: "reasoning", text: "Summary content" }])
	})

	it("should yield usage from response.usage", async () => {
		const ctx = createMockCtx({
			normalizeUsage: () => ({ type: "usage", inputTokens: 5, outputTokens: 2, totalCost: 0.001 }),
		})
		const event: ResponsesStreamEvent = {
			response: {
				output: [],
				usage: { prompt_tokens: 5, completion_tokens: 2 },
			},
		}
		const chunks = await collectChunks(handleFallback(event, createMockModel(), ctx))
		expect(chunks.some((c) => c.type === "usage")).toBe(true)
	})

	it("should handle chat completions format (choices)", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = {
			choices: [{ delta: { content: "Chat completion text" } }],
		}
		const chunks = await collectChunks(handleFallback(event, createMockModel(), ctx))
		expect(chunks).toEqual([{ type: "text", text: "Chat completion text" }])
		expect(ctx.sawTextDeltaInCurrentResponse).toBe(true)
		expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
	})

	it("should handle item.text fallback", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = {
			item: { text: "Item text fallback" },
		}
		const chunks = await collectChunks(handleFallback(event, createMockModel(), ctx))
		expect(chunks).toEqual([{ type: "text", text: "Item text fallback" }])
		expect(ctx.sawTextOutputInCurrentResponse).toBe(true)
	})

	it("should handle standalone usage event", async () => {
		const ctx = createMockCtx({
			normalizeUsage: () => ({ type: "usage", inputTokens: 1, outputTokens: 1, totalCost: 0.0001 }),
		})
		const event: ResponsesStreamEvent = {
			usage: { prompt_tokens: 1, completion_tokens: 1 },
		}
		const chunks = await collectChunks(handleFallback(event, createMockModel(), ctx))
		expect(chunks).toHaveLength(1)
		expect(chunks[0].type).toBe("usage")
	})

	it("should yield nothing for empty events", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = {}
		const chunks = await collectChunks(handleFallback(event, createMockModel(), ctx))
		expect(chunks).toHaveLength(0)
	})

	it("should skip empty item.text", async () => {
		const ctx = createMockCtx()
		const event: ResponsesStreamEvent = {
			item: { text: "" },
		}
		const chunks = await collectChunks(handleFallback(event, createMockModel(), ctx))
		expect(chunks).toHaveLength(0)
	})
})
