import { describe, it, expect, vi } from "vitest"

vi.mock("@njust-ai-cj/telemetry", () => ({
	TelemetryService: { instance: { captureSlidingWindowTruncation: vi.fn() } },
}))

import { truncateConversation, MAX_CONSECUTIVE_COMPACT_FAILURES } from "../index"
import type { ApiMessage } from "../../task-persistence/apiMessages"

function makeMsg(role: string, content: string, index: number): ApiMessage {
	return {
		role: role as ApiMessage["role"],
		content,
		ts: Date.now() + index,
	} as ApiMessage
}

describe("truncateConversation", () => {
	it("keeps first message and removes middle messages", () => {
		const messages: ApiMessage[] = [
			makeMsg("user", "start", 0),
			makeMsg("assistant", "mid1", 1),
			makeMsg("user", "mid2", 2),
			makeMsg("assistant", "mid3", 3),
			makeMsg("user", "end", 4),
		]
		const result = truncateConversation(messages, 0.4, "task-1")
		expect(result.messages).toHaveLength(messages.length)
		expect(result.messagesRemoved).toBeGreaterThan(0)
	})

	it("does not remove the first message", () => {
		const messages: ApiMessage[] = [
			makeMsg("user", "system prompt", 0),
			makeMsg("assistant", "response", 1),
		]
		const result = truncateConversation(messages, 0.5, "task-1")
		expect(result.messages.length).toBeGreaterThanOrEqual(1)
	})

	it("returns empty removal when fraction is 0", () => {
		const messages: ApiMessage[] = [
			makeMsg("user", "hello", 0),
			makeMsg("assistant", "hi", 1),
		]
		const result = truncateConversation(messages, 0, "task-1")
		expect(result.messagesRemoved).toBe(0)
	})

	it("handles single message gracefully", () => {
		const messages: ApiMessage[] = [makeMsg("user", "only", 0)]
		const result = truncateConversation(messages, 0.5, "task-1")
		expect(result.messages).toHaveLength(1)
		expect(result.messagesRemoved).toBe(0)
	})

	it("generates a unique truncation ID", () => {
		const messages: ApiMessage[] = [
			makeMsg("user", "a", 0),
			makeMsg("assistant", "b", 1),
		]
		const r1 = truncateConversation(messages, 0.3, "t1")
		const r2 = truncateConversation(messages, 0.3, "t1")
		expect(r1.truncationId).toBeDefined()
		expect(r1.truncationId).not.toBe(r2.truncationId)
	})

	it("circle breaker MAX_CONSECUTIVE_COMPACT_FAILURES is 3", () => {
		expect(MAX_CONSECUTIVE_COMPACT_FAILURES).toBe(3)
	})
})
