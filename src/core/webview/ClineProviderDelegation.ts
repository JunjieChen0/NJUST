import * as vscode from "vscode"

import { NJUST_AIEventName, type ClineMessage, type TodoItem, TelemetryEventName } from "@njust-ai/types"

import { logger } from "../../shared/logger"
import { getErrorMessage } from "../../shared/error-utils"
import type { Mode } from "../../shared/modes"
import type { Task } from "../task/Task"
import { readApiMessages, saveApiMessages, saveTaskMessages, type ApiMessage } from "../task-persistence"
import { readTaskMessages } from "../task-persistence/taskMessages"
import { TelemetryService } from "@njust-ai/telemetry"

export interface IDelegationHost {
	getCurrentTask(): Task | undefined
	log(message: string): void
	stack: { pop(options?: { skipDelegationRepair?: boolean }): Promise<void> }
	handleModeSwitch(mode: string): Promise<void>
	createTask(text: string, images?: string[], parentTask?: Task, options?: unknown): Promise<Task>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	getTaskWithId(id: string): Promise<{ historyItem: any }>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	updateTaskHistory(item: any, options?: unknown): Promise<unknown[]>
	emit(event: string, ...args: unknown[]): boolean
	readonly contextProxy: { globalStorageUri: { fsPath: string } }
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	createTaskWithHistoryItem(historyItem: any, options?: { startTask?: boolean }): Promise<Task | undefined>
}

export function appendDelegationCompletionToApiMessages(
	parentApiMessages: ApiMessage[],
	childTaskId: string,
	completionResultSummary: string,
): void {
	let delegationAssistantIndex = -1
	let toolUseId: string | undefined

	for (let i = parentApiMessages.length - 1; i >= 0; i--) {
		const msg = parentApiMessages[i]
		if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue

		const delegationBlock = msg.content.find(
			(block) => block.type === "tool_use" && (block.name === "new_task" || block.name === "agent"),
		)
		if (delegationBlock?.type === "tool_use") {
			delegationAssistantIndex = i
			toolUseId = delegationBlock.id
			break
		}
	}

	const completionText = `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`
	if (!toolUseId || delegationAssistantIndex < 0) {
		parentApiMessages.push({
			role: "user",
			content: [{ type: "text" as const, text: completionText }],
			ts: Date.now(),
		})
		return
	}

	// Update a persisted placeholder/interruption in place. Appending a second
	// tool_result after later assistant turns violates the API message contract.
	for (let i = delegationAssistantIndex + 1; i < parentApiMessages.length; i++) {
		const msg = parentApiMessages[i]
		if (msg?.role === "assistant") break
		if (msg?.role !== "user" || !Array.isArray(msg.content)) continue

		const existing = msg.content.find((block) => block.type === "tool_result" && block.tool_use_id === toolUseId)
		if (existing?.type === "tool_result") {
			existing.content = completionText
			return
		}
	}

	const delegationIsLatestAssistant = !parentApiMessages
		.slice(delegationAssistantIndex + 1)
		.some((msg) => msg.role === "assistant")
	if (delegationIsLatestAssistant) {
		parentApiMessages.push({
			role: "user",
			content: [{ type: "tool_result" as const, tool_use_id: toolUseId, content: completionText }],
			ts: Date.now(),
		})
		return
	}

	// Historical/broken sessions may already have advanced past the delegation.
	// A plain user note is safe; a late tool_result would be rebound to the wrong call.
	parentApiMessages.push({
		role: "user",
		content: [{ type: "text" as const, text: completionText }],
		ts: Date.now(),
	})
}

