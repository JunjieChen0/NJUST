export enum TaskState {
	IDLE = "IDLE",
	PREPARING = "PREPARING",
	STREAMING = "STREAMING",
	PROCESSING_TOOLS = "PROCESSING_TOOLS",
	COMPACTING = "COMPACTING",
	RECOVERING_MAX_TOKENS = "RECOVERING_MAX_TOKENS",
	WAITING_APPROVAL = "WAITING_APPROVAL",
	COMPLETED = "COMPLETED",
	ERROR = "ERROR",
}

const ALLOWED_TRANSITIONS: Record<TaskState, ReadonlySet<TaskState>> = {
	[TaskState.IDLE]: new Set([TaskState.PREPARING, TaskState.ERROR, TaskState.COMPLETED]),
	[TaskState.PREPARING]: new Set([TaskState.STREAMING, TaskState.COMPACTING, TaskState.ERROR]),
	[TaskState.STREAMING]: new Set([
		TaskState.PROCESSING_TOOLS,
		TaskState.COMPACTING,
		TaskState.RECOVERING_MAX_TOKENS,
		TaskState.WAITING_APPROVAL,
		TaskState.COMPLETED,
		TaskState.ERROR,
	]),
	[TaskState.PROCESSING_TOOLS]: new Set([
		TaskState.PREPARING,
		TaskState.WAITING_APPROVAL,
		TaskState.ERROR,
	]),
	[TaskState.COMPACTING]: new Set([TaskState.PREPARING, TaskState.ERROR]),
	[TaskState.RECOVERING_MAX_TOKENS]: new Set([TaskState.PREPARING, TaskState.ERROR]),
	[TaskState.WAITING_APPROVAL]: new Set([TaskState.PREPARING, TaskState.ERROR, TaskState.COMPLETED]),
	[TaskState.COMPLETED]: new Set([]),
	[TaskState.ERROR]: new Set([]),
}

export class TaskStateMachine {
	private _state: TaskState = TaskState.IDLE

	get state(): TaskState {
		return this._state
	}

	canTransition(to: TaskState): boolean {
		return ALLOWED_TRANSITIONS[this._state].has(to)
	}

	transition(to: TaskState): void {
		if (!this.canTransition(to)) {
			throw new Error(`Invalid task state transition: ${this._state} -> ${to}`)
		}
		this._state = to
	}

	force(to: TaskState): void {
		this._state = to
	}
}
