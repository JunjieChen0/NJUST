/**
 * TaskLifecycle — Manages task initialization, resumption, and termination.
 *
 * Extracted from Task.ts to decompose the monolithic file.
 * Encapsulates lifecycle state transitions and validation logic.
 *
 * Phase 1: Standalone lifecycle utilities + LifecycleManager state machine.
 * Full extraction of `startTask` and `resumeTaskFromHistory` from Task.ts
 * is deferred to Phase 2.
 */

import type { ClineMessage, TaskStatus } from "@njust-ai-cj/types"
import { taskEventBus } from "../events/TaskEventBus"

// ─── Lifecycle States ────────────────────────────────────────────────────────

export enum LifecyclePhase {
	/** Task created but not yet initialized */
	CREATED = "created",
	/** Task is initializing (loading history, building context) */
	INITIALIZING = "initializing",
	/** Task is running (active API request loop) */
	RUNNING = "running",
	/** Task is paused (waiting for user input) */
	PAUSED = "paused",
	/** Task is resuming from saved state */
	RESUMING = "resuming",
	/** Task is being aborted */
	ABORTING = "aborting",
	/** Task has completed */
	COMPLETED = "completed",
	/** Task has errored */
	ERRORED = "errored",
}

// ─── History Message Cleanup ─────────────────────────────────────────────────

/**
 * Clean up stale messages from a saved message history for task resumption.
 * Removes trailing resume prompts, orphaned reasoning blocks, and
 * incomplete API request markers.
 *
 * @param messages - Saved cline messages from the previous session
 * @returns Cleaned messages ready for resumption display
 */
export function cleanHistoryForResumption(messages: ClineMessage[]): ClineMessage[] {
	const result = [...messages]

	// 1. Remove trailing resume messages
	while (result.length > 0) {
		const last = result[result.length - 1]
		if (last.ask === "resume_task" || last.ask === "resume_completed_task") {
			result.pop()
		} else {
			break
		}
	}

	// 2. Remove trailing reasoning-only UI messages
	while (result.length > 0) {
		const last = result[result.length - 1]
		if (last.type === "say" && last.say === "reasoning") {
			result.pop()
		} else {
			break
		}
	}

	// 3. Remove incomplete API request markers (no cost and no cancel reason)
	const lastApiReqIndex = findLastIndex(result, (m) => m.type === "say" && m.say === "api_req_started")

	if (lastApiReqIndex !== -1) {
		try {
			const info = JSON.parse(result[lastApiReqIndex].text || "{}")
			if (info.cost === undefined && info.cancelReason === undefined) {
				result.splice(lastApiReqIndex, 1)
			}
		} catch {
			// If we can't parse the JSON, leave it as-is
		}
	}

	return result
}

/**
 * Determine the appropriate resume ask type based on the last meaningful message.
 */
export function getResumeAskType(messages: ClineMessage[]): "resume_task" | "resume_completed_task" {
	const lastMeaningful = [...messages]
		.reverse()
		.find((m) => !(m.ask === "resume_task" || m.ask === "resume_completed_task"))

	return lastMeaningful?.ask === "completion_result" ? "resume_completed_task" : "resume_task"
}

// ─── Subtask Budget Checker ──────────────────────────────────────────────────

export interface SubtaskBudgetStatus {
	/** Whether the subtask is approaching its budget limit */
	isApproachingLimit: boolean
	/** Current token usage of the subtask */
	subtaskTokens: number
	/** Remaining budget from parent */
	parentRemaining: number
	/** Usage percentage of parent's remaining budget */
	usagePercent: number
}

/**
 * Check whether a subtask is approaching its parent's remaining token budget.
 */
export function checkSubtaskBudget(
	subtaskTokens: number,
	parentContextTokens: number,
	contextWindow: number,
	warningThreshold: number = 0.8,
): SubtaskBudgetStatus {
	const parentRemaining = contextWindow - parentContextTokens
	const usagePercent = parentRemaining > 0 ? subtaskTokens / parentRemaining : 1

	return {
		isApproachingLimit: usagePercent > warningThreshold,
		subtaskTokens,
		parentRemaining,
		usagePercent,
	}
}

