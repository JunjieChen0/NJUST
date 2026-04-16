import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

import {
	type CreateTaskOptions,
	type HistoryItem,
	type NJUST_AI_CJSettings,
	NJUST_AI_CJEventName,
} from "@njust-ai-cj/types"
import type { ClineMessage, TodoItem } from "@njust-ai-cj/types"

import { Package } from "../../shared/package"
import { ProfileValidator } from "../../shared/ProfileValidator"

import { Task } from "../task/Task"
import {
	readApiMessages,
	readTaskMessages,
	saveApiMessages,
	saveTaskMessages,
} from "../task-persistence"
import { validateAndFixToolResultIds } from "../task/validateToolResultIds"

import { OrganizationAllowListViolationError } from "../../utils/errors"
import { t } from "../../i18n"

export class TaskDelegationManager {
	constructor(private host: any) {}

	async createTask(
		text?: string,
		images?: string[],
		parentTask?: Task,
		options: CreateTaskOptions = {},
		configuration: NJUST_AI_CJSettings = {},
	): Promise<Task> {
		const h = this.host

		if (configuration) {
			await h.setValues(configuration)

			if (configuration.allowedCommands) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update("allowedCommands", configuration.allowedCommands, vscode.ConfigurationTarget.Global)
			}

			if (configuration.deniedCommands) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update("deniedCommands", configuration.deniedCommands, vscode.ConfigurationTarget.Global)
			}

			if (configuration.commandExecutionTimeout !== undefined) {
				await vscode.workspace
					.getConfiguration(Package.name)
					.update(
						"commandExecutionTimeout",
						configuration.commandExecutionTimeout,
						vscode.ConfigurationTarget.Global,
					)
			}

			if (configuration.currentApiConfigName) {
				await h.setProviderProfile(configuration.currentApiConfigName)
			}

