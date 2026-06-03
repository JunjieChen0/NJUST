import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Module mocks (must be before any runtime imports) ────────────────────

vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(() => ({
			onDidCreate: vi.fn(),
			onDidChange: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		})),
	},
	RelativePattern: vi.fn(),
}))

vi.mock("../../../shared/logger", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

vi.mock("../../../i18n", () => ({
	t: vi.fn((key: string) => key),
}))

vi.mock("../../../services/rate-limiter/TokenBucketRateLimiter", () => ({
	TokenBucketRateLimiter: {
		getInstance: () => ({
			wait: vi.fn().mockResolvedValue(0),
		}),
	},
}))

vi.mock("../../../utils/debugLog", () => ({
	debugLog: vi.fn(),
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: {
		reportError: vi.fn(),
		captureException: vi.fn(),
	},
	TelemetryEventName: {
		TASK_LIFECYCLE_ERROR: "task_lifecycle_error",
	},
}))

import { logger } from "../../../shared/logger"
import { TaskExecutor } from "../TaskExecutor"
import { TaskAbortedError } from "../TaskErrors"

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Create a minimal TaskExecutorHost mock.
 * Only the properties actually exercised by the test need real values;
 * everything else is a safe stub.
 */
function createHost(overrides: Record<string, any> = {}): any {
	const defaults: Record<string, any> = {
		abort: false,
		abandoned: false,
		taskId: "test-task",
		instanceId: "test-instance",
		globalStoragePath: "/tmp",
		cwd: "/workspace",
		taskCompleted: false,
		isPaused: false,
		isStreaming: false,
		isWaitingForFirstChunk: false,
		parentTask: undefined,
		getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 0 }),
		api: {
			getModel: vi.fn().mockReturnValue({ id: "test-model", info: { contextWindow: 200_000 } }),
			countTokens: vi.fn().mockResolvedValue(0),
			createMessage: vi.fn(),
		},
		stateMachine: {
			state: "IDLE",
			force: vi.fn(),
		},
		hostRef: new WeakRef({} as any),
		requestBuilder: {
			prefetchSystemPromptData: vi.fn(),
			getSystemPromptParts: vi.fn().mockResolvedValue({
				fullPrompt: "",
				staticPart: "",
				dynamicPart: "",
				perToolHashes: [],
			}),
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
			handleApiError: vi.fn().mockResolvedValue({ action: "retry", nextAttempt: 1 }),
			shouldBypassCondense: vi.fn().mockReturnValue(false),
			recordCompactFailure: vi.fn().mockResolvedValue(undefined),
			resetCompactFailure: vi.fn(),
		},
		autoApprovalHandler: {
			checkAutoApprovalLimits: vi.fn().mockResolvedValue({ shouldProceed: true }),
		},
		tokenGrowthTracker: {
			addSample: vi.fn(),
			getSnapshot: vi.fn().mockReturnValue(undefined),
		},
		persistentRetryHandler: undefined,
		toolExecution: {
			dispose: vi.fn(),
			streamingExecutor: { shouldEagerExecute: vi.fn().mockReturnValue(null) },
		},
		rooIgnoreController: undefined,
		compactFailureCount: 0,
		apiConfiguration: {},
		apiConversationHistory: [],
		clineMessages: [],
		assistantMessageContent: [],
		userMessageContent: [],
		userMessageContentReady: false,
		currentStreamingContentIndex: 0,
		didCompleteReadingStream: false,
		assistantMessageSavedToHistory: false,
		requestCacheReadWindow: [],
		requestInputTokensWindow: [],
		cachedToolDefinitions: undefined,
		currentRequestAbortController: undefined,
		skipPrevResponseIdOnce: false,
		consecutiveMistakeCount: 0,
		consecutiveMistakeLimit: 10,
		didEditFile: false,
		_rateLimitAlreadyWaitedForThisRequest: false,
		didRejectTool: false,
		didAlreadyUseTool: false,
		didToolFailInCurrentTurn: false,
		presentAssistantMessageLocked: false,
		presentAssistantMessageHasPendingUpdates: false,
		consecutiveNoToolUseCount: 0,
		consecutiveNoAssistantMessagesCount: 0,
		streamingToolCallIndices: new Map(),
		cachedStreamingModel: undefined,
		notifier: undefined,
		didFinishAbortingStream: false,
		currentStreamingDidCheckpoint: false,
		_savedMessagesForCurrentRequest: false,
		diffViewProvider: {
			reset: vi.fn().mockResolvedValue(undefined),
		},
		fileContextTracker: {},
		setLastGlobalApiRequestTime: vi.fn(),
		getLastGlobalApiRequestTime: vi.fn().mockReturnValue(0),
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "" }),
		addToApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		pushToolResultToUserContent: vi.fn().mockReturnValue(true),
		cancelCurrentRequest: vi.fn(),
		combineMessages: vi.fn((msgs: any[]) => msgs),
		emit: vi.fn().mockReturnValue(true),
		saveClineMessages: vi.fn().mockResolvedValue(true),
		refreshWebviewState: vi.fn().mockResolvedValue(undefined),
		updateClineMessage: vi.fn().mockResolvedValue(undefined),
		abortTask: vi.fn().mockResolvedValue(undefined),
		backoffAndAnnounce: vi.fn().mockResolvedValue(undefined),
		maybeWaitForProviderRateLimit: vi.fn().mockResolvedValue(undefined),
		attemptApiRequest: vi.fn(),
		presentAssistantMessage: vi.fn().mockResolvedValue(undefined),
		getTaskMode: vi.fn().mockReturnValue("code"),
	}

	return { ...defaults, ...overrides }
}

