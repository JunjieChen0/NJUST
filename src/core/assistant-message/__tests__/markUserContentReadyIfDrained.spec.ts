// npx vitest src/core/assistant-message/__tests__/markUserContentReadyIfDrained.spec.ts

import { describe, it, expect, beforeEach } from "vitest"
import { markUserContentReadyIfDrained } from "../presentAssistantMessage"

describe("markUserContentReadyIfDrained", () => {
	let mockTask: any

	beforeEach(() => {
		mockTask = {
			didCompleteReadingStream: false,
			currentStreamingContentIndex: 0,
			assistantMessageContent: [],
			userMessageContentReady: false,
		}
	})

	it("should set userMessageContentReady when stream is complete and index is past all blocks", () => {
		mockTask.didCompleteReadingStream = true
		mockTask.currentStreamingContentIndex = 0
		mockTask.assistantMessageContent = []

		markUserContentReadyIfDrained(mockTask)
		expect(mockTask.userMessageContentReady).toBe(true)
	})

	it("should set userMessageContentReady when index equals content length", () => {
		mockTask.didCompleteReadingStream = true
		mockTask.currentStreamingContentIndex = 2
		mockTask.assistantMessageContent = [{ type: "text" }, { type: "text" }]

		markUserContentReadyIfDrained(mockTask)
		expect(mockTask.userMessageContentReady).toBe(true)
	})

	it("should not set userMessageContentReady when stream is not complete", () => {
		mockTask.didCompleteReadingStream = false
		mockTask.currentStreamingContentIndex = 0
		mockTask.assistantMessageContent = []

		markUserContentReadyIfDrained(mockTask)
		expect(mockTask.userMessageContentReady).toBe(false)
	})

	it("should not set userMessageContentReady when there are unprocessed blocks", () => {
		mockTask.didCompleteReadingStream = true
		mockTask.currentStreamingContentIndex = 0
		mockTask.assistantMessageContent = [{ type: "text" }]

		markUserContentReadyIfDrained(mockTask)
		expect(mockTask.userMessageContentReady).toBe(false)
	})

	it("should be idempotent — calling twice has no ill effect", () => {
		mockTask.didCompleteReadingStream = true
		mockTask.currentStreamingContentIndex = 1
		mockTask.assistantMessageContent = [{ type: "text" }]

		markUserContentReadyIfDrained(mockTask)
		expect(mockTask.userMessageContentReady).toBe(true)

		markUserContentReadyIfDrained(mockTask)
		expect(mockTask.userMessageContentReady).toBe(true)
	})
})
