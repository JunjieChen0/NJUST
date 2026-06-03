import { describe, it, expect, vi, beforeEach } from "vitest"
import EventEmitter from "events"

// Use vi.hoisted so mock references are available inside hoisted vi.mock factories
const { mockCombineApiRequests, mockCombineCommandSequences } = vi.hoisted(() => ({
	mockCombineApiRequests: vi.fn((msgs: unknown) => msgs),
	mockCombineCommandSequences: vi.fn((msgs: unknown) => msgs),
}))

// Mock heavy dependencies before importing Task
vi.mock("../../../shared/logger", () => ({
	logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: {
		hasInstance: () => false,
		instance: { captureEvent: vi.fn() },
	},
}))

vi.mock("../../../shared/combineApiRequests", () => ({
	combineApiRequests: mockCombineApiRequests,
}))

vi.mock("../../../shared/combineCommandSequences", () => ({
	combineCommandSequences: mockCombineCommandSequences,
}))

// Import Task class after mocks are set up
import { Task } from "../Task"
import { TaskStatus } from "@njust-ai/types"
import { logger } from "../../../shared/logger"

/**
 * Factory: create a partial Task-like object with only the properties
 * needed by the methods under test, binding real prototype methods.
 */
function createPartialTask(overrides: Record<string, unknown> = {}) {
	const emitter = new EventEmitter()
	const task = {
		// Common state
		userMessageContent: [] as unknown[],
		toolUsage: {} as Record<string, { attempts: number; failures: number }>,
		toolExecution: {
			errors: {},
			recordToolErrorMetric: vi.fn(),
		},
		taskId: "test-task-1",
		autoApprovalTimeoutRef: undefined as ReturnType<typeof setTimeout> | undefined,
		// Background signal state (private fields, but accessible on plain object)
		_backgroundSignal: null as Promise<void> | null,
		_backgroundResolve: null as ((value: void) => void) | null,
		isBackgrounded: false,
		// TaskStatus fields
		interactiveAsk: undefined,
		resumableAsk: undefined,
		idleAsk: undefined,
		// EventEmitter methods
		emit: emitter.emit.bind(emitter),
		on: emitter.on.bind(emitter),
		off: emitter.off.bind(emitter),
		...overrides,
	}

	// Bind instance methods from Task prototype so `this` works correctly
	task.pushToolResultToUserContent = Task.prototype.pushToolResultToUserContent.bind(task)
	task.recordToolUsage = Task.prototype.recordToolUsage.bind(task)
	task.recordToolError = Task.prototype.recordToolError.bind(task)
	task.cancelAutoApprovalTimeout = Task.prototype.cancelAutoApprovalTimeout.bind(task)
	task.getBackgroundSignal = Task.prototype.getBackgroundSignal.bind(task)
	task.requestBackground = Task.prototype.requestBackground.bind(task)
	task.combineMessages = Task.prototype.combineMessages.bind(task)

	// Define the taskStatus getter to mirror the real Task getter logic
	Object.defineProperty(task, "taskStatus", {
		get() {
			if (this.interactiveAsk) return TaskStatus.Interactive
			if (this.resumableAsk) return TaskStatus.Resumable
			if (this.idleAsk) return TaskStatus.Idle
			return TaskStatus.Running
		},
		configurable: true,
	})

	return task
}

