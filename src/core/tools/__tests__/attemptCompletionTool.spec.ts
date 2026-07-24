import { describe, it, expect, vi, beforeEach } from "vitest"

import { NJUST_AIEventName, TodoItem } from "@njust-ai/types"

import { AttemptCompletionToolUse } from "../../../shared/tools"

// Mock the formatResponse module before importing the tool
vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: vi.fn((msg: string) => `Error: ${msg}`),
		toolResult: vi.fn((msg: string) => `Result: ${msg}`),
		toolDenied: vi.fn(() => "Denied"),
	},
}))

const { mockCaptureTaskCompleted } = vi.hoisted(() => ({
	mockCaptureTaskCompleted: vi.fn(),
}))
const { mockAppendCangjieEvalTrace } = vi.hoisted(() => ({
	mockAppendCangjieEvalTrace: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: {
		reportError: vi.fn(),
		instance: {
			captureTaskCompleted: mockCaptureTaskCompleted,
			captureEvent: vi.fn(),
			startSpan: vi.fn(function () {
				return {
					traceId: "test-trace",
					spanId: "test-span",
				}
			}),
			endSpan: vi.fn(),
		},
	},
}))

vi.mock("../../../services/CangjieEvalTraceLogger", () => ({
	appendCangjieEvalTrace: mockAppendCangjieEvalTrace,
}))

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		getConfiguration: vi.fn(function () {
			return {
				get: vi.fn(),
			}
		}),
	},
}))

// Mock Package module
vi.mock("../../../shared/package", () => ({
	Package: {
		name: "njust-ai",
	},
}))

import { attemptCompletionTool, AttemptCompletionCallbacks } from "../AttemptCompletionTool"
import { Task } from "../../task/Task"
import * as vscode from "vscode"

