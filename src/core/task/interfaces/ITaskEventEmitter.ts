/**
 * Minimal task event emission surface (domain events, not VS Code EventEmitter).
 * Task or lifecycle manager may implement; consumers subscribe for telemetry/tests.
 */
export type TaskEventCallback<T = unknown> = (payload: T) => void

export interface ITaskEventEmitter {
	emitTaskStarted(taskId: string): void
	emitTaskCompleted(taskId: string, success: boolean): void
	emitTaskAborted(taskId: string, reason?: string): void
}
