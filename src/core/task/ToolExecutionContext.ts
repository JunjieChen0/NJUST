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

	constructor(maxConcurrency: number) {
		const cap = Math.max(1, maxConcurrency) || 10
		this.streamingExecutor = new StreamingToolExecutor(cap, this.concurrencyController, this.scheduler)
	}

	enableAdaptiveTuning(): void {
		this.concurrencyController.enableAutoTuning(this.stats)
	}

	recordToolErrorMetric(toolName: string): void {
		this.stats.record(toolName, 2500, true)
		this.concurrencyController.enableAutoTuning(this.stats)
	}

	/** Single path for resetting adaptive concurrency (call from Task.dispose). */
	dispose(): void {
		this.concurrencyController.disableAutoTuning()
		this.concurrencyController.reset()
	}
}