describe("attemptCompletionTool", () => {
	let mockTask: Partial<Task>
	let mockPushToolResult: ReturnType<typeof vi.fn>
	let mockAskApproval: ReturnType<typeof vi.fn>
	let mockHandleError: ReturnType<typeof vi.fn>
	let mockToolDescription: ReturnType<typeof vi.fn>
	let mockAskFinishSubTaskApproval: ReturnType<typeof vi.fn>
	let mockGetConfiguration: ReturnType<typeof vi.fn>

	beforeEach(() => {
		mockCaptureTaskCompleted.mockReset()
		mockAppendCangjieEvalTrace.mockReset()
		mockAppendCangjieEvalTrace.mockResolvedValue(undefined)
		mockPushToolResult = vi.fn()
		mockAskApproval = vi.fn().mockResolvedValue(true)
		mockHandleError = vi.fn()
		mockToolDescription = vi.fn()
		mockAskFinishSubTaskApproval = vi.fn()
		mockGetConfiguration = vi.fn(function () {
			return {
				get: vi.fn(function (key: string, defaultValue: any) {
					if (key === "preventCompletionWithOpenTodos") {
						return defaultValue // Default to false unless overridden in test
					}
					return defaultValue
				}),
			}
		})

		// Setup vscode mock
		vi.mocked(vscode.workspace.getConfiguration).mockImplementation(mockGetConfiguration)

		mockTask = {
			consecutiveMistakeCount: 0,
			recordToolError: vi.fn(),
			todoList: undefined,
			say: vi.fn().mockResolvedValue(undefined),
			ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] }),
			emitFinalTokenUsageUpdate: vi.fn(),
			emit: vi.fn(),
			getTokenUsage: vi.fn().mockReturnValue({}),
			toolUsage: {},
			taskId: "task_1",
			globalStoragePath: "D:\\test-storage",
			cwd: "D:\\cangjie\\Cangjie-Examples\\HTTP",
			apiConfiguration: { apiProvider: "test" } as any,
			api: { getModel: vi.fn().mockReturnValue({ id: "test-model", info: {} }) } as any,
			markTaskCompleted: vi.fn(),
			markAttemptedCompletion: vi.fn(),
			cangjieRuntimePolicy: {
				hasCjpmProject: vi.fn().mockResolvedValue(false),
				getAttemptCompletionBlockReason: vi.fn().mockReturnValue(null),
				getMissingCompletionEvidence: vi.fn().mockReturnValue([]),
				getUnsupportedStdlibRiskSpeculation: vi.fn().mockReturnValue(null),
				getContextInjectionAuditMissingLabelsReport: vi.fn().mockReturnValue(null),
				getContextInjectionAuditScopeReport: vi.fn().mockReturnValue(null),
				getContradictoryVerificationReport: vi.fn().mockReturnValue(null),
				getAllowlistExtraProbeReport: vi.fn().mockReturnValue(null),
				getInvalidOptionDefaultCallReport: vi.fn().mockReturnValue(null),
				getUnsafeHashMapCountGetOrThrowReport: vi.fn().mockReturnValue(null),
				getIncorrectRegexFindSignatureReport: vi.fn().mockReturnValue(null),
				getEvidenceReportInvitationReport: vi.fn().mockReturnValue(null),
				getUncitedHashMapSubscriptAssignmentReport: vi.fn().mockReturnValue(null),
				getUnsupportedHashMapMutabilityClaimReport: vi.fn().mockReturnValue(null),
				getEvidenceAuditSummary: vi.fn().mockReturnValue(undefined),
				getEvalRuntimeSnapshot: vi.fn().mockReturnValue({
					writeRevision: 0,
					validatedRevision: 0,
					recentBuildSucceeded: true,
					recentBuildFailed: false,
					compileFailureRounds: 0,
					stagnantFailureRounds: 0,
					searchedStdModules: [],
					corpusReadModules: [],
					corpusReadPathCount: 0,
					pendingEvidenceModules: [],
					evidenceRecordCount: 0,
				}),
			} as any,
		}
	})

	describe("todo list validation", () => {
		it("auto-completes a top-level Cangjie task after its completion gates pass", async () => {
			mockTask.taskMode = "cangjie"
			mockTask.parentTaskId = undefined
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "cjpm build success" },
				nativeArgs: { result: "cjpm build success" },
				partial: false,
			}

			await attemptCompletionTool.handle(mockTask as Task, block, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			})

			expect(mockTask.say).toHaveBeenCalledWith("completion_result", "cjpm build success", undefined, false)
			expect(mockTask.markAttemptedCompletion).toHaveBeenCalledOnce()
			expect(mockTask.markTaskCompleted).toHaveBeenCalledOnce()
			expect(mockTask.ask).not.toHaveBeenCalledWith("completion_result", "", false)
		})

		it("allows an implementation child to hand pending build verification back to its parent", async () => {
			const getAttemptCompletionBlockReason = vi.fn(
				(options?: { allowPendingBuild?: boolean; allowFailedBuildHandoff?: boolean }) =>
					options?.allowPendingBuild ? null : "pending build",
			)
			mockTask.taskMode = "cangjie"
			mockTask.parentTaskId = "parent-1"
			mockTask.agentType = "CangjieImplement"
			const reopenParentFromDelegation = vi.fn().mockResolvedValue(undefined)
			mockTask.providerRef = {
				deref: vi.fn().mockReturnValue({
					getTaskWithId: vi.fn().mockResolvedValue({ historyItem: { status: "active" } }),
					reopenParentFromDelegation,
				}),
			} as any
			mockAskFinishSubTaskApproval.mockResolvedValue(false)
			mockTask.cangjieRuntimePolicy = {
				...mockTask.cangjieRuntimePolicy,
				getAttemptCompletionBlockReason,
			} as any

			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Edited src/main.cj; verification pending." },
				nativeArgs: { result: "Edited src/main.cj; verification pending." },
				partial: false,
			}

			await attemptCompletionTool.handle(mockTask as Task, block, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			})

			expect(getAttemptCompletionBlockReason).toHaveBeenCalledWith({ allowPendingBuild: true })
			expect(mockPushToolResult).not.toHaveBeenCalledWith(expect.stringContaining("pending build"), undefined)
			expect(mockAskFinishSubTaskApproval).not.toHaveBeenCalled()
			expect(reopenParentFromDelegation).toHaveBeenCalledWith({
				parentTaskId: "parent-1",
				childTaskId: "task_1",
				completionResultSummary: "Edited src/main.cj; verification pending.",
			})
		})

		it("allows a verification child to hand a failed build back to its parent", async () => {
			const getAttemptCompletionBlockReason = vi.fn(
				(options?: { allowPendingBuild?: boolean; allowFailedBuildHandoff?: boolean }) =>
					options?.allowFailedBuildHandoff ? null : "build failed",
			)
			mockTask.taskMode = "cangjie"
			mockTask.parentTaskId = "parent-1"
			mockTask.agentType = "CangjieVerify"
			const reopenParentFromDelegation = vi.fn().mockResolvedValue(undefined)
			mockTask.providerRef = {
				deref: vi.fn().mockReturnValue({
					getTaskWithId: vi.fn().mockResolvedValue({ historyItem: { status: "active" } }),
					reopenParentFromDelegation,
				}),
			} as any
			mockTask.cangjieRuntimePolicy = {
				...mockTask.cangjieRuntimePolicy,
				getAttemptCompletionBlockReason,
			} as any

			const result = "cjpm build failed with exit code 1."
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result },
				nativeArgs: { result },
				partial: false,
			}

			await attemptCompletionTool.handle(mockTask as Task, block, {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			})

			expect(getAttemptCompletionBlockReason).toHaveBeenCalledWith({
				allowFailedBuildHandoff: true,
			})
			expect(reopenParentFromDelegation).toHaveBeenCalledWith({
				parentTaskId: "parent-1",
				childTaskId: "task_1",
				completionResultSummary: result,
			})
		})

		it("should allow completion when there is no todo list", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			mockTask.todoList = undefined

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should not call pushToolResult with an error for empty todo list
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should allow completion when todo list is empty", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			mockTask.todoList = []

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should allow completion when all todos are completed", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const completedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "completed" },
			]

			mockTask.todoList = completedTodos

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
		})

		it("should prevent completion when there are pending todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn(function (key: string, defaultValue: any) {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
				undefined,
			)
		})

		it("should prevent completion when there are in-progress todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithInProgress: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "in_progress" },
			]

			mockTask.todoList = todosWithInProgress

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn(function (key: string, defaultValue: any) {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
				undefined,
			)
		})

		it("should prevent completion when there are mixed incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const mixedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
				{ id: "3", content: "Third task", status: "in_progress" },
			]

			mockTask.todoList = mixedTodos

			// Enable the setting to prevent completion with open todos
			mockGetConfiguration.mockReturnValue({
				get: vi.fn(function (key: string, defaultValue: any) {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
				undefined,
			)
		})

		it("should allow completion when setting is disabled even with incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Ensure the setting is disabled (default behavior)
			mockGetConfiguration.mockReturnValue({
				get: vi.fn(function (key: string, defaultValue: any) {
					if (key === "preventCompletionWithOpenTodos") {
						return false // Setting is disabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should not prevent completion when setting is disabled
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		it("should prevent completion when setting is enabled with incomplete todos", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const todosWithPending: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "pending" },
			]

			mockTask.todoList = todosWithPending

			// Enable the setting
			mockGetConfiguration.mockReturnValue({
				get: vi.fn(function (key: string, defaultValue: any) {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should prevent completion when setting is enabled and there are incomplete todos
			expect(mockTask.consecutiveMistakeCount).toBe(1)
			expect(mockTask.recordToolError).toHaveBeenCalledWith("attempt_completion")
			expect(mockPushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
				undefined,
			)
		})

		it("should allow completion when setting is enabled but all todos are completed", async () => {
			const block: AttemptCompletionToolUse = {
				type: "tool_use",
				name: "attempt_completion",
				params: { result: "Task completed successfully" },
				nativeArgs: { result: "Task completed successfully" },
				partial: false,
			}

			const completedTodos: TodoItem[] = [
				{ id: "1", content: "First task", status: "completed" },
				{ id: "2", content: "Second task", status: "completed" },
			]

			mockTask.todoList = completedTodos

			// Enable the setting
			mockGetConfiguration.mockReturnValue({
				get: vi.fn(function (key: string, defaultValue: any) {
					if (key === "preventCompletionWithOpenTodos") {
						return true // Setting is enabled
					}
					return defaultValue
				}),
			})

			const callbacks: AttemptCompletionCallbacks = {
				askApproval: mockAskApproval,
				handleError: mockHandleError,
				pushToolResult: mockPushToolResult,
				askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
				toolDescription: mockToolDescription,
			}
			await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

			// Should allow completion when setting is enabled but all todos are completed
			expect(mockTask.consecutiveMistakeCount).toBe(0)
			expect(mockTask.recordToolError).not.toHaveBeenCalled()
			expect(mockPushToolResult).not.toHaveBeenCalledWith(
				expect.stringContaining("Cannot complete task while there are incomplete todos"),
			)
		})

		describe("tool failure guardrail", () => {
			it("should prevent completion when a previous tool failed in the current turn", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Task completed successfully" },
					nativeArgs: { result: "Task completed successfully" },
					partial: false,
				}

				mockTask.todoList = undefined
				mockTask.didToolFailInCurrentTurn = true

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				const mockSay = vi.fn()
				mockTask.say = mockSay

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockSay).toHaveBeenCalledWith(
					"error",
					expect.stringContaining("errors.attempt_completion_tool_failed"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("errors.attempt_completion_tool_failed"),
					undefined,
				)
			})

			it("should allow completion when no tools failed", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Task completed successfully" },
					nativeArgs: { result: "Task completed successfully" },
					partial: false,
				}

				mockTask.todoList = undefined
				mockTask.didToolFailInCurrentTurn = false

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.consecutiveMistakeCount).toBe(0)
				expect(mockTask.recordToolError).not.toHaveBeenCalled()
			})

			it("prevents completion when a Cangjie project claims high-risk stdlib API correctness without evidence", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: {
						result: "readTextFile uses File.readFrom(path) and String.fromUtf8(bytes), so the implementation is correct.",
					},
					nativeArgs: {
						result: "readTextFile uses File.readFrom(path) and String.fromUtf8(bytes), so the implementation is correct.",
					},
					partial: false,
				}

				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "default" as any
				;(mockTask.cangjieRuntimePolicy as any).hasCjpmProject.mockResolvedValue(true)
				;(mockTask.cangjieRuntimePolicy as any).getMissingCompletionEvidence.mockReturnValue(["std.fs"])

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("high-risk stdlib API usage"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("std.fs"), undefined)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("Suggested corpus locations"),
					undefined,
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("CangjieCorpus-1.0.0/libs/std/fs"),
					undefined,
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("CangjieCorpus-1.0.0/extra/File.md"),
					undefined,
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("do not perform those actions to satisfy this gate"),
					undefined,
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("blocked/inconclusive under the user's constraints"),
					undefined,
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("不要查 LSP"), undefined)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("appends Cangjie evidence audit to successful completion results", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Task completed successfully." },
					nativeArgs: { result: "Task completed successfully." },
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getEvidenceAuditSummary.mockReturnValue(
					"Cangjie evidence audit:\n- corpus read: std.fs (File.readFrom)",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.say).toHaveBeenCalledWith(
					"completion_result",
					expect.stringContaining("Cangjie evidence audit:"),
					undefined,
					false,
				)
				expect(mockTask.say).toHaveBeenCalledWith(
					"completion_result",
					expect.stringContaining("corpus read: std.fs"),
					undefined,
					false,
				)
				expect(mockAppendCangjieEvalTrace).toHaveBeenCalledWith(
					expect.objectContaining({
						globalStoragePath: "D:\\test-storage",
						taskId: "task_1",
						cwd: "D:\\cangjie\\Cangjie-Examples\\HTTP",
						mode: "cangjie",
						stage: "attempt_completion",
						result: expect.stringContaining("Cangjie evidence audit:"),
					}),
				)
			})

			it("prevents unsupported Byte/UInt8 risk speculation in Cangjie completion reports", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: {
						result: "File.readFrom returns Array<Byte>; String.fromUtf8 accepts Array<UInt8>. 潜在风险：可能存在类型不匹配。",
					},
					nativeArgs: {
						result: "File.readFrom returns Array<Byte>; String.fromUtf8 accepts Array<UInt8>. 潜在风险：可能存在类型不匹配。",
					},
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getUnsupportedStdlibRiskSpeculation.mockReturnValue(
					"Completion blocked in Cangjie mode: unsupported risk speculation.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("unsupported risk speculation"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("unsupported risk speculation"),
					undefined,
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("prevents context injection audits from adding project status sections", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: {
						result: [
							"## Cangjie context injection audit",
							"Injected context groups: toolchain-rules, structured-editing-context, import-to-corpus-doc-map, visible-editor-symbols, stdlib-signature-hints, project-overview, contextual-coding-rules, mandatory-corpus-footer.",
							"**Project status**: web v1.0.0 dynamic.",
						].join("\n"),
					},
					nativeArgs: {
						result: [
							"## Cangjie context injection audit",
							"Injected context groups: toolchain-rules, structured-editing-context, import-to-corpus-doc-map, visible-editor-symbols, stdlib-signature-hints, project-overview, contextual-coding-rules, mandatory-corpus-footer.",
							"**Project status**: web v1.0.0 dynamic.",
						].join("\n"),
					},
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getContextInjectionAuditScopeReport.mockReturnValue(
					"Completion blocked in Cangjie mode: the final context-injection audit includes extra project/file/symbol status.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("context-injection audit"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("extra project/file/symbol status"),
					undefined,
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("prevents context injection audits that omit the injected labels", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: {
						result: "Cangjie context injection audit is complete. The report was already submitted. No files were modified.",
					},
					nativeArgs: {
						result: "Cangjie context injection audit is complete. The report was already submitted. No files were modified.",
					},
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getContextInjectionAuditMissingLabelsReport.mockReturnValue(
					"Completion blocked in Cangjie mode: the final context-injection audit does not list the injected context labels.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("does not list the injected context labels"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("does not list the injected context labels"),
					undefined,
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("prevents contradictory build-success and inconclusive verification reports", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: {
						result: "cjpm build success, but verification inconclusive because shell integration failed.",
					},
					nativeArgs: {
						result: "cjpm build success, but verification inconclusive because shell integration failed.",
					},
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getContradictoryVerificationReport.mockReturnValue(
					"Completion blocked in Cangjie mode: contradictory verification report.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("contradictory verification report"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("contradictory verification report"),
					undefined,
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("prevents final reports that claim extra probes in explicit command allowlist tasks", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: {
						result: "Only run cjpm build. I checked whether cjpm.toml exists, then ran cjpm build.",
					},
					nativeArgs: {
						result: "Only run cjpm build. I checked whether cjpm.toml exists, then ran cjpm build.",
					},
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getAllowlistExtraProbeReport.mockReturnValue(
					"Completion blocked in Cangjie mode: extra project/file probes.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("extra project/file probes"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("extra project/file probes"),
					undefined,
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("prevents invalid Option.getOrThrow default-value reports", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Use map.get(word).getOrThrow(0) + 1 for the default count." },
					nativeArgs: { result: "Use map.get(word).getOrThrow(0) + 1 for the default count." },
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getInvalidOptionDefaultCallReport.mockReturnValue(
					"Completion blocked in Cangjie mode: invalid Option.getOrThrow default.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("invalid Option.getOrThrow default"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("invalid Option.getOrThrow default"),
					undefined,
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("prevents unsafe HashMap count defaults that use getOrThrow", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "HashMap countWords plan: map.get(w).getOrThrow() + 1, then map.add(w, count)." },
					nativeArgs: {
						result: "HashMap countWords plan: map.get(w).getOrThrow() + 1, then map.add(w, count).",
					},
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getUnsafeHashMapCountGetOrThrowReport.mockReturnValue(
					"Completion blocked in Cangjie mode: unsafe HashMap count default.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("unsafe HashMap count default"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("unsafe HashMap count default"),
					undefined,
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("prevents incorrect zero-argument Regex.find signature reports", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "Regex evidence: public func find(): Option<MatchData>." },
					nativeArgs: { result: "Regex evidence: public func find(): Option<MatchData>." },
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getIncorrectRegexFindSignatureReport.mockReturnValue(
					"Completion blocked in Cangjie mode: incorrect Regex.find signature.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("incorrect Regex.find signature"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("incorrect Regex.find signature"),
					undefined,
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("prevents evidence-only reports from inviting immediate coding", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: {
						result: "Cangjie evidence audit:\n- corpus read: std.collection\n\nNo files were modified. Tell me if you want implementation.",
					},
					nativeArgs: {
						result: "Cangjie evidence audit:\n- corpus read: std.collection\n\nNo files were modified. Tell me if you want implementation.",
					},
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getEvidenceReportInvitationReport.mockReturnValue(
					"Completion blocked in Cangjie mode: evidence report invites coding.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("evidence report invites coding"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("evidence report invites coding"),
					undefined,
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("prevents uncited HashMap subscript assignment in evidence reports", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: {
						result: "HashMap countWords evidence collected from add/get docs.\nfunc countWords(words: Array<String>) { counts[w] = prev + 1 }",
					},
					nativeArgs: {
						result: "HashMap countWords evidence collected from add/get docs.\nfunc countWords(words: Array<String>) { counts[w] = prev + 1 }",
					},
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getUncitedHashMapSubscriptAssignmentReport.mockReturnValue(
					"Completion blocked in Cangjie mode: uncited HashMap subscript assignment.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("uncited HashMap subscript assignment"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("uncited HashMap subscript assignment"),
					undefined,
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("prevents unsupported HashMap.add mutability claims", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: {
						result: "HashMap.add requires var because add is a mut method, so let cannot be used.",
					},
					nativeArgs: {
						result: "HashMap.add requires var because add is a mut method, so let cannot be used.",
					},
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getUnsupportedHashMapMutabilityClaimReport.mockReturnValue(
					"Completion blocked in Cangjie mode: unsupported HashMap.add mutability claim.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("unsupported HashMap.add mutability claim"),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(
					expect.stringContaining("unsupported HashMap.add mutability claim"),
					undefined,
				)
				expect(mockAppendCangjieEvalTrace).toHaveBeenCalledWith(
					expect.objectContaining({
						globalStoragePath: "D:\\test-storage",
						taskId: "task_1",
						cwd: "D:\\cangjie\\Cangjie-Examples\\HTTP",
						mode: "cangjie",
						stage: "attempt_completion_blocked",
						result: "HashMap.add requires var because add is a mut method, so let cannot be used.",
						blockReason: expect.stringContaining("unsupported HashMap.add mutability claim"),
					}),
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("applies Cangjie completion gates to Cangjie evidence reports outside cangjie mode", async () => {
				const result = [
					"任务完成报告：HashMap 计数函数 API 证据调查",
					"来源: collection_package_class.md:1432-1449",
					"结论: HashMap 的 add、remove、clear、下标赋值等修改操作要求变量绑定为 var。",
					"可以断言：add 必须 var。",
				].join("\n")
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result },
					nativeArgs: { result },
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = undefined as any
				;(mockTask.cangjieRuntimePolicy as any).hasCjpmProject.mockResolvedValue(false)
				;(mockTask.cangjieRuntimePolicy as any).getUnsupportedHashMapMutabilityClaimReport.mockReturnValue(
					"Completion blocked in Cangjie mode: unsupported HashMap.add mutability claim.",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(
					(mockTask.cangjieRuntimePolicy as any).getUnsupportedHashMapMutabilityClaimReport,
				).toHaveBeenCalledWith(result)
				expect(mockTask.recordToolError).toHaveBeenCalledWith(
					"attempt_completion",
					expect.stringContaining("unsupported HashMap.add mutability claim"),
				)
				expect(mockTask.markAttemptedCompletion).not.toHaveBeenCalled()
			})

			it("normalizes a markdown/case-variant Cangjie evidence audit heading instead of appending a duplicate block", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: {
						result: "Task completed successfully.\n\n**Cangjie Evidence Audit:**\n- corpus read: std.fs",
					},
					nativeArgs: {
						result: "Task completed successfully.\n\n**Cangjie Evidence Audit:**\n- corpus read: std.fs",
					},
					partial: false,
				}
				mockTask.didToolFailInCurrentTurn = false
				mockTask.taskMode = "cangjie" as any
				;(mockTask.cangjieRuntimePolicy as any).getEvidenceAuditSummary.mockReturnValue(
					"Cangjie evidence audit:\n- corpus read: std.fs (File.readFrom)",
				)

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				const completionResult = vi
					.mocked(mockTask.say)
					.mock.calls.find((call) => call[0] === "completion_result")?.[1]
				expect(completionResult).toContain("Cangjie evidence audit:")
				expect(completionResult).not.toContain("Cangjie Evidence Audit")
				expect(completionResult).not.toContain("**Cangjie Evidence Audit:**")
				expect(completionResult?.match(/Cangjie evidence audit:/g)).toHaveLength(1)
			})
		})

		describe("completion lifecycle", () => {
			it("emits TaskCompleted only when completion is accepted", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "2" },
					nativeArgs: { result: "2" },
					partial: false,
				}

				mockTask.ask = vi.fn().mockResolvedValue({ response: "yesButtonClicked", text: "", images: [] })

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockHandleError).not.toHaveBeenCalled()
				expect(mockCaptureTaskCompleted).toHaveBeenCalledWith("task_1")
				expect(mockTask.emit).toHaveBeenCalledWith(
					NJUST_AIEventName.TaskCompleted,
					"task_1",
					expect.anything(),
					expect.anything(),
					{ isSubtask: false },
				)
			})

			it("does not emit TaskCompleted when user provides follow-up feedback", async () => {
				const block: AttemptCompletionToolUse = {
					type: "tool_use",
					name: "attempt_completion",
					params: { result: "2" },
					nativeArgs: { result: "2" },
					partial: false,
				}

				mockTask.ask = vi.fn().mockResolvedValue({
					response: "messageResponse",
					text: "Different question now: what is 3+3?",
					images: [],
				})

				const callbacks: AttemptCompletionCallbacks = {
					askApproval: mockAskApproval,
					handleError: mockHandleError,
					pushToolResult: mockPushToolResult,
					askFinishSubTaskApproval: mockAskFinishSubTaskApproval,
					toolDescription: mockToolDescription,
				}

				await attemptCompletionTool.handle(mockTask as Task, block, callbacks)

				expect(mockHandleError).not.toHaveBeenCalled()
				expect(mockCaptureTaskCompleted).not.toHaveBeenCalled()
				expect(mockTask.emit).not.toHaveBeenCalledWith(
					NJUST_AIEventName.TaskCompleted,
					expect.anything(),
					expect.anything(),
					expect.anything(),
					expect.anything(),
				)
				expect(mockPushToolResult).toHaveBeenCalledWith(expect.stringContaining("[USER-MESSAGE]"), undefined)
			})
		})
	})
})
