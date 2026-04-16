/**
 * TaskMetrics — Collects execution metrics for a single task lifecycle.
 *
 * Tracks tool execution times, API latencies, error recovery counts,
 * concurrency levels, and context switches. Provides a summary report
 * for diagnostics and performance analysis.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TaskMetricsData {
	/** Tool name → array of execution durations in ms */
	toolExecutionTimes: Map<string, number[]>
	/** API request latencies in ms */
	apiLatencies: number[]
	/** Number of times context was compacted */
	contextSwitchCount: number
	/** Error kind → recovery count */
	errorRecoveryCounts: Map<string, number>
	/** Current concurrent tool executions */
	concurrentExecutions: number
	/** Maximum concurrent tool executions reached */
	maxConcurrencyReached: number
	/** Total tokens consumed */
	totalTokensUsed: number
	/** Cache hit rate (0-1) */
	cacheHitRate: number
	/** Task start time */
	startedAt: number
	/** Task end time */
	endedAt?: number
}

// ─── Collector ───────────────────────────────────────────────────────────────

export class TaskMetricsCollector {
	private metrics: TaskMetricsData = {
		toolExecutionTimes: new Map(),
		apiLatencies: [],
		contextSwitchCount: 0,
		errorRecoveryCounts: new Map(),
		concurrentExecutions: 0,
		maxConcurrencyReached: 0,
		totalTokensUsed: 0,
		cacheHitRate: 0,
		startedAt: Date.now(),
	}

	/**
	 * Record a tool execution duration.
	 */
	recordToolExecution(toolName: string, durationMs: number): void {
		let times = this.metrics.toolExecutionTimes.get(toolName)
		if (!times) {
			times = []
			this.metrics.toolExecutionTimes.set(toolName, times)
		}
		times.push(durationMs)
	}

	/**
	 * Record an API request latency.
	 */
	recordApiLatency(latencyMs: number): void {
		this.metrics.apiLatencies.push(latencyMs)
	}

	/**
	 * Record a context compaction event.
	 */
	recordContextSwitch(): void {
		this.metrics.contextSwitchCount++
	}

	/**
	 * Record an error recovery event.
	 */
	recordErrorRecovery(errorKind: string): void {
		const count = this.metrics.errorRecoveryCounts.get(errorKind) || 0
		this.metrics.errorRecoveryCounts.set(errorKind, count + 1)
	}

	/**
	 * Update the current concurrency level.
	 */
	updateConcurrency(current: number): void {
		this.metrics.concurrentExecutions = current
		this.metrics.maxConcurrencyReached = Math.max(this.metrics.maxConcurrencyReached, current)
	}

	/**
	 * Update total tokens used.
	 */
	updateTokensUsed(tokens: number): void {
		this.metrics.totalTokensUsed = tokens
	}

	/**
	 * Update cache hit rate.
	 */
	updateCacheHitRate(rate: number): void {
		this.metrics.cacheHitRate = rate
	}

	/**
	 * Mark the task as ended.
	 */
	markEnded(): void {
		this.metrics.endedAt = Date.now()
	}

	/**
	 * Get a copy of the current metrics.
	 */
	getMetrics(): Readonly<TaskMetricsData> {
		return { ...this.metrics }
	}

	/**
	 * Generate a human-readable execution report.
	 */
	exportReport(): string {
		const lines: string[] = []
		const elapsed = (this.metrics.endedAt || Date.now()) - this.metrics.startedAt

		lines.push("=== Task Execution Report ===")
		lines.push(`Duration: ${(elapsed / 1000).toFixed(1)}s`)
		lines.push(`Total API Requests: ${this.metrics.apiLatencies.length}`)

		if (this.metrics.apiLatencies.length > 0) {
			lines.push(`Avg API Latency: ${this.avg(this.metrics.apiLatencies).toFixed(0)}ms`)
			lines.push(`Max API Latency: ${Math.max(...this.metrics.apiLatencies).toFixed(0)}ms`)
		}

		lines.push(`Context Compactions: ${this.metrics.contextSwitchCount}`)
		lines.push(`Max Concurrency: ${this.metrics.maxConcurrencyReached}`)
		lines.push(`Total Tokens: ${this.metrics.totalTokensUsed}`)
		lines.push(`Cache Hit Rate: ${(this.metrics.cacheHitRate * 100).toFixed(1)}%`)

		if (this.metrics.toolExecutionTimes.size > 0) {
			lines.push("")
			lines.push("--- Tool Execution Summary ---")
			for (const [tool, times] of this.metrics.toolExecutionTimes) {
				lines.push(`  ${tool}: ${times.length} calls, avg ${this.avg(times).toFixed(0)}ms`)
			}
		}

		if (this.metrics.errorRecoveryCounts.size > 0) {
			lines.push("")
			lines.push("--- Error Recovery ---")
			for (const [kind, count] of this.metrics.errorRecoveryCounts) {
				lines.push(`  ${kind}: ${count} recoveries`)
			}
		}

		return lines.join("\n")
	}

	private avg(arr: number[]): number {
		if (arr.length === 0) return 0
		return arr.reduce((a, b) => a + b, 0) / arr.length
	}
}
