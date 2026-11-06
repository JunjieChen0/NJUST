import type { Task } from "../task/Task"
import { saveTaskMessages } from "../task-persistence"
import * as vscode from "vscode"
import pWaitFor from "p-wait-for"
import { t } from "../../i18n"
import { logger } from "../../shared/logger"
import { getErrorMessage } from "../../shared/error-utils"
import { TelemetryEventName } from "@njust-ai/types"
import type { HistoryItem } from "@njust-ai/types"
import { TelemetryService } from "@njust-ai/telemetry"

export interface ICheckpointRestoreHost {
	setPendingEditOperation(
		operationId: string,
		editData: {
			messageTs: number
			editedContent: string
			images?: string[]
			messageIndex: number
			apiConversationHistoryIndex: number
		},
	): void
	readonly contextProxy: { globalStorageUri: { fsPath: string } }
	getTaskWithId(id: string): Promise<{ historyItem: HistoryItem }>
	createTaskWithHistoryItem(historyItem: HistoryItem): Promise<Task | undefined>
	getCurrentTask(): Task | undefined
}

export interface CheckpointRestoreConfig {
	provider: ICheckpointRestoreHost
	currentCline: Task
	messageTs: number
	messageIndex: number
	checkpoint: { hash: string }
	operation: "delete" | "edit"
	editData?: {
		editedContent: string
		images?: string[]
		apiConversationHistoryIndex: number
	}
}

/** Stop all known writers before touching workspace files. A timeout is a failure, not permission to restore. */
export async function stopTaskForCheckpointRestore(task: Task): Promise<void> {
	const { TerminalRegistry } = await import("../../integrations/terminal/TerminalRegistry")
	const terminals = TerminalRegistry.getTerminals(true, task.taskId)
	task.cancelCurrentRequest()
	for (const terminal of terminals) terminal.process?.abort()
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		await Promise.race([
			(async () => {
				await task.abortTask()
				await task.waitForTaskLoopIdle()
				await task.waitForCheckpointCleanup()
				await pWaitFor(() => terminals.every((terminal) => !terminal.busy && !terminal.running), {
					timeout: { milliseconds: 5_000, message: new Error(t("common:errors.checkpoint_cancel_failed")) },
				})
			})(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error(t("common:errors.checkpoint_cancel_failed"))), 10_000)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

export async function handleCheckpointRestoreOperation(config: CheckpointRestoreConfig): Promise<void> {
	const { provider, currentCline, messageTs, checkpoint, operation, editData } = config

	try {
		await stopTaskForCheckpointRestore(currentCline)
		if (provider.getCurrentTask() !== currentCline) throw new Error(t("common:errors.checkpoint_task_changed"))

		await currentCline.checkpointRestore({
			ts: messageTs,
			commitHash: checkpoint.hash,
			mode: "restore",
			operation,
		})

		if (operation === "edit" && editData) {
			const operationId = `task-${currentCline.taskId}`
			provider.setPendingEditOperation(operationId, {
				messageTs,
				editedContent: editData.editedContent,
				images: editData.images,
				messageIndex: config.messageIndex,
				apiConversationHistoryIndex: editData.apiConversationHistoryIndex,
			})
		}

		if (operation === "delete") {
			await saveTaskMessages({
				messages: currentCline.clineMessages,
				taskId: currentCline.taskId,
				globalStoragePath: provider.contextProxy.globalStorageUri.fsPath,
			})
		}
		const { historyItem } = await provider.getTaskWithId(currentCline.taskId)
		await provider.createTaskWithHistoryItem(historyItem)
	} catch (error) {
		logger.error("CheckpointRestore", `Error in checkpoint restore (${operation}):`, error)
		TelemetryService.reportError(error, TelemetryEventName.CHECKPOINT_ERROR)
		vscode.window.showErrorMessage(`Error during checkpoint restore: ${getErrorMessage(error)}`)
		throw error
	}
}

export async function waitForClineInitialization(
	provider: ICheckpointRestoreHost,
	timeoutMs: number = 3000,
): Promise<boolean> {
	try {
		await pWaitFor(() => provider.getCurrentTask()?.isInitialized === true, {
			timeout: timeoutMs,
		})
		return true
	} catch (_error) {
		logger.error("CheckpointRestore", "Initialization timeout:", _error)
		vscode.window.showErrorMessage(t("common:errors.checkpoint_timeout"))
		return false
	}
}
