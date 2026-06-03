import { describe, expect, it, vi } from "vitest"
import type { ApiStreamChunk } from "../../../api/transform/stream"
import { handleAttemptApiRequestError, handleMidStreamFailure, handleEmptyAssistantResponse } from "../TaskRetryHandler"
import { TaskState } from "../TaskStateMachine"
import { TaskAbortedError, TaskRetryExhaustedError } from "../TaskErrors"

vi.mock("../../../shared/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock("../../../shared/error-utils", () => ({
	delay: vi.fn(() => Promise.resolve()),
	getErrorMessage: vi.fn((e: unknown) => String(e)),
}))

vi.mock("../../errors/apiErrorClassifier", () => ({
	classifyApiError: vi.fn(),
}))

// ── Mock helpers ────────────────────────────────────────────────────────────

const mockClassifyApiError = vi.mocked((await import("../../errors/apiErrorClassifier")).classifyApiError)

function createMockPersistentRetryHandler() {
	return {
		isEligible: vi.fn().mockReturnValue(false),
		waitForRetry: vi.fn().mockResolvedValue(undefined),
		cancel: vi.fn(),
		getStats: vi.fn().mockReturnValue({ totalRetries: 0, records: new Map(), isExhausted: false }),
		recordRetry: vi.fn(),
		recordSuccess: vi.fn(),
		canRetry: vi.fn().mockReturnValue({ allowed: true, reason: "", suggestedDelayMs: 1000, shouldFallback: false }),
		reset: vi.fn(),
	}
}

function createMockHost(overrides: Record<string, any> = {}) {
	const autoApprovalEnabled = overrides.autoApprovalEnabled ?? false
	const hostState = { autoApprovalEnabled }

	const host: any = {
		// Identity
		taskId: "test-task",
		instanceId: "test-instance",
		globalStoragePath: "/tmp",
		cwd: "/tmp",
		abort: false,
		abortReason: undefined,
		taskCompleted: false,
		isPaused: false,
		isStreaming: false,
		isWaitingForFirstChunk: true,

		// API
		apiConfiguration: {},
		api: {},
		apiConversationHistory: [],
		clineMessages: [],
		userMessageContent: [],
		assistantMessageContent: [],
		assistantMessageSavedToHistory: false,
		userMessageContentReady: false,
		currentStreamingContentIndex: 0,
		didCompleteReadingStream: false,

		// Stream state
		abandoned: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		didToolFailInCurrentTurn: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		consecutiveNoToolUseCount: 0,
		consecutiveNoAssistantMessagesCount: 0,
		streamingToolCallIndices: new Map(),
		didFinishAbortingStream: false,
		currentStreamingDidCheckpoint: false,

		// Request state
		currentRequestAbortController: undefined,
		skipPrevResponseIdOnce: false,
		consecutiveMistakeCount: 0,
		consecutiveMistakeLimit: 3,
		didEditFile: false,

		// Token tracking
		requestCacheReadWindow: [],
		requestInputTokensWindow: [],
		cachedToolDefinitions: undefined,

		// Delegates
		stateMachine: {
			force: vi.fn(),
			state: TaskState.STREAMING,
		},
		hostRef: {
			deref: vi.fn().mockReturnValue({
				getState: vi.fn().mockResolvedValue(hostState),
				log: vi.fn(),
			}),
		},
		requestBuilder: {
			prefetchSystemPromptData: vi.fn(),
			getSystemPromptParts: vi.fn().mockResolvedValue({}),
			getSystemPrompt: vi.fn().mockResolvedValue(""),
			condenseContext: vi.fn().mockResolvedValue(undefined),
			inheritCacheFromParent: vi.fn(),
		},
		streamProcessor: {
			maybeWaitForProviderRateLimit: vi.fn().mockResolvedValue(undefined),
			backoffAndAnnounce: vi.fn().mockResolvedValue(undefined),
			buildCleanConversationHistory: vi.fn().mockReturnValue([]),
			getCurrentProfileId: vi.fn().mockReturnValue("default"),
			handleContextWindowExceededError: vi.fn().mockResolvedValue(undefined),
			getFilesReadByRooSafely: vi.fn().mockResolvedValue(undefined),
		},
		errorRecovery: {
			handleApiError: vi.fn().mockResolvedValue({ action: "manual", nextAttempt: 0 }),
			shouldBypassCondense: vi.fn().mockReturnValue(false),
			recordCompactFailure: vi.fn().mockResolvedValue(undefined),
			resetCompactFailure: vi.fn(),
		},
		persistentRetryHandler: createMockPersistentRetryHandler(),
		autoApprovalHandler: {
			checkAutoApprovalLimits: vi.fn().mockResolvedValue({ shouldProceed: true }),
		},
		tokenGrowthTracker: {
			addSample: vi.fn(),
			getSnapshot: vi.fn().mockReturnValue(undefined),
		},
		parentTask: undefined,
		rooIgnoreController: undefined,
		toolExecution: {
			dispose: vi.fn(),
			streamingExecutor: { shouldEagerExecute: vi.fn().mockReturnValue(null) },
		},
		compactFailureCount: 0,

		// Diff & file context
		diffViewProvider: {},
		fileContextTracker: {},

		// Messaging
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		addToApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		pushToolResultToUserContent: vi.fn().mockReturnValue(true),
		cancelCurrentRequest: vi.fn(),

		// Control
		getTokenUsage: vi.fn().mockReturnValue({}),
		combineMessages: vi.fn().mockReturnValue([]),
		emit: vi.fn().mockReturnValue(true),
		setLastGlobalApiRequestTime: vi.fn(),
		getLastGlobalApiRequestTime: vi.fn().mockReturnValue(0),
		saveClineMessages: vi.fn().mockResolvedValue(true),
		refreshWebviewState: vi.fn().mockResolvedValue(undefined),
		updateClineMessage: vi.fn().mockResolvedValue(undefined),
		abortTask: vi.fn().mockResolvedValue(undefined),
		backoffAndAnnounce: vi.fn().mockResolvedValue(undefined),
		maybeWaitForProviderRateLimit: vi.fn().mockResolvedValue(undefined),
		attemptApiRequest: vi.fn(),
		presentAssistantMessage: vi.fn().mockResolvedValue(undefined),
		getTaskMode: vi.fn().mockReturnValue("code"),

		...overrides,
	}

	// Ensure hostRef.deref().getState() returns the correct autoApprovalEnabled
	// unless the caller provided their own hostRef override
	if (!overrides.hostRef) {
		host.hostRef = {
			deref: vi.fn().mockReturnValue({
				getState: vi.fn().mockResolvedValue(hostState),
				log: vi.fn(),
			}),
		}
	}

	return host
}