			if (configuration.customModes?.length) {
				for (const mode of configuration.customModes) {
					await h.customModesManager.updateCustomMode(mode.slug, mode)
				}
			}
		}

		const { apiConfiguration, organizationAllowList, enableCheckpoints, checkpointTimeout, experiments } =
			await h.getState()

		if (!parentTask) {
			try {
				await h.removeClineFromStack()
			} catch {
				// Non-fatal
			}
		}

		if (!ProfileValidator.isProfileAllowed(apiConfiguration, organizationAllowList)) {
			throw new OrganizationAllowListViolationError(t("common:errors.violated_organization_allowlist"))
		}

		const task = new Task({
			host: h,
			apiConfiguration,
			enableCheckpoints,
			checkpointTimeout,
			consecutiveMistakeLimit: apiConfiguration.consecutiveMistakeLimit,
			task: text,
			images,
			experiments,
			rootTask: h.clineStack.length > 0 ? h.clineStack[0] : undefined,
			parentTask,
			taskNumber: h.clineStack.length + 1,
			onCreated: h.taskCreationCallback,
			initialTodos: options.initialTodos,
			startTask: false,
			...options,
		})

		await h.addClineToStack(task)
		task.start()

		h.log(
			`[createTask] ${task.parentTask ? "child" : "parent"} task ${task.taskId}.${task.instanceId} instantiated`,
		)

		return task
	}

	async cancelTask(): Promise<void> {
		const h = this.host
		const task = h.getCurrentTask()

		if (!task) {
			return
		}

		console.log(`[cancelTask] cancelling task ${task.taskId}.${task.instanceId}`)

		let historyItem: HistoryItem | undefined
		try {
			const history = await h.getTaskWithId(task.taskId)
			historyItem = history.historyItem
		} catch (error) {
			if (error instanceof Error && error.message === "Task not found") {
				h.log(`[cancelTask] task history missing for ${task.taskId}; skipping rehydrate`)
			} else {
				throw error
			}
		}

		const rootTask = task.rootTask
		const parentTask = task.parentTask

		task.abortReason = "user_cancelled"

		const originalInstanceId = task.instanceId

		task.cancelCurrentRequest()

		task.abortTask()

		task.abandoned = true

		await pWaitFor(
			() =>
				h.getCurrentTask()! === undefined ||
				h.getCurrentTask()!.isStreaming === false ||
				h.getCurrentTask()!.didFinishAbortingStream ||
				h.getCurrentTask()!.isWaitingForFirstChunk,
			{
				timeout: 3_000,
			},
		).catch(() => {
			console.error("Failed to abort task")
		})

		const current = h.getCurrentTask()
		if (current && current.instanceId !== originalInstanceId) {
			h.log(
				`[cancelTask] Skipping rehydrate: current instance ${current.instanceId} != original ${originalInstanceId}`,
			)
			return
		}

		{
			const currentAfterCheck = h.getCurrentTask()
			if (currentAfterCheck && currentAfterCheck.instanceId !== originalInstanceId) {
				h.log(
					`[cancelTask] Skipping rehydrate after final check: current instance ${currentAfterCheck.instanceId} != original ${originalInstanceId}`,
				)
				return
			}
		}

		if (!historyItem) {
			return
		}

		await h.createTaskWithHistoryItem({ ...historyItem, rootTask, parentTask })
	}

	async clearTask(): Promise<void> {
		const h = this.host

		if (h.clineStack.length > 0) {
			const task = h.clineStack[h.clineStack.length - 1]
			console.log(`[clearTask] clearing task ${task.taskId}.${task.instanceId}`)
			await h.removeClineFromStack()
		}
	}

	async delegateParentAndOpenChild(params: {
		parentTaskId: string
		message: string
		initialTodos: TodoItem[]
		mode: string
		isolationLevel?: string
		forkedContextSummary?: string
	}): Promise<Task> {
		const h = this.host
		const { parentTaskId, message, initialTodos, mode, isolationLevel, forkedContextSummary } = params

		const parent = h.getCurrentTask()
		if (!parent) {
			throw new Error("[delegateParentAndOpenChild] No current task")
		}
		if (parent.taskId !== parentTaskId) {
			throw new Error(
				`[delegateParentAndOpenChild] Parent mismatch: expected ${parentTaskId}, current ${parent.taskId}`,
			)
		}

		try {
			const flushSuccess = await parent.flushPendingToolResultsToHistory()

			if (!flushSuccess) {
				console.warn(`[delegateParentAndOpenChild] Flush failed for parent ${parentTaskId}, retrying...`)
				const retrySuccess = await parent.retrySaveApiConversationHistory()

				if (!retrySuccess) {
					console.error(
						`[delegateParentAndOpenChild] CRITICAL: Parent ${parentTaskId} API history not persisted to disk. Child return may produce stale state.`,
					)
					vscode.window.showWarningMessage(
						"Warning: Parent task state could not be saved. The parent task may lose recent context when resumed.",
					)
				}
			}
		} catch (error) {
			h.log(
				`[delegateParentAndOpenChild] Error flushing pending tool results (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}

		try {
			await h.removeClineFromStack({ skipDelegationRepair: true })
		} catch (error) {
			h.log(
				`[delegateParentAndOpenChild] Error during parent disposal (non-fatal): ${
					error instanceof Error ? error.message : String(error)
				}`,
			)
		}

		try {
			await h.handleModeSwitch(mode as any)
		} catch (e: any) {
			h.log(
				`[delegateParentAndOpenChild] handleModeSwitch failed for mode '${mode}': ${
					(e as Error)?.message ?? String(e)
				}`,
			)
		}

		const child = await h.createTask(message, undefined, parent as any, {
			initialTodos,
			initialStatus: "active",
			startTask: false,
		})

		if (parent.cachedStreamingModel) {
			child.cachedStreamingModel = parent.cachedStreamingModel
		}

		let effectiveForkedSummary = forkedContextSummary
		if (isolationLevel === "forked" && !effectiveForkedSummary) {
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
			} catch (e: any) {
				h.log(
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

		try {
			const { historyItem } = await h.getTaskWithId(parentTaskId)
			const childIds = Array.from(new Set([...(historyItem.childIds ?? []), child.taskId]))
			const updatedHistory: typeof historyItem = {
				...historyItem,
				status: "delegated",
				delegatedToId: child.taskId,
				awaitingChildId: child.taskId,
				childIds,
			}
			await h.updateTaskHistory(updatedHistory)
		} catch (err: any) {
			h.log(
				`[delegateParentAndOpenChild] Failed to persist parent metadata for ${parentTaskId} -> ${child.taskId}: ${
					(err as Error)?.message ?? String(err)
				}`,
			)
		}

		child.start()

		try {
			h.emit(NJUST_AI_CJEventName.TaskDelegated, parentTaskId, child.taskId)
		} catch {
			// non-fatal
		}

		return child
	}

	async reopenParentFromDelegation(params: {
		parentTaskId: string
		childTaskId: string
		completionResultSummary: string
	}): Promise<void> {
		const h = this.host
		const { parentTaskId, childTaskId, completionResultSummary } = params
		const globalStoragePath = h.contextProxy.globalStorageUri.fsPath

		const { historyItem } = await h.getTaskWithId(parentTaskId)

		let parentClineMessages: ClineMessage[] = []
		try {
			parentClineMessages = await readTaskMessages({
				taskId: parentTaskId,
				globalStoragePath,
			})
		} catch {
			parentClineMessages = []
		}

		let parentApiMessages: any[] = []
		try {
			parentApiMessages = (await readApiMessages({
				taskId: parentTaskId,
				globalStoragePath,
			})) as any[]
		} catch {
			parentApiMessages = []
		}

		const ts = Date.now()

		if (!Array.isArray(parentClineMessages)) parentClineMessages = []
		if (!Array.isArray(parentApiMessages)) parentApiMessages = []

		const subtaskUiMessage: ClineMessage = {
			type: "say",
			say: "subtask_result",
			text: completionResultSummary,
			ts,
		}
		parentClineMessages.push(subtaskUiMessage)
		await saveTaskMessages({ messages: parentClineMessages, taskId: parentTaskId, globalStoragePath })

		let toolUseId: string | undefined
		for (let i = parentApiMessages.length - 1; i >= 0; i--) {
			const msg = parentApiMessages[i]
			if (msg.role === "assistant" && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (block.type === "tool_use" && block.name === "new_task") {
						toolUseId = block.id
						break
					}
				}
				if (toolUseId) break
			}
		}

		if (toolUseId) {
			const lastMsg = parentApiMessages[parentApiMessages.length - 1]
			let alreadyHasToolResult = false
			if (lastMsg?.role === "user" && Array.isArray(lastMsg.content)) {
				for (const block of lastMsg.content) {
					if (block.type === "tool_result" && block.tool_use_id === toolUseId) {
						block.content = `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`
						alreadyHasToolResult = true
						break
					}
				}
			}

			if (!alreadyHasToolResult) {
				parentApiMessages.push({
					role: "user",
					content: [
						{
							type: "tool_result" as const,
							tool_use_id: toolUseId,
							content: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
						},
					],
					ts,
				})
			}

			const lastMessage = parentApiMessages[parentApiMessages.length - 1]
			if (lastMessage?.role === "user") {
				const validatedMessage = validateAndFixToolResultIds(lastMessage, parentApiMessages.slice(0, -1))
				parentApiMessages[parentApiMessages.length - 1] = validatedMessage
			}
		} else {
			parentApiMessages.push({
				role: "user",
				content: [
					{
						type: "text" as const,
						text: `Subtask ${childTaskId} completed.\n\nResult:\n${completionResultSummary}`,
					},
				],
				ts,
			})
		}

		await saveApiMessages({ messages: parentApiMessages as any, taskId: parentTaskId, globalStoragePath })

		const current = h.getCurrentTask()
		if (current?.taskId === childTaskId) {
			await h.removeClineFromStack()
		}

		try {
			const { historyItem: childHistory } = await h.getTaskWithId(childTaskId)
			await h.updateTaskHistory({
				...childHistory,
				status: "completed",
			})
		} catch (err: any) {
			h.log(
				`[reopenParentFromDelegation] Failed to persist child completed status for ${childTaskId}: ${
					(err as Error)?.message ?? String(err)
				}`,
			)
		}

		const childIds = Array.from(new Set([...(historyItem.childIds ?? []), childTaskId]))
		const updatedHistory: typeof historyItem = {
			...historyItem,
			status: "active",
			completedByChildId: childTaskId,
			completionResultSummary,
			awaitingChildId: undefined,
			childIds,
		}
		await h.updateTaskHistory(updatedHistory)

		try {
			h.emit(NJUST_AI_CJEventName.TaskDelegationCompleted, parentTaskId, childTaskId, completionResultSummary)
		} catch {
			// non-fatal
		}

		const parentInstance = await h.createTaskWithHistoryItem(updatedHistory, { startTask: false })

		if (parentInstance) {
			try {
				await parentInstance.overwriteClineMessages(parentClineMessages)
			} catch {
				// non-fatal
			}
			try {
				await parentInstance.overwriteApiConversationHistory(parentApiMessages as any)
			} catch {
				// non-fatal
			}

			await parentInstance.resumeAfterDelegation()
		}

		try {
			h.emit(NJUST_AI_CJEventName.TaskDelegationResumed, parentTaskId, childTaskId)
		} catch {
			// non-fatal
		}
	}
}
