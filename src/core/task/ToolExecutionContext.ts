import { AdaptiveConcurrencyController } from "../tools/AdaptiveConcurrencyController"
import { StreamingToolExecutor } from "../tools/StreamingToolExecutor"
import { ToolExecutionScheduler, ToolExecutionStats } from "./ToolExecutionOrchestrator"

/**
 * Groups tool execution primitives and adaptive concurrency so {@link Task} uses a single
 * disposal path for concurrency tuning (architecture round 2).
 */
export class ToolExecutionContext {
	readonly stats = new ToolExecutionStats()
	readonly concurrencyController = new AdaptiveConcurrencyController()
	readonly scheduler = new ToolExecutionScheduler()
	readonly streamingExecutor: StreamingToolExecutor

	/**
	 * Shared abort controller for sibling tool processes. When one tool in a
	 * concurrent batch fails (especially Bash), all siblings are signaled to
	 * abort, preventing wasted work.
	 *
	 * Reset between tool batches via resetSiblingAbortController().
	 */
	private _siblingAbortController: AbortController | null = null

	constructor(maxConcurrency: number) {
		const cap = Math.max(1, maxConcurrency) || 10
		this.streamingExecutor = new StreamingToolExecutor(cap, this.concurrencyController, this.scheduler)
	}

	/** Get or create the sibling abort controller for a new tool batch */
	getSiblingAbortController(): AbortController {
		if (!this._siblingAbortController || this._siblingAbortController.signal.aborted) {
			this._siblingAbortController = new AbortController()
		}
		return this._siblingAbortController
	}

	/** Signal all sibling tools in the current batch to abort */
	signalSiblingAbort(reason: string = "sibling_error"): void {
		const controller = this._siblingAbortController
		if (controller && !controller.signal.aborted) {
			controller.abort(reason)
		}
	}

	/** Check if sibling abort has been signaled */
	get isSiblingAborted(): boolean {
		return this._siblingAbortController?.signal.aborted ?? false
	}

	/** Reset for a new batch of tool executions */
	resetSiblingAbortController(): void {
		this._siblingAbortController = null
	}

	enableAdaptiveTuning(): void {
		this.concurrencyController.enableAutoTuning(this.stats)
	}

	recordToolErrorMetric(toolName: string): void {
		this.stats.record(toolName, 2500, true)
		this.concurrencyController.enableAutoTuning(this.stats)
	}

	/** Clean up all tool execution state. Called from Task.dispose. */
	dispose(): void {
		this.concurrencyController.disableAutoTuning()
		// Abort pending sibling to release registered abort listeners
		if (this._siblingAbortController && !this._siblingAbortController.signal.aborted) {
			this._siblingAbortController.abort("context_disposed")
		}
		this._siblingAbortController = null
		// Reset concurrency and drain pending waiters
		this.concurrencyController.reset()
		// Release accumulated metric references
		this.stats.reset()
	}
}