function createMockRetryApiRequest(chunks: ApiStreamChunk[] = []) {
	return vi.fn(async function* (): AsyncGenerator<ApiStreamChunk> {
		for (const chunk of chunks) {
			yield chunk
		}
	})
}

async function collectGenerator(gen: AsyncGenerator<ApiStreamChunk>): Promise<ApiStreamChunk[]> {
	const results: ApiStreamChunk[] = []
	for await (const chunk of gen) {
		results.push(chunk)
	}
	return results
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("handleAttemptApiRequestError", () => {
	it("yields retry action when errorRecovery returns retry", async () => {
		const chunk: ApiStreamChunk = { type: "text", text: "response" }
		const retryApiRequest = createMockRetryApiRequest([chunk])
		const host = createMockHost()
		host.errorRecovery.handleApiError.mockResolvedValue({ action: "retry", nextAttempt: 3 })

		const gen = handleAttemptApiRequestError({
			host,
			error: new Error("rate limit"),
			retryAttempt: 2,
			autoApprovalEnabled: false,
			unattendedRetryEnabled: false,
			unattendedMaxRetryAttempts: 5,
			retryApiRequest,
		})

		const results = await collectGenerator(gen)

		expect(results).toEqual([chunk])
		expect(retryApiRequest).toHaveBeenCalledWith(3)
		expect(host.errorRecovery.handleApiError).toHaveBeenCalledWith(expect.any(Error), 2)
	})

	it("auto-retries when autoApproval is enabled and retries are under limit", async () => {
		const chunk: ApiStreamChunk = { type: "text", text: "auto-retry" }
		const retryApiRequest = createMockRetryApiRequest([chunk])
		const host = createMockHost()

		const gen = handleAttemptApiRequestError({
			host,
			error: new Error("server error"),
			retryAttempt: 1,
			autoApprovalEnabled: true,
			unattendedRetryEnabled: true,
			unattendedMaxRetryAttempts: 5,
			retryApiRequest,
		})

		const results = await collectGenerator(gen)

		expect(results).toEqual([chunk])
		expect(host.stateMachine.force).toHaveBeenCalledWith(TaskState.RECOVERING_MAX_TOKENS)
		expect(host.streamProcessor.backoffAndAnnounce).toHaveBeenCalledWith(1, expect.any(Error))
		expect(retryApiRequest).toHaveBeenCalledWith(2)
	})

	it("enters persistent retry when over limit and error is eligible", async () => {
		const chunk: ApiStreamChunk = { type: "text", text: "persistent" }
		const retryApiRequest = createMockRetryApiRequest([chunk])
		const host = createMockHost()
		host.persistentRetryHandler.isEligible.mockReturnValue(true)
		mockClassifyApiError.mockReturnValue("rate_limit" as any)

		const gen = handleAttemptApiRequestError({
			host,
			error: new Error("rate limit"),
			retryAttempt: 5,
			autoApprovalEnabled: true,
			unattendedRetryEnabled: true,
			unattendedMaxRetryAttempts: 5,
			retryApiRequest,
		})

		const results = await collectGenerator(gen)

		expect(results).toEqual([chunk])
		expect(mockClassifyApiError).toHaveBeenCalled()
		expect(host.persistentRetryHandler.isEligible).toHaveBeenCalledWith("rate_limit")
		expect(host.persistentRetryHandler.waitForRetry).toHaveBeenCalled()
		expect(retryApiRequest).toHaveBeenCalledWith(6)
	})

	it("throws TaskRetryExhaustedError when over limit and not eligible for persistent retry", async () => {
		const retryApiRequest = createMockRetryApiRequest()
		const host = createMockHost()
		host.persistentRetryHandler.isEligible.mockReturnValue(false)
		mockClassifyApiError.mockReturnValue("authentication" as any)

		const gen = handleAttemptApiRequestError({
			host,
			error: new Error("auth error"),
			retryAttempt: 5,
			autoApprovalEnabled: true,
			unattendedRetryEnabled: true,
			unattendedMaxRetryAttempts: 5,
			retryApiRequest,
		})

		await expect(collectGenerator(gen)).rejects.toThrow(TaskRetryExhaustedError)
		expect(host.persistentRetryHandler.isEligible).toHaveBeenCalledWith("authentication")
	})

	it("throws TaskAbortedError when abort flag is set", async () => {
		const retryApiRequest = createMockRetryApiRequest()
		const host = createMockHost({ abort: true })

		const gen = handleAttemptApiRequestError({
			host,
			error: new Error("any"),
			retryAttempt: 0,
			autoApprovalEnabled: false,
			unattendedRetryEnabled: false,
			unattendedMaxRetryAttempts: 5,
			retryApiRequest,
		})

		await expect(collectGenerator(gen)).rejects.toThrow(TaskAbortedError)
		expect(host.stateMachine.force).toHaveBeenCalledWith(TaskState.ERROR)
	})

	it("asks user when no autoApproval and continues on retry click", async () => {
		const chunk: ApiStreamChunk = { type: "text", text: "user-retry" }
		const retryApiRequest = createMockRetryApiRequest([chunk])
		const host = createMockHost()
		host.ask.mockResolvedValue({ response: "yesButtonClicked" })

		const gen = handleAttemptApiRequestError({
			host,
			error: new Error("api fail"),
			retryAttempt: 0,
			autoApprovalEnabled: false,
			unattendedRetryEnabled: false,
			unattendedMaxRetryAttempts: 5,
			retryApiRequest,
		})

		const results = await collectGenerator(gen)

		expect(results).toEqual([chunk])
		expect(host.stateMachine.force).toHaveBeenCalledWith(TaskState.ERROR)
		expect(host.ask).toHaveBeenCalledWith("api_req_failed", expect.any(String))
		expect(host.say).toHaveBeenCalledWith("api_req_retried")
		expect(retryApiRequest).toHaveBeenCalled()
	})

	it("throws generic error when no autoApproval and user declines", async () => {
		const retryApiRequest = createMockRetryApiRequest()
		const host = createMockHost()
		host.ask.mockResolvedValue({ response: "noButtonClicked" })

		const gen = handleAttemptApiRequestError({
			host,
			error: new Error("api fail"),
			retryAttempt: 0,
			autoApprovalEnabled: false,
			unattendedRetryEnabled: false,
			unattendedMaxRetryAttempts: 5,
			retryApiRequest,
		})

		await expect(collectGenerator(gen)).rejects.toThrow("API request failed")
	})

	it("throws TaskAbortedError when abort happens during backoff", async () => {
		const retryApiRequest = createMockRetryApiRequest()
		const host = createMockHost()
		host.streamProcessor.backoffAndAnnounce.mockImplementation(async () => {
			host.abort = true
		})

		const gen = handleAttemptApiRequestError({
			host,
			error: new Error("server error"),
			retryAttempt: 1,
			autoApprovalEnabled: true,
			unattendedRetryEnabled: false,
			unattendedMaxRetryAttempts: 5,
			retryApiRequest,
		})

		await expect(collectGenerator(gen)).rejects.toThrow(TaskAbortedError)
	})

	it("resets isWaitingForFirstChunk and currentRequestAbortController on entry", async () => {
		const retryApiRequest = createMockRetryApiRequest()
		const controller = new AbortController()
		const host = createMockHost({ isWaitingForFirstChunk: true, currentRequestAbortController: controller })
		host.errorRecovery.handleApiError.mockResolvedValue({ action: "retry", nextAttempt: 1 })

		const gen = handleAttemptApiRequestError({
			host,
			error: new Error("test"),
			retryAttempt: 0,
			autoApprovalEnabled: false,
			unattendedRetryEnabled: false,
			unattendedMaxRetryAttempts: 5,
			retryApiRequest,
		})

		await collectGenerator(gen)

		expect(host.isWaitingForFirstChunk).toBe(false)
		expect(host.currentRequestAbortController).toBeUndefined()
	})
})

describe("handleMidStreamFailure", () => {
	const defaultError = new Error("stream crashed")
	const defaultContent = [{ type: "text" as const, text: "hello" }]
	const defaultStack = [{ userContent: defaultContent, includeFileDetails: true }]

	it("returns handled when task is abandoned", async () => {
		const task = createMockHost({ abandoned: true })
		const abortStream = vi.fn().mockResolvedValue(undefined)

		const result = await handleMidStreamFailure({
			task,
			error: defaultError,
			currentRetryAttempt: 0,
			currentUserContent: defaultContent,
			stack: [...defaultStack],
			abortStream,
		})

		expect(result).toBe("handled")
		expect(abortStream).not.toHaveBeenCalled()
	})

	it("returns break when user cancels (abort flag set)", async () => {
		const task = createMockHost({ abort: true })
		const abortStream = vi.fn().mockResolvedValue(undefined)

		const result = await handleMidStreamFailure({
			task,
			error: defaultError,
			currentRetryAttempt: 0,
			currentUserContent: defaultContent,
			stack: [...defaultStack],
			abortStream,
		})

		expect(result).toBe("break")
		expect(abortStream).toHaveBeenCalledWith("user_cancelled", undefined)
		expect(task.abortReason).toBe("user_cancelled")
		expect(task.abortTask).toHaveBeenCalled()
	})

	it("continues with backoff when auto approval is enabled", async () => {
		const task = createMockHost({ autoApprovalEnabled: true })
		const abortStream = vi.fn().mockResolvedValue(undefined)
		const stack = [...defaultStack]

		const result = await handleMidStreamFailure({
			task,
			error: defaultError,
			currentRetryAttempt: 2,
			currentUserContent: defaultContent,
			stack,
			abortStream,
		})

		expect(result).toBe("continue")
		expect(abortStream).toHaveBeenCalledWith("streaming_failed", undefined)
		expect(task.backoffAndAnnounce).toHaveBeenCalledWith(2, defaultError)
		expect(stack).toHaveLength(2)
		expect(stack[1]).toEqual({
			userContent: defaultContent,
			includeFileDetails: false,
			retryAttempt: 3,
		})
	})

	it("returns break when aborted during backoff with auto approval", async () => {
		const task = createMockHost({ autoApprovalEnabled: true })
		task.backoffAndAnnounce.mockImplementation(async () => {
			task.abort = true
		})
		const abortStream = vi.fn().mockResolvedValue(undefined)
		const stack = [...defaultStack]

		const result = await handleMidStreamFailure({
			task,
			error: defaultError,
			currentRetryAttempt: 1,
			currentUserContent: defaultContent,
			stack,
			abortStream,
		})

		expect(result).toBe("break")
		expect(task.abortReason).toBe("user_cancelled")
		expect(task.abortTask).toHaveBeenCalled()
	})

	it("continues without backoff when auto approval is disabled", async () => {
		const task = createMockHost({ autoApprovalEnabled: false })
		const abortStream = vi.fn().mockResolvedValue(undefined)
		const stack = [...defaultStack]

		const result = await handleMidStreamFailure({
			task,
			error: defaultError,
			currentRetryAttempt: 0,
			currentUserContent: defaultContent,
			stack,
			abortStream,
			streamingFailedMessage: "connection lost",
		})

		expect(result).toBe("continue")
		expect(abortStream).toHaveBeenCalledWith("streaming_failed", "connection lost")
		expect(task.backoffAndAnnounce).not.toHaveBeenCalled()
		expect(stack).toHaveLength(2)
		expect(stack[1]).toEqual({
			userContent: defaultContent,
			includeFileDetails: false,
			retryAttempt: 1,
		})
	})
})

describe("handleEmptyAssistantResponse", () => {
	const defaultContent = [{ type: "text" as const, text: "user message" }]
	const defaultStack = [{ userContent: defaultContent, includeFileDetails: true }]

	it("auto-retries with continue when autoApproval is enabled", async () => {
		const task = createMockHost({ autoApprovalEnabled: true })
		const stack = [...defaultStack]

		const result = await handleEmptyAssistantResponse({
			task,
			currentRetryAttempt: 0,
			currentUserContent: defaultContent,
			stack,
		})

		expect(result).toBe("continue")
		expect(task.backoffAndAnnounce).toHaveBeenCalledWith(0, expect.any(Error))
		expect(stack).toHaveLength(2)
		expect(stack[1]).toEqual({
			userContent: defaultContent,
			includeFileDetails: false,
			retryAttempt: 1,
			userMessageWasRemoved: true,
		})
		expect(task.consecutiveNoAssistantMessagesCount).toBe(1)
	})

	it("warns when consecutive empty responses reach 2", async () => {
		const task = createMockHost({
			autoApprovalEnabled: true,
			consecutiveNoAssistantMessagesCount: 1,
		})
		const stack = [...defaultStack]

		const result = await handleEmptyAssistantResponse({
			task,
			currentRetryAttempt: 1,
			currentUserContent: defaultContent,
			stack,
		})

		expect(result).toBe("continue")
		expect(task.consecutiveNoAssistantMessagesCount).toBe(2)
		expect(task.say).toHaveBeenCalledWith("error", "MODEL_NO_ASSISTANT_MESSAGES")
	})

	it("continues when no autoApproval and user clicks retry", async () => {
		const task = createMockHost()
		task.ask.mockResolvedValue({ response: "yesButtonClicked" })
		const stack = [...defaultStack]

		const result = await handleEmptyAssistantResponse({
			task,
			currentRetryAttempt: 0,
			currentUserContent: defaultContent,
			stack,
		})

		expect(result).toBe("continue")
		expect(task.ask).toHaveBeenCalledWith("api_req_failed", expect.any(String))
		expect(task.say).toHaveBeenCalledWith("api_req_retried")
		expect(stack).toHaveLength(2)
		expect(stack[1]).toEqual({
			userContent: defaultContent,
			includeFileDetails: false,
			retryAttempt: 1,
		})
	})

	it("returns done when no autoApproval and user declines", async () => {
		const task = createMockHost()
		task.ask.mockResolvedValue({ response: "noButtonClicked" })
		const stack = [...defaultStack]

		const result = await handleEmptyAssistantResponse({
			task,
			currentRetryAttempt: 0,
			currentUserContent: defaultContent,
			stack,
		})

		expect(result).toBe("done")
		expect(task.addToApiConversationHistory).toHaveBeenCalledTimes(2)
		expect(task.addToApiConversationHistory).toHaveBeenCalledWith({
			role: "user",
			content: defaultContent,
		})
		expect(task.addToApiConversationHistory).toHaveBeenCalledWith({
			role: "assistant",
			content: [{ type: "text", text: "Failure: I did not provide a response." }],
		})
		expect(task.say).toHaveBeenCalledWith(
			"error",
			"Unexpected API Response: The language model did not provide any assistant messages. This may indicate an issue with the API or the model's output.",
		)
	})

	it("pops last user message from apiConversationHistory", async () => {
		const task = createMockHost({
			autoApprovalEnabled: true,
			apiConversationHistory: [
				{ role: "assistant", content: "hi" },
				{ role: "user", content: "hello" },
			],
		})
		const stack = [...defaultStack]

		await handleEmptyAssistantResponse({
			task,
			currentRetryAttempt: 0,
			currentUserContent: defaultContent,
			stack,
		})

		expect(task.apiConversationHistory).toHaveLength(1)
		expect(task.apiConversationHistory[0].role).toBe("assistant")
	})

	it("returns break when aborted during backoff with autoApproval", async () => {
		const task = createMockHost({ autoApprovalEnabled: true })
		task.backoffAndAnnounce.mockImplementation(async () => {
			task.abort = true
		})
		const stack = [...defaultStack]

		const result = await handleEmptyAssistantResponse({
			task,
			currentRetryAttempt: 0,
			currentUserContent: defaultContent,
			stack,
		})

		expect(result).toBe("break")
		expect(stack).toHaveLength(1) // nothing pushed since we aborted
	})
})
