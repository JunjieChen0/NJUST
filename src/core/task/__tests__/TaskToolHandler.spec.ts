import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../shared/logger", () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import type { Anthropic } from "@anthropic-ai/sdk"
import { logger } from "../../../shared/logger"
import { TaskToolHandler, type TaskToolHandlerContext } from "../TaskToolHandler"

function makeToolResult(id: string, content = "result"): Anthropic.ToolResultBlockParam {
	return { type: "tool_result", tool_use_id: id, content }
}

function makeContext(initial: Anthropic.Messages.ContentBlockParam[] = []): TaskToolHandlerContext {
	return { userMessageContent: initial, taskId: "task-1" }
}

describe("TaskToolHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("pushToolResultToUserContent", () => {
		it("pushes a tool result and returns true", () => {
			const ctx = makeContext()
			const handler = new TaskToolHandler(ctx)
			const result = makeToolResult("toolu_1", "hello")

			const ok = handler.pushToolResultToUserContent(result)

			expect(ok).toBe(true)
			expect(ctx.userMessageContent).toHaveLength(1)
			expect(ctx.userMessageContent[0]).toEqual(result)
		})

		it("returns false and does not push when tool_use_id already exists", () => {
			const existing = makeToolResult("toolu_dup", "first")
			const ctx = makeContext([existing])
			const handler = new TaskToolHandler(ctx)

			const duplicate = makeToolResult("toolu_dup", "second")
			const ok = handler.pushToolResultToUserContent(duplicate)

			expect(ok).toBe(false)
			expect(ctx.userMessageContent).toHaveLength(1)
			expect(ctx.userMessageContent[0]).toEqual(existing)
		})

		it("logs a warning on duplicate", () => {
			const ctx = makeContext([makeToolResult("toolu_dup")])
			const handler = new TaskToolHandler(ctx)

			handler.pushToolResultToUserContent(makeToolResult("toolu_dup"))

			expect(logger.warn).toHaveBeenCalledWith("TaskToolHandler", expect.stringContaining("toolu_dup"))
		})

		it("does not log a warning when there is no duplicate", () => {
			const ctx = makeContext()
			const handler = new TaskToolHandler(ctx)

			handler.pushToolResultToUserContent(makeToolResult("toolu_new"))

			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("allows multiple results with different tool_use_ids", () => {
			const ctx = makeContext()
			const handler = new TaskToolHandler(ctx)

			const r1 = makeToolResult("toolu_a", "a")
			const r2 = makeToolResult("toolu_b", "b")
			const r3 = makeToolResult("toolu_c", "c")

			expect(handler.pushToolResultToUserContent(r1)).toBe(true)
			expect(handler.pushToolResultToUserContent(r2)).toBe(true)
			expect(handler.pushToolResultToUserContent(r3)).toBe(true)

			expect(ctx.userMessageContent).toHaveLength(3)
			expect(ctx.userMessageContent).toEqual([r1, r2, r3])
		})

		it("ignores non-tool_result blocks when checking for duplicates", () => {
			const textBlock: Anthropic.TextBlockParam = { type: "text", text: "some text" }
			const ctx = makeContext([textBlock])
			const handler = new TaskToolHandler(ctx)

			const result = makeToolResult("toolu_1")
			const ok = handler.pushToolResultToUserContent(result)

			expect(ok).toBe(true)
			expect(ctx.userMessageContent).toHaveLength(2)
			expect(ctx.userMessageContent).toEqual([textBlock, result])
		})

		it("preserves tool_result is_error flag", () => {
			const ctx = makeContext()
			const handler = new TaskToolHandler(ctx)
			const errorResult: Anthropic.ToolResultBlockParam = {
				type: "tool_result",
				tool_use_id: "toolu_err",
				content: "error occurred",
				is_error: true,
			}

			handler.pushToolResultToUserContent(errorResult)

			expect(ctx.userMessageContent[0]).toMatchObject({
				type: "tool_result",
				tool_use_id: "toolu_err",
				is_error: true,
			})
		})
	})
})