// ════════════════════════════════════════════════════════════════════════

describe("TaskExecutor - stream processing & token budget", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	// ── placeFinalizedStreamingToolUse ──────────────────────────────────

	describe("placeFinalizedStreamingToolUse", () => {
		const place = (executor: TaskExecutor, taskHost: any, id: string, toolUse: any) =>
			(executor as any).placeFinalizedStreamingToolUse(taskHost, id, toolUse)

		it("overwrites content at tracked index when id already exists", () => {
			const existingItem = { type: "text", text: "placeholder" }
			const taskHost = {
				assistantMessageContent: [existingItem, { type: "text", text: "keep" }],
				streamingToolCallIndices: new Map([["call_1", 0]]),
				userMessageContentReady: true,
			}
			const finalToolUse = { type: "tool_use", name: "read_file", params: {}, partial: false }

			const executor = new TaskExecutor(createHost())
			const result = place(executor, taskHost, "call_1", finalToolUse)

			// Replaces at index 0, index 1 untouched
			expect(taskHost.assistantMessageContent[0]).toBe(finalToolUse)
			expect(taskHost.assistantMessageContent[0].id).toBe("call_1")
			expect(taskHost.assistantMessageContent[1]).toEqual({ type: "text", text: "keep" })
			expect(taskHost.assistantMessageContent).toHaveLength(2)
			expect(result).toBe(finalToolUse)
		})

		it("appends to end when index is not tracked", () => {
			const taskHost = {
				assistantMessageContent: [{ type: "text", text: "existing" }],
				streamingToolCallIndices: new Map(),
				userMessageContentReady: true,
			}
			const finalToolUse = { type: "tool_use", name: "write_file", params: {}, partial: false }

			const executor = new TaskExecutor(createHost())
			const result = place(executor, taskHost, "call_new", finalToolUse)

			expect(taskHost.assistantMessageContent).toHaveLength(2)
			expect(taskHost.assistantMessageContent[1]).toBe(finalToolUse)
			expect(taskHost.assistantMessageContent[1].id).toBe("call_new")
			expect(result).toBe(finalToolUse)
		})

		it("always resets userMessageContentReady to false", () => {
			const taskHost = {
				assistantMessageContent: [],
				streamingToolCallIndices: new Map(),
				userMessageContentReady: true,
			}

			const executor = new TaskExecutor(createHost())
			place(executor, taskHost, "x", { type: "tool_use" })

			expect(taskHost.userMessageContentReady).toBe(false)
		})

		it("resets userMessageContentReady even when overwriting", () => {
			const taskHost = {
				assistantMessageContent: [null],
				streamingToolCallIndices: new Map([["id", 0]]),
				userMessageContentReady: true,
			}

			const executor = new TaskExecutor(createHost())
			place(executor, taskHost, "id", { type: "tool_use" })

			expect(taskHost.userMessageContentReady).toBe(false)
		})

		it("deletes the tracked index from the map after placement (existing)", () => {
			const taskHost = {
				assistantMessageContent: [null, null],
				streamingToolCallIndices: new Map([
					["call_a", 0],
					["call_b", 1],
				]),
				userMessageContentReady: false,
			}

			const executor = new TaskExecutor(createHost())
			place(executor, taskHost, "call_a", { type: "tool_use", name: "a" })

			expect(taskHost.streamingToolCallIndices.has("call_a")).toBe(false)
			expect(taskHost.streamingToolCallIndices.has("call_b")).toBe(true)
			expect(taskHost.streamingToolCallIndices.size).toBe(1)
		})

		it("ensures id is absent from map after placement (new entry)", () => {
			const taskHost = {
				assistantMessageContent: [],
				streamingToolCallIndices: new Map(),
				userMessageContentReady: false,
			}

			const executor = new TaskExecutor(createHost())
			place(executor, taskHost, "new_call", { type: "tool_use" })

			expect(taskHost.streamingToolCallIndices.has("new_call")).toBe(false)
		})

		it("assigns the given id to the tool use object", () => {
			const taskHost = {
				assistantMessageContent: [],
				streamingToolCallIndices: new Map(),
				userMessageContentReady: false,
			}
			const toolUse = { type: "tool_use", name: "exec", params: {} }

			const executor = new TaskExecutor(createHost())
			place(executor, taskHost, "my-id-123", toolUse)

			expect(toolUse.id).toBe("my-id-123")
		})

		it("handles multiple sequential placements with different ids", () => {
			const taskHost = {
				assistantMessageContent: [] as any[],
				streamingToolCallIndices: new Map<string, number>(),
				userMessageContentReady: false,
			}

			const executor = new TaskExecutor(createHost())

			// First: append new
			place(executor, taskHost, "c1", { type: "tool_use", name: "a" })
			expect(taskHost.assistantMessageContent).toHaveLength(1)

			// Second: append new (different id, no tracking)
			place(executor, taskHost, "c2", { type: "tool_use", name: "b" })
			expect(taskHost.assistantMessageContent).toHaveLength(2)

			// Third: simulate tracking for c3 at index 0, overwrite
			taskHost.streamingToolCallIndices.set("c3", 0)
			place(executor, taskHost, "c3", { type: "tool_use", name: "c" })
			expect(taskHost.assistantMessageContent).toHaveLength(2) // no growth
			expect(taskHost.assistantMessageContent[0].name).toBe("c")
			expect(taskHost.assistantMessageContent[1].name).toBe("b")
		})

		it("preserves correct content when overwriting at a middle index", () => {
			const taskHost = {
				assistantMessageContent: [
					{ type: "text", text: "first" },
					{ type: "text", text: "middle" },
					{ type: "text", text: "last" },
				],
				streamingToolCallIndices: new Map([["mid", 1]]),
				userMessageContentReady: false,
			}

			const executor = new TaskExecutor(createHost())
			place(executor, taskHost, "mid", { type: "tool_use", name: "replaced" })

			expect(taskHost.assistantMessageContent[0]).toEqual({ type: "text", text: "first" })
			expect(taskHost.assistantMessageContent[1].name).toBe("replaced")
			expect(taskHost.assistantMessageContent[2]).toEqual({ type: "text", text: "last" })
		})

		it("handles McpToolUse objects the same way as ToolUse", () => {
			const taskHost = {
				assistantMessageContent: [],
				streamingToolCallIndices: new Map(),
				userMessageContentReady: false,
			}
			const mcpToolUse = { type: "mcp_tool_use", name: "mcp_search", params: { query: "test" } }

			const executor = new TaskExecutor(createHost())
			const result = place(executor, taskHost, "mcp_call", mcpToolUse)

			expect(result).toBe(mcpToolUse)
			expect(result.id).toBe("mcp_call")
			expect(taskHost.assistantMessageContent[0]).toBe(mcpToolUse)
		})
	})

	// ── checkSubtaskTokenBudget ─────────────────────────────────────────

	describe("checkSubtaskTokenBudget", () => {
		const runCheck = (executor: TaskExecutor) => (executor as any).checkSubtaskTokenBudget()

		it("returns silently when parentTask is undefined", () => {
			const executor = new TaskExecutor(
				createHost({
					parentTask: undefined,
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 500 }),
					api: { getModel: vi.fn().mockReturnValue({ info: { contextWindow: 2000 } }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("warns when subtask tokens exceed 80% of parent remaining budget", () => {
			// contextWindow=2000, parentUsed=1500, remaining=500, 80%=400, subtask=450 > 400
			const executor = new TaskExecutor(
				createHost({
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 1500 }) },
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 450 }),
					api: { getModel: vi.fn().mockReturnValue({ info: { contextWindow: 2000 } }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).toHaveBeenCalledWith(
				"TaskExecutor",
				expect.stringContaining("approaching parent's remaining budget"),
			)
		})

		it("does NOT warn when subtask tokens are exactly at 80% threshold (not strict-greater)", () => {
			// contextWindow=2000, parentUsed=1500, remaining=500, 80%=400, subtask=400 == 400 (not >)
			const executor = new TaskExecutor(
				createHost({
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 1500 }) },
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 400 }),
					api: { getModel: vi.fn().mockReturnValue({ info: { contextWindow: 2000 } }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("does NOT warn when subtask tokens are safely below threshold", () => {
			// contextWindow=2000, parentUsed=1000, remaining=1000, 80%=800, subtask=500 < 800
			const executor = new TaskExecutor(
				createHost({
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 1000 }) },
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 500 }),
					api: { getModel: vi.fn().mockReturnValue({ info: { contextWindow: 2000 } }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("does NOT warn when parentRemaining <= 0 (parent already exhausted)", () => {
			// contextWindow=2000, parentUsed=2000, remaining=0 → skip (parentRemaining not > 0)
			const executor = new TaskExecutor(
				createHost({
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 2000 }) },
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 500 }),
					api: { getModel: vi.fn().mockReturnValue({ info: { contextWindow: 2000 } }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("does NOT warn when parentRemaining < 0 (parent exceeded its window)", () => {
			// contextWindow=2000, parentUsed=3000, remaining=-1000 → skip
			const executor = new TaskExecutor(
				createHost({
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 3000 }) },
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 500 }),
					api: { getModel: vi.fn().mockReturnValue({ info: { contextWindow: 2000 } }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("uses default contextWindow of 200_000 when model.info has no contextWindow", () => {
			// default window=200_000, parentUsed=199_000, remaining=1000, 80%=800, subtask=700 < 800 → no warn
			const executor = new TaskExecutor(
				createHost({
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 199_000 }) },
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 700 }),
					api: { getModel: vi.fn().mockReturnValue({ info: {} }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("warns with default contextWindow when subtask is near the remaining budget", () => {
			// default window=200_000, parentUsed=199_000, remaining=1000, 80%=800, subtask=850 > 800 → warn
			const executor = new TaskExecutor(
				createHost({
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 199_000 }) },
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 850 }),
					api: { getModel: vi.fn().mockReturnValue({ info: {} }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).toHaveBeenCalledWith(
				"TaskExecutor",
				expect.stringContaining("approaching parent's remaining budget"),
			)
		})

		it("treats undefined contextTokens as zero", () => {
			// contextWindow=2000, parentUsed=undefined→0, remaining=2000, 80%=1600, subtask=undefined→0 < 1600
			const executor = new TaskExecutor(
				createHost({
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({}) },
					getTokenUsage: vi.fn().mockReturnValue({}),
					api: { getModel: vi.fn().mockReturnValue({ info: { contextWindow: 2000 } }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("warns just one token above the 80% threshold", () => {
			// contextWindow=1000, parentUsed=500, remaining=500, 80%=400, subtask=401 > 400 → warn
			const executor = new TaskExecutor(
				createHost({
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 500 }) },
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 401 }),
					api: { getModel: vi.fn().mockReturnValue({ info: { contextWindow: 1000 } }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).toHaveBeenCalled()
		})

		it("does not warn one token at the threshold boundary", () => {
			// contextWindow=1000, parentUsed=500, remaining=500, 80%=400, subtask=400 == 400 → no warn
			const executor = new TaskExecutor(
				createHost({
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 500 }) },
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 400 }),
					api: { getModel: vi.fn().mockReturnValue({ info: { contextWindow: 1000 } }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).not.toHaveBeenCalled()
		})

		it("includes task id in the warning message", () => {
			const executor = new TaskExecutor(
				createHost({
					taskId: "my-specific-task",
					parentTask: { getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 1500 }) },
					getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 450 }),
					api: { getModel: vi.fn().mockReturnValue({ info: { contextWindow: 2000 } }) },
				}),
			)

			runCheck(executor)

			expect(logger.warn).toHaveBeenCalledWith("TaskExecutor", expect.stringContaining("my-specific-task"))
		})
	})

	// ── attemptApiRequest — abort path ──────────────────────────────────

	describe("attemptApiRequest - abort path", () => {
		it("throws TaskAbortedError when host.abort is true", async () => {
			const mockHost = createHost({ abort: true })
			const executor = new TaskExecutor(mockHost)

			const stream = executor.attemptApiRequest(0)

			await expect(stream.next()).rejects.toThrow(TaskAbortedError)
		})

		it("TaskAbortedError carries the correct taskId", async () => {
			const mockHost = createHost({ abort: true, taskId: "task-42" })
			const executor = new TaskExecutor(mockHost)

			const stream = executor.attemptApiRequest(0)

			try {
				await stream.next()
				expect.unreachable("should have thrown")
			} catch (e: any) {
				expect(e).toBeInstanceOf(TaskAbortedError)
				expect(e.taskId).toBe("task-42")
			}
		})

		it("transitions to PREPARING before checking abort flag", async () => {
			const forceFn = vi.fn()
			const mockHost = createHost({
				abort: true,
				stateMachine: { state: "IDLE", force: forceFn },
			})
			const executor = new TaskExecutor(mockHost)

			const stream = executor.attemptApiRequest(0)
			await expect(stream.next()).rejects.toThrow(TaskAbortedError)

			// force(PREPARING) should have been called
			expect(forceFn).toHaveBeenCalledWith("PREPARING")
		})

		it("transitions STREAMING → COMPLETED before PREPARING when in STREAMING state", async () => {
			const forceFn = vi.fn()
			const mockHost = createHost({
				abort: true,
				stateMachine: { state: "STREAMING", force: forceFn },
			})
			const executor = new TaskExecutor(mockHost)

			const stream = executor.attemptApiRequest(0)
			await expect(stream.next()).rejects.toThrow(TaskAbortedError)

			// First call: COMPLETED (from STREAMING guard)
			expect(forceFn).toHaveBeenNthCalledWith(1, "COMPLETED")
			// Second call: PREPARING
			expect(forceFn).toHaveBeenNthCalledWith(2, "PREPARING")
		})

		it("does NOT transition to COMPLETED when starting from non-STREAMING state", async () => {
			const forceFn = vi.fn()
			const mockHost = createHost({
				abort: true,
				stateMachine: { state: "IDLE", force: forceFn },
			})
			const executor = new TaskExecutor(mockHost)

			const stream = executor.attemptApiRequest(0)
			await expect(stream.next()).rejects.toThrow(TaskAbortedError)

			// Only PREPARING should be called, not COMPLETED
			expect(forceFn).toHaveBeenCalledTimes(1)
			expect(forceFn).toHaveBeenCalledWith("PREPARING")
		})

		it("still calls checkSubtaskTokenBudget when parentTask exists (even if abort=true)", async () => {
			const parentGetTokenUsage = vi.fn().mockReturnValue({ contextTokens: 1500 })
			const selfGetTokenUsage = vi.fn().mockReturnValue({ contextTokens: 450 })
			const getModel = vi.fn().mockReturnValue({ info: { contextWindow: 2000 } })

			const mockHost = createHost({
				abort: true,
				parentTask: { getTokenUsage: parentGetTokenUsage },
				getTokenUsage: selfGetTokenUsage,
				api: { getModel, countTokens: vi.fn().mockResolvedValue(0) },
			})
			const executor = new TaskExecutor(mockHost)

			const stream = executor.attemptApiRequest(0)
			await expect(stream.next()).rejects.toThrow(TaskAbortedError)

			// checkSubtaskTokenBudget was called before the abort check
			expect(parentGetTokenUsage).toHaveBeenCalled()
			expect(selfGetTokenUsage).toHaveBeenCalled()
			expect(getModel).toHaveBeenCalled()
			// And it should have warned (450 > 500*0.8=400)
			expect(logger.warn).toHaveBeenCalledWith(
				"TaskExecutor",
				expect.stringContaining("approaching parent's remaining budget"),
			)
		})

		it("propagates the retryAttempt parameter", async () => {
			const forceFn = vi.fn()
			const mockHost = createHost({
				abort: true,
				stateMachine: { state: "IDLE", force: forceFn },
			})
			const executor = new TaskExecutor(mockHost)

			// Even with a non-zero retry attempt, the abort path is the same
			const stream = executor.attemptApiRequest(3)
			await expect(stream.next()).rejects.toThrow(TaskAbortedError)
			expect(forceFn).toHaveBeenCalledWith("PREPARING")
		})

		it("handles PROCESSING_TOOLS state (non-STREAMING) without COMPLETED transition", async () => {
			const forceFn = vi.fn()
			const mockHost = createHost({
				abort: true,
				stateMachine: { state: "PROCESSING_TOOLS", force: forceFn },
			})
			const executor = new TaskExecutor(mockHost)

			const stream = executor.attemptApiRequest(0)
			await expect(stream.next()).rejects.toThrow(TaskAbortedError)

			// Should only force PREPARING, not COMPLETED
			expect(forceFn).toHaveBeenCalledWith("PREPARING")
			expect(forceFn).not.toHaveBeenCalledWith("COMPLETED")
		})

		it("handles COMPLETED state without redundant COMPLETED transition", async () => {
			const forceFn = vi.fn()
			const mockHost = createHost({
				abort: true,
				stateMachine: { state: "COMPLETED", force: forceFn },
			})
			const executor = new TaskExecutor(mockHost)

			const stream = executor.attemptApiRequest(0)
			await expect(stream.next()).rejects.toThrow(TaskAbortedError)

			// COMPLETED guard: state !== "STREAMING" so no force(COMPLETED)
			expect(forceFn).toHaveBeenCalledTimes(1)
			expect(forceFn).toHaveBeenCalledWith("PREPARING")
		})
	})

	// ── attemptApiRequest — state machine integration ────────────────────

	describe("attemptApiRequest - state transitions", () => {
		it("uses the real TaskStateMachine for COMPLETED→PREPARING flow", async () => {
			// Import the real state machine for an integration-style test
			const { TaskStateMachine, TaskState } = await import("../TaskStateMachine")
			const sm = new TaskStateMachine()

			// Put it in STREAMING state
			sm.force(TaskState.STREAMING)
			expect(sm.state).toBe(TaskState.STREAMING)

			const mockHost = createHost({
				abort: true,
				stateMachine: sm,
			})
			const executor = new TaskExecutor(mockHost)

			const stream = executor.attemptApiRequest(0)
			await expect(stream.next()).rejects.toThrow(TaskAbortedError)

			// Real state machine: STREAMING → COMPLETED → PREPARING
			expect(sm.state).toBe(TaskState.PREPARING)
			// previousState is COMPLETED (the intermediate step before PREPARING)
			expect(sm.previousState).toBe(TaskState.COMPLETED)
		})

		it("uses the real TaskStateMachine for IDLE→PREPARING flow", async () => {
			const { TaskStateMachine, TaskState } = await import("../TaskStateMachine")
			const sm = new TaskStateMachine()

			expect(sm.state).toBe(TaskState.IDLE)

			const mockHost = createHost({
				abort: true,
				stateMachine: sm,
			})
			const executor = new TaskExecutor(mockHost)

			const stream = executor.attemptApiRequest(0)
			await expect(stream.next()).rejects.toThrow(TaskAbortedError)

			expect(sm.state).toBe(TaskState.PREPARING)
			expect(sm.previousState).toBe(TaskState.IDLE)
		})
	})

	// ── recursivelyMakeClineRequests — basic control flow ─────────────

	describe("recursivelyMakeClineRequests - basic control flow", () => {
		it("returns false immediately when taskCompleted is true", async () => {
			const mockHost = createHost({ taskCompleted: true })
			const executor = new TaskExecutor(mockHost)

			const result = await executor.recursivelyMakeClineRequests([{ type: "text", text: "hello" }], false)

			expect(result).toBe(false)
		})

		it("throws TaskAbortedError and sets ERROR state when abort is true", async () => {
			const forceFn = vi.fn()
			const mockHost = createHost({
				abort: true,
				stateMachine: { state: "IDLE", force: forceFn },
			})
			const executor = new TaskExecutor(mockHost)

			await expect(
				executor.recursivelyMakeClineRequests([{ type: "text", text: "hello" }], false),
			).rejects.toThrow(TaskAbortedError)

			expect(forceFn).toHaveBeenCalledWith("ERROR")
		})

		it("resets _savedMessagesForCurrentRequest to false before abort check", async () => {
			const mockHost = createHost({
				abort: true,
				stateMachine: { state: "IDLE", force: vi.fn() },
				_savedMessagesForCurrentRequest: true,
			})
			const executor = new TaskExecutor(mockHost)

			await expect(executor.recursivelyMakeClineRequests([{ type: "text", text: "hi" }], false)).rejects.toThrow()

			// The flag was set to false at line 521 before the abort check at line 523
			expect(mockHost._savedMessagesForCurrentRequest).toBe(false)
		})

		it("skips mistake limit block when count is below limit", async () => {
			const askFn = vi.fn()
			const forceFn = vi.fn()

			const mockHost = createHost({
				abort: true, // abort right after the mistake check to exit quickly
				taskCompleted: false,
				consecutiveMistakeCount: 0,
				consecutiveMistakeLimit: 5,
				ask: askFn,
				stateMachine: { state: "IDLE", force: forceFn },
			})
			const executor = new TaskExecutor(mockHost)

			await expect(
				executor.recursivelyMakeClineRequests([{ type: "text", text: "test" }], false),
			).rejects.toThrow(TaskAbortedError)

			// The ask should NOT have been called (mistake limit not reached)
			expect(askFn).not.toHaveBeenCalled()
		})

		it("skips mistake limit block when limit is 0 (disabled)", async () => {
			const askFn = vi.fn()

			const mockHost = createHost({
				abort: true,
				taskCompleted: false,
				consecutiveMistakeCount: 100,
				consecutiveMistakeLimit: 0, // disabled
				ask: askFn,
				stateMachine: { state: "IDLE", force: vi.fn() },
			})
			const executor = new TaskExecutor(mockHost)

			await expect(
				executor.recursivelyMakeClineRequests([{ type: "text", text: "test" }], false),
			).rejects.toThrow(TaskAbortedError)

			expect(askFn).not.toHaveBeenCalled()
		})
	})

	// ── attemptApiRequest — deeper paths ─────────────────────────────────

	describe("attemptApiRequest - deeper paths (beyond abort)", () => {
		it("proceeds past abort check when abort=false and hits provider lost error", async () => {
			// Set up a host that passes the abort check but has a lost provider reference
			const mockHost = createHost({
				abort: false,
				stateMachine: { state: "IDLE", force: vi.fn() },
				hostRef: {
					deref: vi.fn().mockReturnValue(undefined),
				},
				apiConversationHistory: [],
			})

			const executor = new TaskExecutor(mockHost)
			const stream = executor.attemptApiRequest(0)

			// The generator should reject because provider reference is lost
			// at line 366-368 after passing through state defaults, rate limiting,
			// system prompt, auto-approval, etc.
			await expect(stream.next()).rejects.toThrow("Provider reference lost")
		})

		it("initializes persistentRetryHandler when undefined", async () => {
			const mockHost = createHost({
				abort: false,
				stateMachine: { state: "IDLE", force: vi.fn() },
				persistentRetryHandler: undefined,
				hostRef: {
					deref: vi.fn().mockReturnValue(undefined),
				},
				apiConversationHistory: [],
			})

			const executor = new TaskExecutor(mockHost)
			const stream = executor.attemptApiRequest(0)

			// Will fail eventually but should initialize persistentRetryHandler first
			try {
				await stream.next()
			} catch {
				// Expected to fail
			}

			// persistentRetryHandler should have been assigned (line 137)
			expect(mockHost.persistentRetryHandler).toBeDefined()
		})

		it("calls setLastGlobalApiRequestTime during setup", async () => {
			const setTimeFn = vi.fn()
			const mockHost = createHost({
				abort: false,
				stateMachine: { state: "IDLE", force: vi.fn() },
				setLastGlobalApiRequestTime: setTimeFn,
				hostRef: {
					deref: vi.fn().mockReturnValue(undefined),
				},
				apiConversationHistory: [],
			})

			const executor = new TaskExecutor(mockHost)
			const stream = executor.attemptApiRequest(0)

			try {
				await stream.next()
			} catch {
				// Expected to fail eventually
			}

			expect(setTimeFn).toHaveBeenCalled()
		})

		it("calls requestBuilder.prefetchSystemPromptData during setup", async () => {
			const prefetchFn = vi.fn()
			const mockHost = createHost({
				abort: false,
				stateMachine: { state: "IDLE", force: vi.fn() },
				requestBuilder: {
					prefetchSystemPromptData: prefetchFn,
					getSystemPromptParts: vi.fn().mockResolvedValue({
						fullPrompt: "test prompt",
						staticPart: "static",
						dynamicPart: "dynamic",
						perToolHashes: [],
					}),
					getSystemPrompt: vi.fn().mockResolvedValue("test"),
					condenseContext: vi.fn().mockResolvedValue(undefined),
					inheritCacheFromParent: vi.fn(),
				},
				hostRef: {
					deref: vi.fn().mockReturnValue(undefined),
				},
				apiConversationHistory: [],
			})

			const executor = new TaskExecutor(mockHost)
			const stream = executor.attemptApiRequest(0)

			try {
				await stream.next()
			} catch {
				// Expected to fail
			}

			expect(prefetchFn).toHaveBeenCalled()
		})

		it("skips provider rate limit when skipProviderRateLimit option is true", async () => {
			const maybeWaitFn = vi.fn().mockResolvedValue(undefined)
			const mockHost = createHost({
				abort: false,
				stateMachine: { state: "IDLE", force: vi.fn() },
				streamProcessor: {
					maybeWaitForProviderRateLimit: maybeWaitFn,
					backoffAndAnnounce: vi.fn().mockResolvedValue(undefined),
					buildCleanConversationHistory: vi.fn().mockReturnValue([]),
					getCurrentProfileId: vi.fn().mockReturnValue("default"),
					handleContextWindowExceededError: vi.fn().mockResolvedValue(undefined),
					getFilesReadByRooSafely: vi.fn().mockResolvedValue(undefined),
				},
				hostRef: {
					deref: vi.fn().mockReturnValue(undefined),
				},
				apiConversationHistory: [],
			})

			const executor = new TaskExecutor(mockHost)
			const stream = executor.attemptApiRequest(0, { skipProviderRateLimit: true })

			try {
				await stream.next()
			} catch {
				// Expected to fail
			}

			// maybeWaitForProviderRateLimit should NOT have been called
			expect(maybeWaitFn).not.toHaveBeenCalled()
		})

		it("calls maybeWaitForProviderRateLimit when skipProviderRateLimit is false", async () => {
			const maybeWaitFn = vi.fn().mockResolvedValue(undefined)
			const mockHost = createHost({
				abort: false,
				stateMachine: { state: "IDLE", force: vi.fn() },
				streamProcessor: {
					maybeWaitForProviderRateLimit: maybeWaitFn,
					backoffAndAnnounce: vi.fn().mockResolvedValue(undefined),
					buildCleanConversationHistory: vi.fn().mockReturnValue([]),
					getCurrentProfileId: vi.fn().mockReturnValue("default"),
					handleContextWindowExceededError: vi.fn().mockResolvedValue(undefined),
					getFilesReadByRooSafely: vi.fn().mockResolvedValue(undefined),
				},
				hostRef: {
					deref: vi.fn().mockReturnValue(undefined),
				},
				apiConversationHistory: [],
				_rateLimitAlreadyWaitedForThisRequest: false,
			})

			const executor = new TaskExecutor(mockHost)
			const stream = executor.attemptApiRequest(2) // retryAttempt = 2

			try {
				await stream.next()
			} catch {
				// Expected to fail
			}

			expect(maybeWaitFn).toHaveBeenCalledWith(2)
		})
	})
})
