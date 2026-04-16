/**
 * TaskCenter — Task stack management for ClineProvider.
 *
 * Phase 2: Owns the `clineStack` array and all stack-mutation methods
 * previously living inside ClineProvider. ClineProvider retains public
 * facade methods that delegate here.
 */
import type { HistoryItem } from "@njust-ai-cj/types"
import { NJUST_AI_CJEventName } from "@njust-ai-cj/types"

import type { TaskHostState } from "../task/interfaces/taskHostState"
import type { Task } from "../task/Task"
import { t } from "../../i18n"

/**
 * Registry for per-task event cleanup (matches WeakMap<Task, Array<() => void>> on ClineProvider).
 */
export interface TaskEventListenerRegistry {
	get(task: Task): Array<() => void> | undefined
	delete(task: Task): boolean
}

/**
 * Narrow contract the TaskCenter needs from ClineProvider.
 * Keeps the dependency unidirectional: TaskCenter → interface, not concrete class.
 */
export interface TaskCenterHost {
	performPreparationTasks(task: Task): Promise<void>
	getState(): Promise<TaskHostState>
	log(message: string): void
	getTaskWithId(taskId: string): Promise<{ historyItem: HistoryItem; taskDirPath: string }>
	updateTaskHistory(item: HistoryItem): Promise<void>
	taskEventListeners: TaskEventListenerRegistry
}

export class TaskCenter {
	/** The live task stack — LIFO order (top = current task). */
	readonly stack: Task[] = []

	constructor(private host: TaskCenterHost) {}

	// ── Stack queries ────────────────────────────────────────────────

	get size(): number {
		return this.stack.length
	}

	get current(): Task | undefined {
		return this.stack.length > 0 ? this.stack[this.stack.length - 1] : undefined
	}

	getCurrentTaskStack(): string[] {
		return this.stack.map((task) => task.taskId)
	}

	findByTaskId(taskId: string): Task | undefined {
		for (let i = this.stack.length - 1; i >= 0; i--) {
			if (this.stack[i].taskId === taskId) {
				return this.stack[i]
			}
		}
		return undefined
	}

	/** Get root task (bottom of stack). */
	get root(): Task | undefined {
		return this.stack.length > 0 ? this.stack[0] : undefined
	}

	// ── Stack mutations ──────────────────────────────────────────────

	async addClineToStack(task: Task): Promise<void> {
		this.stack.push(task)
		task.emit(NJUST_AI_CJEventName.TaskFocused)

		await this.host.performPreparationTasks(task)

		const state = await this.host.getState()
		if (!state || typeof state.mode !== "string") {
			throw new Error(t("common:errors.retrieve_current_mode"))
		}
	}

	async removeClineFromStack(options?: { skipDelegationRepair?: boolean }): Promise<void> {
		if (this.stack.length === 0) {
			return
		}

		let task = this.stack.pop()

		if (task) {
			const childTaskId = task.taskId
			const parentTaskId = task.parentTaskId

			task.emit(NJUST_AI_CJEventName.TaskUnfocused)

			try {
				await task.abortTask(true)
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e)
				this.host.log(
					`[TaskCenter#removeClineFromStack] abortTask() failed ${task.taskId}.${task.instanceId}: ${msg}`,
				)
			}

			const cleanupFunctions = this.host.taskEventListeners.get(task)
			if (cleanupFunctions) {
				cleanupFunctions.forEach((cleanup: () => void) => cleanup())
				this.host.taskEventListeners.delete(task)
			}

			task = undefined

			if (parentTaskId && childTaskId && !options?.skipDelegationRepair) {
				try {
					const { historyItem: parentHistory } = await this.host.getTaskWithId(parentTaskId)

					if (parentHistory.status === "delegated" && parentHistory.awaitingChildId === childTaskId) {
						await this.host.updateTaskHistory({
							...parentHistory,
							status: "active",
							awaitingChildId: undefined,
						})
						this.host.log(
							`[TaskCenter#removeClineFromStack] Repaired parent ${parentTaskId} metadata: delegated → active (child ${childTaskId} removed)`,
						)
					}
				} catch (err) {
					this.host.log(
						`[TaskCenter#removeClineFromStack] Failed to repair parent metadata for ${parentTaskId} (non-fatal): ${
							err instanceof Error ? err.message : String(err)
						}`,
					)
				}
			}
		}
	}

	/**
	 * Replace a task at a specific stack index (used during task rehydration).
	 */
	replaceAt(index: number, task: Task): void {
		this.stack[index] = task
	}
}