export async function delegateParentAndOpenChildWithProvider(
	provider: IDelegationHost,
	params: {
		parentTaskId: string
		message: string
		initialTodos: TodoItem[]
		mode: string
		isolationLevel?: string
		forkedContextSummary?: string
		allowedTools?: string[]
		agentType?: string
	},
): Promise<Task> {
	const { parentTaskId, message, initialTodos, mode, isolationLevel, forkedContextSummary, allowedTools, agentType } =
		params

	// Metadata-driven delegation is always enabled

	// 1) Get parent (must be current task)
	const parent = provider.getCurrentTask()
	if (!parent) {
		throw new Error("[delegateParentAndOpenChild] No current task")
	}
	if (parent.taskId !== parentTaskId) {
		throw new Error(
			`[delegateParentAndOpenChild] Parent mismatch: expected ${parentTaskId}, current ${parent.taskId}`,
		)
	}
	// 2) Flush pending tool results to API history before pausing the parent.
	//    This is critical: when tools are called before new_task,
	//    their tool_result blocks are in userMessageContent but not yet saved to API history.
	//    If we don't flush them, the parent's API conversation will be incomplete and
	//    cause 400 errors when resumed (missing tool_result for tool_use blocks).
	//
	//    NOTE: We do NOT pass the assistant message here because the assistant message
	//    is already added to apiConversationHistory by the normal flow in
	//    recursivelyMakeClineRequests BEFORE tools start executing. We only need to
	//    flush the pending user message with tool_results.
	try {
		const flushSuccess = await parent.flushPendingToolResultsToHistory()

		if (!flushSuccess) {
			logger.warn(
				"ClineProvider",
				`delegateParentAndOpenChild: Flush failed for parent ${parentTaskId}, retrying...`,
			)
			const retrySuccess = await parent.retrySaveApiConversationHistory()

			if (!retrySuccess) {
				logger.error(
					"ClineProvider",
					`delegateParentAndOpenChild: CRITICAL: Parent ${parentTaskId} API history not persisted to disk. Child return may produce stale state.`,
				)
				vscode.window.showWarningMessage(
					"Warning: Parent task state could not be saved. The parent task may lose recent context when resumed.",
				)
			}
		}
	} catch (error) {
		provider.log(
			`[delegateParentAndOpenChild] Error flushing pending tool results (non-fatal): ${getErrorMessage(error)}`,
		)
	}

	// 3) Keep the parent on the stack while the child runs. Popping here aborts and
	//    disposes the task that is still executing this delegation tool call.
	parent.isPaused = true

	// 4) Switch provider mode to child's requested mode BEFORE creating the child task
	//    This ensures the child's system prompt and configuration are based on the correct mode.
	//    The mode switch must happen before createTask() because the Task constructor
	//    initializes its mode from provider.getState() during initializeTaskMode().
	try {
		await provider.handleModeSwitch(mode as Mode)
	} catch (e) {
		provider.log(
			`[delegateParentAndOpenChild] handleModeSwitch failed for mode '${mode}': ${
				(e as Error)?.message ?? String(e)
			}`,
		)
	}

	// 5) Push the child as the active task while preserving the paused parent below it.
	// Pass initialStatus: "active" to ensure the child task's historyItem is created
	// with status from the start, avoiding race conditions where the task might
	// call attempt_completion before status is persisted separately.
	//
	// Pass startTask: false to prevent the child from beginning its task loop
	// (and writing to globalState via saveClineMessages → updateTaskHistory)
	// before we persist the parent's delegation metadata in step 5.
	// Without this, the child's fire-and-forget startTask() races with step 5,
	// and the last writer to globalState overwrites the other's changes—
	// causing the parent's delegation fields to be lost.
	let child: Task
	try {
		child = await provider.createTask(message, undefined, parent, {
			initialTodos,
			initialStatus: "active",
			startTask: false,
			allowedTools,
			taskMode: mode,
			agentType,
		})
	} catch (error) {
		parent.isPaused = false
		throw error
	}
	// Inherit streaming model snapshot for better prompt-cache/tool-schema reuse continuity.
	if (parent.cachedStreamingModel) {
		child.cachedStreamingModel = parent.cachedStreamingModel
	}

	// Apply forked isolation context if specified
	let effectiveForkedSummary = forkedContextSummary
	if (isolationLevel === "forked" && !effectiveForkedSummary) {
		// Auto-generate context summary from parent when caller (e.g. NewTaskTool)
		// requests forked isolation but doesn't provide a pre-built summary.
		try {
			const { generateParentContextSummary } = await import("../task/SubTaskContextBuilder")
			const { DEFAULT_FORKED_CONTEXT_CONFIG } = await import("../task/SubTaskOptions")
			if (parent.apiConversationHistory && parent.apiConversationHistory.length > 0) {
				effectiveForkedSummary = generateParentContextSummary(
					parent.apiConversationHistory,
					DEFAULT_FORKED_CONTEXT_CONFIG.summaryMaxTokens,
					DEFAULT_FORKED_CONTEXT_CONFIG,
				)
			}
		} catch (e) {
			provider.log(
				`[delegateParentAndOpenChild] Failed to auto-generate forked context summary: ${
					(e as Error)?.message ?? String(e)
				}`,
			)
		}
	}
	if (isolationLevel === "forked" && effectiveForkedSummary) {
		child.forkedContextSummary = effectiveForkedSummary
		child.isolationLevel = "forked"
	}

	// Record delegation before the child starts and takes focus. Recording after
	// start races with task suspension and can leave eval traces without the route.
	if (agentType) {
		parent.cangjieRuntimePolicy.noteAgentDelegation(agentType)
	}

	// 6) Persist parent delegation metadata BEFORE the child starts writing.
	try {
		const { historyItem } = await provider.getTaskWithId(parentTaskId)
		const childIds = Array.from(new Set([...(historyItem.childIds ?? []), child.taskId]))
		const delegatedAgentTypes = agentType
			? [...(historyItem.delegatedAgentTypes ?? []), agentType]
			: historyItem.delegatedAgentTypes
		const updatedHistory: typeof historyItem = {
			...historyItem,
			status: "delegated",
			delegatedToId: child.taskId,
			awaitingChildId: child.taskId,
			childIds,
			delegatedAgentTypes,
		}
		await provider.updateTaskHistory(updatedHistory)
	} catch (err) {
		provider.log(
			`[delegateParentAndOpenChild] Failed to persist parent metadata for ${parentTaskId} -> ${child.taskId}: ${
				(err as Error)?.message ?? String(err)
			}`,
		)
	}

	// 7) Start the child task now that parent metadata is safely persisted.
	child.start()

	// 8) Emit TaskDelegated (provider-level)
	try {
		provider.emit(NJUST_AIEventName.TaskDelegated, parentTaskId, child.taskId)
	} catch (error) {
		// non-fatal
		logger.warn("ClineProvider", "TaskDelegated event emission failed", error)
		TelemetryService.reportError(error, TelemetryEventName.WEBVIEW_ERROR)
	}

	return child
}