describe("Task simple/standalone methods", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset default mock behavior
		mockCombineApiRequests.mockImplementation((msgs) => msgs)
		mockCombineCommandSequences.mockImplementation((msgs) => msgs)
	})

	// -----------------------------------------------------------------------
	// 1. combineMessages
	// -----------------------------------------------------------------------
	describe("combineMessages", () => {
		it("calls combineCommandSequences then combineApiRequests in order", () => {
			const task = createPartialTask()
			const messages = [
				{ ts: 1, type: "say", say: "text" },
				{ ts: 2, type: "say", say: "command" },
			]

			task.combineMessages(messages as never[])

			expect(mockCombineCommandSequences).toHaveBeenCalledWith(messages)
			expect(mockCombineApiRequests).toHaveBeenCalled()
			// combineApiRequests receives the output of combineCommandSequences
			expect(mockCombineApiRequests.mock.invocationCallOrder[0]).toBeGreaterThan(
				mockCombineCommandSequences.mock.invocationCallOrder[0],
			)
		})

		it("returns empty array for empty input", () => {
			const task = createPartialTask()
			const result = task.combineMessages([])
			expect(result).toEqual([])
		})

		it("passes through combined messages from both helpers", () => {
			const combined = [{ ts: 1, type: "say", say: "combined" }]
			mockCombineCommandSequences.mockReturnValueOnce(combined as never)
			mockCombineApiRequests.mockReturnValueOnce(combined as never)

			const task = createPartialTask()
			const result = task.combineMessages([{ ts: 1, type: "say" }] as never[])

			expect(result).toBe(combined)
		})
	})

	// -----------------------------------------------------------------------
	// 2. taskStatus getter
	// -----------------------------------------------------------------------
	describe("taskStatus getter", () => {
		it("returns Running when no ask is set", () => {
			const task = createPartialTask()
			expect(task.taskStatus).toBe(TaskStatus.Running)
		})

		it("returns Interactive when interactiveAsk is set", () => {
			const task = createPartialTask({
				interactiveAsk: { ts: 1, type: "ask", ask: "followup" },
			})
			expect(task.taskStatus).toBe(TaskStatus.Interactive)
		})

		it("returns Resumable when resumableAsk is set", () => {
			const task = createPartialTask({
				resumableAsk: { ts: 1, type: "ask", ask: "resume" },
			})
			expect(task.taskStatus).toBe(TaskStatus.Resumable)
		})

		it("returns Idle when idleAsk is set", () => {
			const task = createPartialTask({
				idleAsk: { ts: 1, type: "ask", ask: "idle" },
			})
			expect(task.taskStatus).toBe(TaskStatus.Idle)
		})

		it("interactiveAsk takes precedence over other asks", () => {
			const task = createPartialTask({
				interactiveAsk: { ts: 1, type: "ask", ask: "followup" },
				resumableAsk: { ts: 2, type: "ask", ask: "resume" },
				idleAsk: { ts: 3, type: "ask", ask: "idle" },
			})
			expect(task.taskStatus).toBe(TaskStatus.Interactive)
		})

		it("resumableAsk takes precedence over idleAsk", () => {
			const task = createPartialTask({
				resumableAsk: { ts: 1, type: "ask", ask: "resume" },
				idleAsk: { ts: 2, type: "ask", ask: "idle" },
			})
			expect(task.taskStatus).toBe(TaskStatus.Resumable)
		})
	})

	// -----------------------------------------------------------------------
	// 3. pushToolResultToUserContent
	// -----------------------------------------------------------------------
	describe("pushToolResultToUserContent", () => {
		it("adds a tool_result block to userMessageContent", () => {
			const task = createPartialTask()
			const toolResult = {
				type: "tool_result" as const,
				tool_use_id: "tu_1",
				content: "result",
			}

			const added = task.pushToolResultToUserContent(toolResult)

			expect(added).toBe(true)
			expect(task.userMessageContent).toHaveLength(1)
			expect(task.userMessageContent[0]).toBe(toolResult)
		})

		it("rejects duplicate tool_use_id and returns false", () => {
			const task = createPartialTask()
			const toolResult = {
				type: "tool_result" as const,
				tool_use_id: "tu_dup",
				content: "first",
			}
			const duplicate = {
				type: "tool_result" as const,
				tool_use_id: "tu_dup",
				content: "second",
			}

			task.pushToolResultToUserContent(toolResult)
			const added = task.pushToolResultToUserContent(duplicate)

			expect(added).toBe(false)
			expect(task.userMessageContent).toHaveLength(1)
			expect(task.userMessageContent[0]).toBe(toolResult)
			expect(logger.warn).toHaveBeenCalled()
		})

		it("allows different tool_use_ids", () => {
			const task = createPartialTask()
			const r1 = { type: "tool_result" as const, tool_use_id: "a", content: "1" }
			const r2 = { type: "tool_result" as const, tool_use_id: "b", content: "2" }

			task.pushToolResultToUserContent(r1)
			const added = task.pushToolResultToUserContent(r2)

			expect(added).toBe(true)
			expect(task.userMessageContent).toHaveLength(2)
		})

		it("does not flag non-tool_result blocks as duplicates", () => {
			const task = createPartialTask()
			const textBlock = { type: "text" as const, text: "hello" }
			const toolResult = { type: "tool_result" as const, tool_use_id: "x", content: "r" }

			task.userMessageContent.push(textBlock)
			const added = task.pushToolResultToUserContent(toolResult)

			expect(added).toBe(true)
			expect(task.userMessageContent).toHaveLength(2)
		})
	})

	// -----------------------------------------------------------------------
	// 4. recordToolUsage
	// -----------------------------------------------------------------------
	describe("recordToolUsage", () => {
		it("creates entry on first use with attempts=1", () => {
			const task = createPartialTask()
			task.recordToolUsage("read_file")

			expect(task.toolUsage["read_file"]).toEqual({ attempts: 1, failures: 0 })
		})

		it("increments attempts on subsequent calls", () => {
			const task = createPartialTask()
			task.recordToolUsage("read_file")
			task.recordToolUsage("read_file")
			task.recordToolUsage("read_file")

			expect(task.toolUsage["read_file"].attempts).toBe(3)
		})

		it("tracks different tools independently", () => {
			const task = createPartialTask()
			task.recordToolUsage("read_file")
			task.recordToolUsage("write_to_file")

			expect(task.toolUsage["read_file"].attempts).toBe(1)
			expect(task.toolUsage["write_to_file"].attempts).toBe(1)
		})
	})

	// -----------------------------------------------------------------------
	// 5. recordToolError
	// -----------------------------------------------------------------------
	describe("recordToolError", () => {
		it("creates entry and increments failures", () => {
			const task = createPartialTask()
			task.recordToolError("execute_command", "timeout")

			expect(task.toolUsage["execute_command"]).toEqual({ attempts: 0, failures: 1 })
		})

		it("calls toolExecution.recordToolErrorMetric", () => {
			const task = createPartialTask()
			task.recordToolError("execute_command", "fail")

			expect(task.toolExecution.recordToolErrorMetric).toHaveBeenCalledWith("execute_command")
		})

		it("emits TaskToolFailed event when error message provided", () => {
			const task = createPartialTask()
			const emitSpy = vi.spyOn(task, "emit")

			task.recordToolError("write_to_file", "disk full")

			expect(emitSpy).toHaveBeenCalledWith("taskToolFailed", "test-task-1", "write_to_file", "disk full")
		})

		it("does not emit event when no error message", () => {
			const task = createPartialTask()
			const emitSpy = vi.spyOn(task, "emit")

			task.recordToolError("write_to_file")

			expect(emitSpy).not.toHaveBeenCalled()
		})

		it("accumulates failures across calls", () => {
			const task = createPartialTask()
			task.recordToolError("read_file", "e1")
			task.recordToolError("read_file", "e2")

			expect(task.toolUsage["read_file"].failures).toBe(2)
		})
	})

	// -----------------------------------------------------------------------
	// 6. cancelAutoApprovalTimeout
	// -----------------------------------------------------------------------
	describe("cancelAutoApprovalTimeout", () => {
		it("clears timeout and sets ref to undefined when timeout is set", () => {
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")
			const fakeRef = setTimeout(() => {}, 100_000) as unknown as NodeJS.Timeout
			const task = createPartialTask({ autoApprovalTimeoutRef: fakeRef })

			task.cancelAutoApprovalTimeout()

			expect(clearTimeoutSpy).toHaveBeenCalledWith(fakeRef)
			expect(task.autoApprovalTimeoutRef).toBeUndefined()
			clearTimeoutSpy.mockRestore()
			// Clean up the timer we created
			clearTimeout(fakeRef)
		})

		it("is a no-op when no timeout is set", () => {
			const clearTimeoutSpy = vi.spyOn(global, "clearTimeout")
			const task = createPartialTask({ autoApprovalTimeoutRef: undefined })

			task.cancelAutoApprovalTimeout()

			expect(clearTimeoutSpy).not.toHaveBeenCalled()
			expect(task.autoApprovalTimeoutRef).toBeUndefined()
			clearTimeoutSpy.mockRestore()
		})
	})

	// -----------------------------------------------------------------------
	// 7. getBackgroundSignal & requestBackground
	// -----------------------------------------------------------------------
	describe("getBackgroundSignal and requestBackground", () => {
		it("getBackgroundSignal returns a promise", () => {
			const task = createPartialTask()
			const signal = task.getBackgroundSignal()

			expect(signal).toBeInstanceOf(Promise)
		})

		it("getBackgroundSignal returns the same promise on repeated calls", () => {
			const task = createPartialTask()
			const s1 = task.getBackgroundSignal()
			const s2 = task.getBackgroundSignal()

			expect(s1).toBe(s2)
		})

		it("requestBackground resolves the signal promise", async () => {
			const task = createPartialTask()
			const signal = task.getBackgroundSignal()

			task.requestBackground()

			await expect(signal).resolves.toBeUndefined()
			expect(task.isBackgrounded).toBe(true)
		})

		it("requestBackground is a no-op if signal was never requested", () => {
			const task = createPartialTask()
			// Should not throw
			task.requestBackground()
			expect(task.isBackgrounded).toBe(false)
		})

		it("requestBackground is a no-op if already backgrounded", async () => {
			const task = createPartialTask()
			const signal = task.getBackgroundSignal()

			task.requestBackground()
			await signal

			// Calling again should be a no-op (no throw, still backgrounded)
			task.requestBackground()
			expect(task.isBackgrounded).toBe(true)
		})

		it("nulls out _backgroundResolve after requestBackground", async () => {
			const task = createPartialTask()
			task.getBackgroundSignal()
			expect(task._backgroundResolve).not.toBeNull()

			task.requestBackground()
			expect(task._backgroundResolve).toBeNull()
		})
	})
})
