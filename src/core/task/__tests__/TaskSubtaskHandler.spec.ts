import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../shared/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock("../../environment/getEnvironmentDetails", () => ({
	getEnvironmentDetails: vi.fn(() => "<env>mock</env>"),
}))

vi.mock("../SubTaskContextBuilder", () => ({
	generateParentContextSummary: vi.fn(() => "parent-summary"),
}))

import { TaskSubtaskHandler } from "../TaskSubtaskHandler"
import { NJUST_AIEventName } from "@njust-ai/types"
import type { TaskSubtaskHost } from "../interfaces/TaskSubtaskHost"
import { generateParentContextSummary } from "../SubTaskContextBuilder"

function createMockProvider() {
	return {
		delegateParentAndOpenChild: vi.fn().mockResolvedValue({ taskId: "child-1" }),
	}
}

function createHost(overrides: Partial<Record<keyof TaskSubtaskHost, unknown>> = {}): TaskSubtaskHost {
	const provider = createMockProvider()
	const host: TaskSubtaskHost = {
		taskId: "task-1",
		hostRef: { deref: () => provider } as any,
		apiConversationHistory: [
			{ role: "user", content: [{ type: "text", text: "hello" }] } as any,
			{ role: "assistant", content: [{ type: "text", text: "hi back" }] } as any,
		],
		abort: true,
		abandoned: true,
		isStreaming: true,
		idleAsk: {} as any,
		resumableAsk: {} as any,
		interactiveAsk: {} as any,
		abortReason: "some-reason",
		didFinishAbortingStream: true,
		isWaitingForFirstChunk: true,
		skipPrevResponseIdOnce: false,
		isInitialized: false,
		emit: vi.fn(),
		getSavedApiConversationHistory: vi.fn().mockResolvedValue([]),
		saveApiConversationHistory: vi.fn().mockResolvedValue(true),
		initiateTaskLoop: vi.fn().mockResolvedValue(undefined),
		...overrides,
	}
	return host
}

describe("TaskSubtaskHandler", () => {
	let handler: TaskSubtaskHandler
	let host: TaskSubtaskHost
	let mockProvider: ReturnType<typeof createMockProvider>

	beforeEach(() => {
		vi.clearAllMocks()
		mockProvider = createMockProvider()
		host = createHost({
			hostRef: { deref: () => mockProvider } as any,
		})
		handler = new TaskSubtaskHandler(host)
	})

	describe("startSubtask", () => {
		it("shared isolation: calls provider.delegateParentAndOpenChild without generating context summary", async () => {
			const result = await handler.startSubtask("do something", [], "code")

			expect(generateParentContextSummary).not.toHaveBeenCalled()
			expect(mockProvider.delegateParentAndOpenChild).toHaveBeenCalledWith({
				parentTaskId: "task-1",
				message: "do something",
				initialTodos: [],
				mode: "code",
				isolationLevel: "shared",
				forkedContextSummary: undefined,
				cacheSafeParams: undefined,
			})
			expect(result).toEqual({ taskId: "child-1" })
		})

		it("forked isolation: calls generateParentContextSummary when no cacheSafeParams provided", async () => {
			await handler.startSubtask("do forked task", [], "code", "forked")

			expect(generateParentContextSummary).toHaveBeenCalledWith(
				host.apiConversationHistory,
				expect.any(Number),
				expect.objectContaining({ summaryMaxTokens: expect.any(Number) }),
			)
			expect(mockProvider.delegateParentAndOpenChild).toHaveBeenCalledWith(
				expect.objectContaining({
					isolationLevel: "forked",
					forkedContextSummary: "parent-summary",
					cacheSafeParams: undefined,
				}),
			)
		})

		it("forked isolation with cacheSafeParams: uses provided params directly", async () => {
			const cacheSafeParams = {
				systemPrompt: "sys-prompt",
				userContext: "user-ctx",
			}

			await handler.startSubtask("cached fork", [], "code", "forked", undefined, cacheSafeParams)

			expect(generateParentContextSummary).not.toHaveBeenCalled()
			expect(mockProvider.delegateParentAndOpenChild).toHaveBeenCalledWith(
				expect.objectContaining({
					isolationLevel: "forked",
					forkedContextSummary: "cached fork",
					cacheSafeParams,
				}),
			)
		})

		it("throws when provider is unavailable (hostRef.deref() returns undefined)", async () => {
			const orphanHost = createHost({
				hostRef: { deref: () => undefined } as any,
			})
			const orphanHandler = new TaskSubtaskHandler(orphanHost)

			await expect(orphanHandler.startSubtask("fail", [], "code")).rejects.toThrow("Provider not available")
		})
	})

	describe("resumeAfterDelegation", () => {
		it("resets abort, abandoned and isStreaming states", async () => {
			// Pre-conditions: host starts in aborted/streaming state
			expect(host.abort).toBe(true)
			expect(host.abandoned).toBe(true)
			expect(host.isStreaming).toBe(true)

			await handler.resumeAfterDelegation()

			expect(host.abort).toBe(false)
			expect(host.abandoned).toBe(false)
			expect(host.isStreaming).toBe(false)
			expect(host.idleAsk).toBeUndefined()
			expect(host.resumableAsk).toBeUndefined()
			expect(host.interactiveAsk).toBeUndefined()
			expect(host.abortReason).toBeUndefined()
			expect(host.didFinishAbortingStream).toBe(false)
			expect(host.isWaitingForFirstChunk).toBe(false)
			expect(host.skipPrevResponseIdOnce).toBe(true)
			expect(host.isInitialized).toBe(true)
		})

		it("emits TaskActive event with taskId", async () => {
			await handler.resumeAfterDelegation()

			expect(host.emit).toHaveBeenCalledWith(NJUST_AIEventName.TaskActive, "task-1")
		})

		it("loads saved history when apiConversationHistory is empty", async () => {
			const savedHistory = [{ role: "user", content: [{ type: "text", text: "saved user msg" }] }] as any[]
			const emptyHost = createHost({
				hostRef: { deref: () => mockProvider } as any,
				apiConversationHistory: [],
				getSavedApiConversationHistory: vi.fn().mockResolvedValue(savedHistory),
			})
			const emptyHandler = new TaskSubtaskHandler(emptyHost)

			await emptyHandler.resumeAfterDelegation()

			expect(emptyHost.getSavedApiConversationHistory).toHaveBeenCalled()
			expect(emptyHost.apiConversationHistory).toEqual(savedHistory)
		})

		it("calls initiateTaskLoop at the end", async () => {
			await handler.resumeAfterDelegation()

			expect(host.initiateTaskLoop).toHaveBeenCalledWith([])
		})

		it("calls saveApiConversationHistory", async () => {
			await handler.resumeAfterDelegation()

			expect(host.saveApiConversationHistory).toHaveBeenCalled()
		})
	})
})