export async function reopenParentFromDelegationWithProvider(
	provider: IDelegationHost,
	params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	},
): Promise<void> {
	const { parentTaskId, childTaskId, completionResultSummary } = params
	const globalStoragePath = provider.contextProxy.globalStorageUri.fsPath

	// 1) Load parent from history and current persisted messages
	const { historyItem } = await provider.getTaskWithId(parentTaskId)

	let parentClineMessages: ClineMessage[] = []
	try {
		parentClineMessages = await readTaskMessages({
			taskId: parentTaskId,
			globalStoragePath,
		})
	} catch (error) {
		logger.debug("ClineProvider", "Failed to read parent cline messages", error)
		parentClineMessages = []
	}

	let parentApiMessages: ApiMessage[] = []
	try {
		parentApiMessages = await readApiMessages({
			taskId: parentTaskId,
			globalStoragePath,
		})
	} catch (error) {
		logger.debug("ClineProvider", "Failed to read parent api messages", error)
		parentApiMessages = []
	}

	// 2) Inject synthetic records: UI subtask_result and update API tool_result
	const ts = Date.now()

	// Defensive: ensure arrays
	if (!Array.isArray(parentClineMessages)) parentClineMessages = []
	if (!Array.isArray(parentApiMessages)) parentApiMessages = []

	const subtaskUiMessage: ClineMessage = {
		type: "say",
		say: "subtask_result",
		text: completionResultSummary,
		ts,
		id: crypto.randomUUID(),
	}
	parentClineMessages.push(subtaskUiMessage)
	await saveTaskMessages({ messages: parentClineMessages, taskId: parentTaskId, globalStoragePath })

	appendDelegationCompletionToApiMessages(parentApiMessages, childTaskId, completionResultSummary)

	await saveApiMessages({ messages: parentApiMessages, taskId: parentTaskId, globalStoragePath })

	// 3) Close child instance if still open. The paused parent remains below it.
	//    This MUST happen BEFORE updating the child's status to "completed" because
	//    stack.pop() → abortTask(true) → saveClineMessages() writes
	//    the historyItem with initialStatus (typically "active"), which would
	//    overwrite a "completed" status set earlier.
	const current = provider.getCurrentTask()
	const completedChildAgentType = current?.agentType
	const completedChildPolicy = current?.cangjieRuntimePolicy
	const completedChildRuntimeSnapshot = completedChildPolicy?.getEvalRuntimeSnapshot()
	const completedChildBuildOutput = completedChildPolicy?.getRecentBuildFailureOutput()
	if (current?.taskId === childTaskId) {
		await provider.stack.pop()
	}

	// 4) Update child metadata to "completed" status.
	//    This runs after the abort so it overwrites the stale "active" status
	//    that saveClineMessages() may have written during step 3.
	try {
		const { historyItem: childHistory } = await provider.getTaskWithId(childTaskId)
		await provider.updateTaskHistory({
			...childHistory,
			status: "completed",
		})
	} catch (err) {
		provider.log(
			`[reopenParentFromDelegation] Failed to persist child completed status for ${childTaskId}: ${
				(err as Error)?.message ?? String(err)
			}`,
		)
	}

	// 5) Update parent metadata and persist BEFORE emitting completion event
	const childIds = Array.from(new Set([...(historyItem.childIds ?? []), childTaskId]))
	const updatedHistory: typeof historyItem = {
		...historyItem,
		status: "active",
		completedByChildId: childTaskId,
		completionResultSummary,
		awaitingChildId: undefined,
		childIds,
	}
	await provider.updateTaskHistory(updatedHistory)

	// 6) Emit TaskDelegationCompleted (provider-level)
	try {
		provider.emit(NJUST_AIEventName.TaskDelegationCompleted, parentTaskId, childTaskId, completionResultSummary)
	} catch (error) {
		// non-fatal
		logger.warn("ClineProvider", "TaskDelegationCompleted event emission failed", error)
		TelemetryService.reportError(error, TelemetryEventName.WEBVIEW_ERROR)
	}

	// 7) Reuse the in-memory parent left on the stack. The fallback supports older
	//    persisted delegations created when the parent was disposed before spawning.
	const stackedParent = provider.getCurrentTask()
	const parentInstance =
		stackedParent?.taskId === parentTaskId
			? stackedParent
			: await provider.createTaskWithHistoryItem(updatedHistory, { startTask: false })

	if (
		parentInstance &&
		completedChildAgentType === "CangjieVerify" &&
		completedChildRuntimeSnapshot?.recentBuildCommand
	) {
		parentInstance.cangjieRuntimePolicy.noteBuildResult(
			completedChildRuntimeSnapshot.recentBuildCommand,
			completedChildRuntimeSnapshot.recentBuildSucceeded && !completedChildRuntimeSnapshot.recentBuildFailed,
			completedChildBuildOutput ?? completionResultSummary,
		)
	}

	// 8) The child can finish before the parent's delegation stream has fully
	//    unwound. Wait for that old loop to park before starting the resumed one;
	//    otherwise both loops mutate the same message buffers concurrently.
	if (parentInstance) {
		await parentInstance.waitForTaskLoopIdle?.()
	}

	// 9) Inject restored histories into the in-memory instance before resuming
	if (parentInstance) {
		try {
			await parentInstance.overwriteClineMessages(parentClineMessages)
		} catch (error) {
			// non-fatal
			logger.warn("ClineProvider", "overwriteClineMessages failed", error)
			TelemetryService.reportError(error, TelemetryEventName.WEBVIEW_ERROR)
		}
		try {
			await parentInstance.overwriteApiConversationHistory(parentApiMessages)
		} catch (error) {
			// non-fatal
			logger.warn("ClineProvider", "overwriteApiConversationHistory failed", error)
			TelemetryService.reportError(error, TelemetryEventName.WEBVIEW_ERROR)
		}

		// Auto-resume parent without ask("resume_task")
		await parentInstance.resumeAfterDelegation()
	}

	// 10) Emit TaskDelegationResumed (provider-level)
	try {
		provider.emit(NJUST_AIEventName.TaskDelegationResumed, parentTaskId, childTaskId)
	} catch (error) {
		// non-fatal
		logger.warn("ClineProvider", "TaskDelegationResumed event emission failed", error)
		TelemetryService.reportError(error, TelemetryEventName.WEBVIEW_ERROR)
	}
}
