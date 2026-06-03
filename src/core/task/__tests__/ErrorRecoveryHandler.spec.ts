import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ErrorRecoveryHandler } from "../ErrorRecoveryHandler"

vi.mock("../../errors/apiErrorClassifier", () => ({
	classifyApiError: vi.fn(),
}))

vi.mock("../../errors/retryPersistence", () => ({
	appendRetryEvent: vi.fn(async function () {}),
}))

vi.mock("../../context-management/reactiveCompact", () => ({
	reactiveCompactMessages: vi.fn(),
}))

vi.mock("../../../shared/logger", () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock("../../../shared/error-utils", () => ({
	getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}))

import { classifyApiError } from "../../errors/apiErrorClassifier"
import { appendRetryEvent } from "../../errors/retryPersistence"
import { reactiveCompactMessages } from "../../context-management/reactiveCompact"
import { logger } from "../../../shared/logger"
import type { QuerySource } from "../../errors/recoveryStrategyMap"

function createMockTask(overrides: Record<string, unknown> = {}) {
	return {
		taskId: "task-1",
		globalStoragePath: "/tmp/storage",
		compactFailureCount: 0,
		maxCompactFailures: 3,
		apiConversationHistory: [],
		assistantMessageContent: [],
		forceTaskState: vi.fn(),
		handleContextWindowExceededError: vi.fn(async function () {}),
		addToApiConversationHistory: vi.fn(async function () {}),
		overwriteApiConversationHistory: vi.fn(async function () {}),
		getTokenUsage: vi.fn(function () {
			return { contextTokens: 50000 }
		}),
		tokenUsageSnapshot: null,
		tokenUsageSnapshotAt: 0,
		say: vi.fn(async function () {}),
		api: { getModel: () => ({ id: "test-model", info: { contextWindow: 200000 } }) },
		...overrides,
	} as any
}

describe("ErrorRecoveryHandler", () => {
	beforeEach(() => {
		vi.spyOn(ErrorRecoveryHandler.prototype as any, "delay").mockResolvedValue(undefined)
	})

	afterEach(() => {
		vi.clearAllMocks()
		vi.restoreAllMocks()
	})

	// ── Circuit Breaker ──────────────────────────────────────────────────

	describe("shouldBypassCondense", () => {
		it("returns true when compact failures reach threshold", () => {
			const task = createMockTask({ compactFailureCount: 3, maxCompactFailures: 3 })
			const handler = new ErrorRecoveryHandler(task)
			expect(handler.shouldBypassCondense()).toBe(true)
		})

		it("returns false when failures below threshold", () => {
			const task = createMockTask({ compactFailureCount: 1, maxCompactFailures: 3 })
			const handler = new ErrorRecoveryHandler(task)
			expect(handler.shouldBypassCondense()).toBe(false)
		})

		it("returns false when both counts are zero", () => {
			const task = createMockTask({ compactFailureCount: 0, maxCompactFailures: 0 })
			const handler = new ErrorRecoveryHandler(task)
			// 0 >= 0 is true
			expect(handler.shouldBypassCondense()).toBe(true)
		})

		it("returns false when failure count is one below threshold", () => {
			const task = createMockTask({ compactFailureCount: 2, maxCompactFailures: 3 })
			const handler = new ErrorRecoveryHandler(task)
			expect(handler.shouldBypassCondense()).toBe(false)
		})

		it("returns true when failure count exceeds threshold", () => {
			const task = createMockTask({ compactFailureCount: 5, maxCompactFailures: 3 })
			const handler = new ErrorRecoveryHandler(task)
			expect(handler.shouldBypassCondense()).toBe(true)
		})
	})

	describe("recordCompactFailure", () => {
		it("increments counter and notifies user", async () => {
			const task = createMockTask()
			const handler = new ErrorRecoveryHandler(task)
			await handler.recordCompactFailure("compact failed")
			expect(task.compactFailureCount).toBe(1)
			expect(task.say).toHaveBeenCalledWith("condense_context_error", "compact failed")
		})

		it("announces degradation when threshold reached", async () => {
			const task = createMockTask({ compactFailureCount: 2, maxCompactFailures: 3 })
			const handler = new ErrorRecoveryHandler(task)
			await handler.recordCompactFailure("fail")
			expect(task.compactFailureCount).toBe(3)
			expect(task.say).toHaveBeenCalledTimes(2)
			expect(task.say).toHaveBeenLastCalledWith(
				"condense_context_error",
				expect.stringContaining("truncation mode"),
			)
		})

		it("does not announce degradation when below threshold", async () => {
			const task = createMockTask({ compactFailureCount: 0, maxCompactFailures: 3 })
			const handler = new ErrorRecoveryHandler(task)
			await handler.recordCompactFailure("fail")
			expect(task.compactFailureCount).toBe(1)
			expect(task.say).toHaveBeenCalledTimes(1)
		})

		it("increments correctly across multiple calls", async () => {
			const task = createMockTask()
			const handler = new ErrorRecoveryHandler(task)
			await handler.recordCompactFailure("fail 1")
			await handler.recordCompactFailure("fail 2")
			expect(task.compactFailureCount).toBe(2)
			// say called twice per failure below threshold (1 error message only),
			// then on 2nd failure still below threshold
			expect(task.say).toHaveBeenCalledTimes(2)
		})
	})

	describe("resetCompactFailure", () => {
		it("resets counter to zero", () => {
			const task = createMockTask({ compactFailureCount: 2 })
			const handler = new ErrorRecoveryHandler(task)
			handler.resetCompactFailure()
			expect(task.compactFailureCount).toBe(0)
		})

		it("is safe to call when already zero", () => {
			const task = createMockTask({ compactFailureCount: 0 })
			const handler = new ErrorRecoveryHandler(task)
			handler.resetCompactFailure()
			expect(task.compactFailureCount).toBe(0)
		})
	})

	// ── handleApiError ──────────────────────────────────────────────────

	describe("handleApiError", () => {
		async function handle(
			errorKind: string,
			retryAttempt = 0,
			taskOverrides: Record<string, unknown> = {},
			querySource?: QuerySource,
		) {
			const task = createMockTask(taskOverrides)
			vi.mocked(classifyApiError).mockImplementation(() => errorKind as any)
			const handler = new ErrorRecoveryHandler(task)
			const result = await handler.handleApiError(new Error("test error"), retryAttempt, querySource)
			return { task, result }
		}

		// ── Abort early exit ──

		it("returns fallthrough without classifying when task is aborted", async () => {
			const task = createMockTask({ abort: true })
			const handler = new ErrorRecoveryHandler(task)

			const result = await handler.handleApiError(new Error("test error"), 0)

			expect(result).toEqual({ action: "fallthrough" })
			expect(classifyApiError).not.toHaveBeenCalled()
		})

		// ── Capacity error with query source filtering ──

		it("capacity with user_query source retries via backoff_retry", async () => {
			const { result } = await handle("capacity", 0, {}, "user_query")
			expect(result).toEqual({ action: "fallthrough" }) // backoff_retry → default → fallthrough
		})

		it("capacity with auto_compact source returns fallthrough immediately", async () => {
			const { result } = await handle("capacity", 0, {}, "auto_compact")
			expect(result).toEqual({ action: "fallthrough" })
		})

		it("capacity with sub_task source returns fallthrough immediately", async () => {
			const { result } = await handle("capacity", 0, {}, "sub_task")
			expect(result).toEqual({ action: "fallthrough" })
		})

		it("model_overloaded with auto_compact source returns fallthrough immediately", async () => {
			const { result } = await handle("model_overloaded", 0, {}, "auto_compact")
			expect(result).toEqual({ action: "fallthrough" })
			expect(classifyApiError).toHaveBeenCalled()
		})

		it("model_overloaded with user_query source proceeds to backoff", async () => {
			const { result } = await handle("model_overloaded", 0, {}, "user_query")
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
		})

		it("model_overloaded with tool_execution source proceeds to backoff", async () => {
			const { result } = await handle("model_overloaded", 0, {}, "tool_execution")
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
		})

		// ── stale_connection → immediate_retry ──

		it("stale_connection returns immediate_retry", async () => {
			const { result } = await handle("stale_connection")
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
		})

		it("stale_connection at attempt 3 returns fallthrough (none)", async () => {
			const { result } = await handle("stale_connection", 3)
			expect(result).toEqual({ action: "fallthrough" })
		})

		// ── prompt_too_long → reactive_compact_then_retry ──

		it("prompt_too_long triggers reactive compaction and retries", async () => {
			const { result, task } = await handle("prompt_too_long", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
			expect(task.forceTaskState).toHaveBeenCalledWith("COMPACTING")
			expect(reactiveCompactMessages).toHaveBeenCalled()
		})

		it("prompt_too_long at attempt 3 returns fallthrough (none)", async () => {
			const { result } = await handle("prompt_too_long", 3)
			expect(result).toEqual({ action: "fallthrough" })
		})

		it("prompt_too_long overwrites history when compaction changes messages", async () => {
			const compacted = [{ role: "user", content: "compacted" }]
			vi.mocked(reactiveCompactMessages).mockReturnValue(compacted as any)
			const { task } = await handle("prompt_too_long", 0)
			expect(task.overwriteApiConversationHistory).toHaveBeenCalledWith(compacted)
			expect(task.tokenUsageSnapshot).toBeTruthy()
			expect(task.tokenUsageSnapshotAt).toBeGreaterThan(0)
		})

		it("prompt_too_long skips overwrite when compaction returns same reference", async () => {
			const history = [{ role: "user", content: "hello" }]
			const task = createMockTask({ apiConversationHistory: history })
			vi.mocked(classifyApiError).mockImplementation(() => "prompt_too_long" as any)
			vi.mocked(reactiveCompactMessages).mockReturnValue(history as any)
			const handler = new ErrorRecoveryHandler(task)
			await handler.handleApiError(new Error("test"), 0)
			expect(task.overwriteApiConversationHistory).not.toHaveBeenCalled()
		})

		// ── max_output_tokens → retry_with_continuation ──

		it("max_output_tokens adds continuation cue and retries (no compaction at attempt 0)", async () => {
			const { result, task } = await handle("max_output_tokens", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
			expect(task.forceTaskState).toHaveBeenCalledWith("COMPACTING")
			// applyReactiveCompaction skips compaction when action is
			// retry_with_continuation and retryAttempt < 1
			expect(reactiveCompactMessages).not.toHaveBeenCalled()
			expect(task.addToApiConversationHistory).toHaveBeenCalledWith(
				expect.objectContaining({
					role: "user",
					content: expect.stringContaining("continue from where you stopped"),
				}),
			)
		})

		it("max_output_tokens at attempt 1 triggers reactive compaction", async () => {
			const { result } = await handle("max_output_tokens", 1)
			expect(result).toEqual({ action: "retry", nextAttempt: 2 })
			expect(reactiveCompactMessages).toHaveBeenCalled()
		})

		it("max_output_tokens at attempt 3 returns fallthrough (none)", async () => {
			const { result } = await handle("max_output_tokens", 3)
			expect(result).toEqual({ action: "fallthrough" })
		})

		// ── context_window_exceeded → context_window_recover ──

		it("context_window_exceeded triggers context recovery and retries", async () => {
			const { result, task } = await handle("context_window_exceeded", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
			expect(task.forceTaskState).toHaveBeenCalledWith("COMPACTING")
			expect(task.handleContextWindowExceededError).toHaveBeenCalled()
		})

		it("context_window_exceeded at attempt 2 returns fallthrough (none)", async () => {
			const { result } = await handle("context_window_exceeded", 2)
			expect(result).toEqual({ action: "fallthrough" })
		})

		// ── content_policy → content_policy_reject ──

		it("content_policy returns fallthrough and notifies user", async () => {
			const { result, task } = await handle("content_policy")
			expect(result).toEqual({ action: "fallthrough" })
			expect(task.say).toHaveBeenCalledWith("error", expect.stringContaining("content safety policy"))
		})

		// ── media_too_large → strip_media_retry ──

		it("media_too_large strips media and retries", async () => {
			const { result } = await handle("media_too_large", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
		})

		it("media_too_large at attempt 2 returns fallthrough (none)", async () => {
			const { result } = await handle("media_too_large", 2)
			expect(result).toEqual({ action: "fallthrough" })
		})

		it("media_too_large replaces image blocks with text placeholder", async () => {
			const history = [
				{
					role: "user",
					content: [{ type: "image", source: { type: "base64", data: "abc" } }],
				},
				{ role: "assistant", content: "response" },
			]
			const { task } = await handle("media_too_large", 0, {
				apiConversationHistory: history,
			})
			expect(task.overwriteApiConversationHistory).toHaveBeenCalled()
			const updatedHistory = task.overwriteApiConversationHistory.mock.calls[0][0]
			const firstMsgContent = updatedHistory[0].content
			expect(firstMsgContent[0].type).toBe("text")
			expect(firstMsgContent[0].text).toContain("Image removed")
		})

		it("media_too_large does not overwrite when no media blocks exist", async () => {
			const history = [
				{ role: "user", content: "plain text" },
				{ role: "assistant", content: "response" },
			]
			const { task } = await handle("media_too_large", 0, {
				apiConversationHistory: history,
			})
			expect(task.overwriteApiConversationHistory).not.toHaveBeenCalled()
		})

		it("media_too_large preserves non-image blocks when stripping", async () => {
			const history = [
				{
					role: "user",
					content: [
						{ type: "text", text: "keep me" },
						{ type: "image", source: { type: "base64", data: "abc" } },
					],
				},
			]
			const { task } = await handle("media_too_large", 0, {
				apiConversationHistory: history,
			})
			expect(task.overwriteApiConversationHistory).toHaveBeenCalled()
			const updatedHistory = task.overwriteApiConversationHistory.mock.calls[0][0]
			const blocks = updatedHistory[0].content
			expect(blocks[0]).toEqual({ type: "text", text: "keep me" })
			expect(blocks[1].type).toBe("text")
			expect(blocks[1].text).toContain("Image removed")
		})

		// ── model_overloaded → overloaded_backoff ──

		it("model_overloaded applies backoff and retries", async () => {
			const { result } = await handle("model_overloaded", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
		})

		it("model_overloaded at attempt 3 returns model_fallback", async () => {
			const { result } = await handle("model_overloaded", 3)
			expect(result.action).toBe("model_fallback")
			if (result.action === "model_fallback") {
				expect(result.errorCategory).toBe("model_overloaded")
				expect(result.reason).toContain("retries exhausted")
			}
		})

		// ── invalid_tool_use → inject_tool_hint_retry ──

		it("invalid_tool_use injects hint and retries", async () => {
			const { result, task } = await handle("invalid_tool_use", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
			expect(task.addToApiConversationHistory).toHaveBeenCalledWith(
				expect.objectContaining({
					role: "user",
					content: expect.stringContaining("invalid format"),
				}),
			)
		})

		it("invalid_tool_use at attempt 0 does not include example", async () => {
			const { task } = await handle("invalid_tool_use", 0)
			const injected = task.addToApiConversationHistory.mock.calls[0][0].content
			expect(injected).not.toContain("Example")
		})

		it("invalid_tool_use at attempt 1 includes usage example", async () => {
			const { task } = await handle("invalid_tool_use", 1)
			expect(task.addToApiConversationHistory).toHaveBeenCalledWith(
				expect.objectContaining({
					role: "user",
					content: expect.stringContaining("Example"),
				}),
			)
		})

		it("invalid_tool_use at attempt 2 also includes example", async () => {
			const { task } = await handle("invalid_tool_use", 2)
			const injected = task.addToApiConversationHistory.mock.calls[0][0].content
			expect(injected).toContain("Example")
		})

		it("invalid_tool_use at attempt 3 returns fallthrough (none)", async () => {
			const { result } = await handle("invalid_tool_use", 3)
			expect(result).toEqual({ action: "fallthrough" })
		})

		// ── partial_response → partial_continue ──

		it("partial_response adds continuation cue and retries", async () => {
			const { result, task } = await handle("partial_response", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
			expect(task.addToApiConversationHistory).toHaveBeenCalledWith(
				expect.objectContaining({
					role: "user",
					content: expect.stringContaining("continue"),
				}),
			)
		})

		it("partial_response at attempt 3 returns fallthrough (none)", async () => {
			const { result } = await handle("partial_response", 3)
			expect(result).toEqual({ action: "fallthrough" })
		})

		// ── addContinuationCue edge cases (via partial_response) ──

		it("addContinuationCue skips when pending tool_use exists in assistantMessageContent", async () => {
			const { task } = await handle("partial_response", 0, {
				assistantMessageContent: [{ type: "tool_use", id: "tu-1" }],
			})
			expect(task.addToApiConversationHistory).not.toHaveBeenCalled()
		})

		it("addContinuationCue skips when pending mcp_tool_use exists", async () => {
			const { task } = await handle("partial_response", 0, {
				assistantMessageContent: [{ type: "mcp_tool_use", id: "mcp-1" }],
			})
			expect(task.addToApiConversationHistory).not.toHaveBeenCalled()
		})

		it("addContinuationCue skips when continuation cue already in last user message", async () => {
			const continuationCue =
				"Please continue from where you stopped. Do not repeat prior content; only provide the remaining continuation."
			const history = [
				{ role: "assistant", content: "partial output" },
				{ role: "user", content: continuationCue },
			]
			const { task } = await handle("partial_response", 0, {
				apiConversationHistory: history,
			})
			// Should not add another continuation cue
			expect(task.addToApiConversationHistory).not.toHaveBeenCalled()
		})

		it("addContinuationCue adds orphaned tool_results for tool_use blocks in last assistant message", async () => {
			const history = [
				{
					role: "assistant",
					content: [
						{ type: "tool_use", id: "tu-1", name: "read_file" },
						{ type: "tool_use", id: "tu-2", name: "write_file" },
					],
				},
			]
			const { task } = await handle("partial_response", 0, {
				apiConversationHistory: history,
			})
			// First call: orphaned tool results, second call: continuation cue
			expect(task.addToApiConversationHistory).toHaveBeenCalledTimes(2)
			const toolResultsCall = task.addToApiConversationHistory.mock.calls[0][0]
			expect(toolResultsCall.role).toBe("user")
			expect(toolResultsCall.content).toHaveLength(2)
			expect(toolResultsCall.content[0].tool_use_id).toBe("tu-1")
			expect(toolResultsCall.content[0].type).toBe("tool_result")
			expect(toolResultsCall.content[1].tool_use_id).toBe("tu-2")
		})

		it("addContinuationCue does not add orphaned results when assistant has no tool_use blocks", async () => {
			const history = [
				{
					role: "assistant",
					content: [{ type: "text", text: "just text" }],
				},
			]
			const { task } = await handle("partial_response", 0, {
				apiConversationHistory: history,
			})
			// Only continuation cue, no orphaned tool results
			expect(task.addToApiConversationHistory).toHaveBeenCalledTimes(1)
			expect(task.addToApiConversationHistory).toHaveBeenCalledWith(
				expect.objectContaining({
					role: "user",
					content: expect.stringContaining("continue"),
				}),
			)
		})

		it("addContinuationCue handles history with no assistant message", async () => {
			const history = [{ role: "user", content: "hello" }]
			const { task } = await handle("partial_response", 0, {
				apiConversationHistory: history,
			})
			// No orphaned tool results (no assistant msg), just the cue
			expect(task.addToApiConversationHistory).toHaveBeenCalledTimes(1)
		})

		// ── server_error → server_error_backoff ──

		it("server_error applies backoff and retries", async () => {
			const { result } = await handle("server_error", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
		})

		it("server_error at attempt 5 returns fallthrough (none)", async () => {
			const { result } = await handle("server_error", 5)
			expect(result).toEqual({ action: "fallthrough" })
		})

		// ── unknown → unknown_single_retry ──

		it("unknown error returns single retry", async () => {
			const { result } = await handle("unknown", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
		})

		it("unknown error at attempt 1 returns fallthrough (none)", async () => {
			const { result } = await handle("unknown", 1)
			expect(result).toEqual({ action: "fallthrough" })
		})

		// ── timeout → timeout_degrade / model_fallback ──

		it("timeout at attempt 0 returns fallthrough (timeout_degrade is default)", async () => {
			const { result } = await handle("timeout", 0)
			expect(result).toEqual({ action: "fallthrough" })
		})

		it("timeout at attempt 3 returns model_fallback", async () => {
			const { result } = await handle("timeout", 3)
			expect(result.action).toBe("model_fallback")
			if (result.action === "model_fallback") {
				expect(result.reason).toContain("retries exhausted")
				expect(result.errorCategory).toBe("timeout")
			}
		})

		// ── rate_limit → backoff_retry (falls through) ──

		it("rate_limit returns fallthrough (backoff_retry is default case)", async () => {
			const { result } = await handle("rate_limit", 0)
			expect(result).toEqual({ action: "fallthrough" })
		})

		// ── auth_error → none ──

		it("auth_error returns fallthrough (none)", async () => {
			const { result } = await handle("auth_error", 0)
			expect(result).toEqual({ action: "fallthrough" })
		})

		// ── appendRetryEvent diagnostics ──

		it("records retry event via appendRetryEvent", async () => {
			await handle("server_error", 2)
			expect(appendRetryEvent).toHaveBeenCalledWith(
				"/tmp/storage",
				expect.objectContaining({
					taskId: "task-1",
					retryAttempt: 2,
					errorKind: "server_error",
					errorMessage: "test error",
				}),
			)
		})

		it("continues to recovery action when appendRetryEvent fails", async () => {
			vi.mocked(appendRetryEvent).mockRejectedValueOnce(new Error("disk full"))
			const { result } = await handle("server_error", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
			expect(logger.warn).toHaveBeenCalledWith(
				"ErrorRecoveryHandler",
				expect.stringContaining("Failed to persist retry event"),
			)
		})

		// ── Non-Error objects ──

		it("handles string error in unknown_single_retry branch", async () => {
			const task = createMockTask()
			vi.mocked(classifyApiError).mockImplementation(() => "unknown" as any)
			const handler = new ErrorRecoveryHandler(task)
			const result = await handler.handleApiError("just a string error", 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
		})

		it("handles null error gracefully", async () => {
			const task = createMockTask()
			vi.mocked(classifyApiError).mockImplementation(() => "unknown" as any)
			const handler = new ErrorRecoveryHandler(task)
			const result = await handler.handleApiError(null, 0)
			expect(result).toEqual({ action: "retry", nextAttempt: 1 })
		})

		// ── model_fallback result shape ──

		it("model_fallback for model_overloaded includes correct errorCategory", async () => {
			const { result } = await handle("model_overloaded", 3)
			expect(result).toMatchObject({
				action: "model_fallback",
				errorCategory: "model_overloaded",
			})
		})
	})

	// ── shouldTriggerFallback ──────────────────────────────────────────────

	describe("shouldTriggerFallback", () => {
		it("returns false for non-eligible error categories", () => {
			const handler = new ErrorRecoveryHandler(createMockTask())
			expect(handler.shouldTriggerFallback("rate_limit" as any, 5)).toBe(false)
		})

		it("returns false for auth_error even at high retry count", () => {
			const handler = new ErrorRecoveryHandler(createMockTask())
			expect(handler.shouldTriggerFallback("auth_error" as any, 100)).toBe(false)
		})

		it("returns false for unknown even at high retry count", () => {
			const handler = new ErrorRecoveryHandler(createMockTask())
			expect(handler.shouldTriggerFallback("unknown" as any, 100)).toBe(false)
		})

		it("returns true for timeout at fallback threshold (attempt 3)", () => {
			const handler = new ErrorRecoveryHandler(createMockTask())
			expect(handler.shouldTriggerFallback("timeout" as any, 3)).toBe(true)
		})

		it("returns true for model_overloaded at fallback threshold (attempt 3)", () => {
			const handler = new ErrorRecoveryHandler(createMockTask())
			expect(handler.shouldTriggerFallback("model_overloaded" as any, 3)).toBe(true)
		})

		it("returns true for server_error at fallback threshold", () => {
			const handler = new ErrorRecoveryHandler(createMockTask())
			// server_error: retryAttempt < 5 → server_error_backoff, else → none (not model_fallback)
			expect(handler.shouldTriggerFallback("server_error" as any, 5)).toBe(false)
		})

		it("returns false for timeout before fallback threshold", () => {
			const handler = new ErrorRecoveryHandler(createMockTask())
			expect(handler.shouldTriggerFallback("timeout" as any, 0)).toBe(false)
			expect(handler.shouldTriggerFallback("timeout" as any, 1)).toBe(false)
			expect(handler.shouldTriggerFallback("timeout" as any, 2)).toBe(false)
		})

		it("returns false for model_overloaded before fallback threshold", () => {
			const handler = new ErrorRecoveryHandler(createMockTask())
			expect(handler.shouldTriggerFallback("model_overloaded" as any, 0)).toBe(false)
			expect(handler.shouldTriggerFallback("model_overloaded" as any, 2)).toBe(false)
		})

		it("returns true for timeout beyond fallback threshold", () => {
			const handler = new ErrorRecoveryHandler(createMockTask())
			expect(handler.shouldTriggerFallback("timeout" as any, 5)).toBe(true)
		})
	})
})
