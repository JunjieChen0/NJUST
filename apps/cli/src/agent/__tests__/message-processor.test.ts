import { describe, it, expect, vi } from "vitest"
import { MessageProcessor } from "../message-processor.ts"
import { StateStore } from "../state-store.ts"
import { TypedEventEmitter } from "../events.ts"
import type { ClineMessage } from "@njust-ai/types"

describe("MessageProcessor - Structured Events (Phase 1.5)", () => {
	function createProcessor() {
		const store = new StateStore()
		const emitter = new TypedEventEmitter()
		const processor = new MessageProcessor(store, emitter, { debug: false })
		return { store, emitter, processor }
	}

	it("emits textStarted for partial text message", () => {
		const { emitter, processor } = createProcessor()
		const handler = vi.fn()
		emitter.on("textStarted", handler)

		const message: ClineMessage = {
			id: "1",
			ts: 1000,
			type: "say",
			say: "text",
			text: "Hello",
			partial: true,
		}

		processor.processMessage({
			type: "messageUpdated",
			clineMessage: message,
		})

		expect(handler).toHaveBeenCalledWith({ messageId: "1", ts: 1000 })
	})

	it("emits textCompleted for complete text message", () => {
		const { emitter, processor } = createProcessor()
		const handler = vi.fn()
		emitter.on("textCompleted", handler)

		const message: ClineMessage = {
			id: "1",
			ts: 1000,
			type: "say",
			say: "text",
			text: "Hello world",
			partial: false,
		}

		processor.processMessage({
			type: "messageUpdated",
			clineMessage: message,
		})

		expect(handler).toHaveBeenCalledWith({ messageId: "1", ts: 1000 })
	})

	it("emits reasoningStarted for partial reasoning", () => {
		const { emitter, processor } = createProcessor()
		const handler = vi.fn()
		emitter.on("reasoningStarted", handler)

		const message: ClineMessage = {
			id: "2",
			ts: 2000,
			type: "say",
			say: "reasoning",
			text: "Thinking...",
			partial: true,
		}

		processor.processMessage({
			type: "messageUpdated",
			clineMessage: message,
		})

		expect(handler).toHaveBeenCalledWith({ messageId: "2", ts: 2000 })
	})

	it("emits toolStarted for tool say", () => {
		const { emitter, processor } = createProcessor()
		const handler = vi.fn()
		emitter.on("toolStarted", handler)

		const message: ClineMessage = {
			id: "3",
			ts: 3000,
			type: "say",
			say: "tool",
			text: '{"tool": "read_file"}',
		}

		processor.processMessage({
			type: "messageUpdated",
			clineMessage: message,
		})

		expect(handler).toHaveBeenCalledWith({ messageId: "3", ts: 3000 })
	})

	it("emits approvalRequested for tool ask", () => {
		const { emitter, processor } = createProcessor()
		const handler = vi.fn()
		emitter.on("approvalRequested", handler)

		const message: ClineMessage = {
			id: "4",
			ts: 4000,
			type: "ask",
			ask: "tool",
			text: "Approve file read?",
		}

		processor.processMessage({
			type: "messageUpdated",
			clineMessage: message,
		})

		expect(handler).toHaveBeenCalledWith({ messageId: "4", ts: 4000 })
	})

	it("emits questionRequested for followup ask", () => {
		const { emitter, processor } = createProcessor()
		const handler = vi.fn()
		emitter.on("questionRequested", handler)

		const message: ClineMessage = {
			id: "5",
			ts: 5000,
			type: "ask",
			ask: "followup",
			text: "What would you like to do next?",
		}

		processor.processMessage({
			type: "messageUpdated",
			clineMessage: message,
		})

		expect(handler).toHaveBeenCalledWith({ messageId: "5", ts: 5000 })
	})

	it("emits all new messages in state message, not just last", () => {
		const { emitter, processor } = createProcessor()
		const handler = vi.fn()
		emitter.on("message", handler)

		const messages: ClineMessage[] = [
			{ id: "1", ts: 1000, type: "say", say: "text", text: "First", partial: false },
			{ id: "2", ts: 2000, type: "say", say: "text", text: "Second", partial: false },
			{ id: "3", ts: 3000, type: "say", say: "text", text: "Third", partial: false },
		]

		processor.processMessage({
			type: "state",
			state: {
				clineMessages: messages,
				mode: "code",
			},
		})

		// All 3 messages should be emitted
		expect(handler).toHaveBeenCalledTimes(3)
		expect(handler).toHaveBeenNthCalledWith(1, messages[0])
		expect(handler).toHaveBeenNthCalledWith(2, messages[1])
		expect(handler).toHaveBeenNthCalledWith(3, messages[2])
	})
})