// ─── Lifecycle State Machine ─────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<LifecyclePhase, LifecyclePhase[]> = {
	[LifecyclePhase.CREATED]: [LifecyclePhase.INITIALIZING],
	[LifecyclePhase.INITIALIZING]: [LifecyclePhase.RUNNING, LifecyclePhase.RESUMING, LifecyclePhase.ERRORED],
	[LifecyclePhase.RUNNING]: [LifecyclePhase.PAUSED, LifecyclePhase.ABORTING, LifecyclePhase.COMPLETED, LifecyclePhase.ERRORED],
	[LifecyclePhase.PAUSED]: [LifecyclePhase.RUNNING, LifecyclePhase.ABORTING, LifecyclePhase.COMPLETED],
	[LifecyclePhase.RESUMING]: [LifecyclePhase.RUNNING, LifecyclePhase.ABORTING, LifecyclePhase.ERRORED],
	[LifecyclePhase.ABORTING]: [LifecyclePhase.COMPLETED],
	[LifecyclePhase.COMPLETED]: [],
	[LifecyclePhase.ERRORED]: [LifecyclePhase.INITIALIZING],
}

/**
 * Manages lifecycle phase transitions for a single Task instance.
 * Validates transitions, emits events via the global TaskEventBus,
 * and exposes the current phase for read-only inspection.
 */
export class TaskLifecycleManager {
	private _phase: LifecyclePhase = LifecyclePhase.CREATED
	private readonly taskId: string

	constructor(taskId: string) {
		this.taskId = taskId
	}

	get phase(): LifecyclePhase {
		return this._phase
	}

	get isTerminal(): boolean {
		return this._phase === LifecyclePhase.COMPLETED || this._phase === LifecyclePhase.ERRORED
	}

	/**
	 * Transition to a new phase. Throws if the transition is invalid.
	 */
	transition(next: LifecyclePhase): void {
		const allowed = VALID_TRANSITIONS[this._phase]
		if (!allowed.includes(next)) {
			throw new Error(
				`[TaskLifecycle] Invalid transition ${this._phase} → ${next} for task ${this.taskId}`,
			)
		}
		const prev = this._phase
		this._phase = next

		const eventMap: Partial<Record<LifecyclePhase, "task:started" | "task:completed" | "task:failed" | "task:aborted">> = {
			[LifecyclePhase.RUNNING]: "task:started",
			[LifecyclePhase.COMPLETED]: "task:completed",
			[LifecyclePhase.ERRORED]: "task:failed",
			[LifecyclePhase.ABORTING]: "task:aborted",
		}
		const eventName = eventMap[next]
		if (eventName) {
			taskEventBus.emit(eventName, { taskId: this.taskId, data: { from: prev, to: next } })
		}
	}

	/**
	 * Try to transition; return false (without throwing) if invalid.
	 */
	tryTransition(next: LifecyclePhase): boolean {
		if (!VALID_TRANSITIONS[this._phase].includes(next)) {
			return false
		}
		this.transition(next)
		return true
	}
}

// ─── Dispose Helpers ─────────────────────────────────────────────────────────

/**
 * Execute a cleanup function, catching and logging any error to prevent
 * one failing dispose step from blocking subsequent steps.
 */
export function safeDispose(label: string, fn: () => void): void {
	try {
		fn()
	} catch (error) {
		console.error(`Error during dispose (${label}):`, error)
	}
}

// ─── Private Helpers ─────────────────────────────────────────────────────────

function findLastIndex<T>(array: T[], predicate: (item: T) => boolean): number {
	for (let i = array.length - 1; i >= 0; i--) {
		if (predicate(array[i])) {
			return i
		}
	}
	return -1
}
