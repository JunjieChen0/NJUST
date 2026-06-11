/**
 * PerformanceAggregator — collects and reports per-task performance metrics.
 *
 * Hooks into ToolHookManager to track tool execution times, then reports
 * aggregated stats to TelemetryService when the task ends.
 *
 * Design: one instance per task lifecycle, registered on SessionStart,
 * reports on SessionEnd.
 */

import { TelemetryService } from "@njust-ai/telemetry"
import { ToolHookManager } from "../../core/tools/ToolHookManager"
import type { PreToolUseHook, PostToolUseHook, PostToolUseFailureHook } from "../../core/tools/toolHooks"
import { logger } from "../../shared/logger"

interface ToolTiming {
	tool: string
	durationMs: number
	timestamp: number
}

export class PerformanceAggregator {
	private toolTimings: ToolTiming[] = []
	private errorCount = 0
	private taskId: string
	private startedAt: number

	constructor(taskId: string) {
		this.taskId = taskId
		this.startedAt = Date.now()
	}

	/** Record a tool execution timing. */
	recordToolExecution(tool: string, durationMs: number): void {
		this.toolTimings.push({ tool, durationMs, timestamp: Date.now() })
	}

	/** Record a tool execution error. */
	recordError(): void {
		this.errorCount++
	}

	/** Report aggregated metrics to telemetry. Call on task completion. */
	report(): void {
		const totalDuration = Date.now() - this.startedAt
		const toolCount = this.toolTimings.length

		if (toolCount === 0) {
			return // Nothing to report
		}

		// Aggregate tool durations by name
		const byTool = new Map<string, { count: number; totalMs: number }>()
		let totalToolMs = 0
		for (const t of this.toolTimings) {
			const existing = byTool.get(t.tool) ?? { count: 0, totalMs: 0 }
			existing.count++
			existing.totalMs += t.durationMs
			byTool.set(t.tool, existing)
			totalToolMs += t.durationMs
		}

		// Find the slowest tool
		let slowestTool = ""
		let slowestToolMs = 0
		for (const [name, stats] of byTool) {
			const avg = stats.totalMs / stats.count
			if (avg > slowestToolMs) {
				slowestToolMs = avg
				slowestTool = name
			}
		}

		try {
			TelemetryService.instance.captureEvent("task.performance", {
				duration: totalDuration,
				toolDuration: totalToolMs,
				errorCount: this.errorCount,
				success: this.errorCount === 0,
				// Encode top-3 tools as comma-separated string (within allowed keys)
				tool: `${toolCount} calls, slowest=${slowestTool}(${Math.round(slowestToolMs)}ms)`,
			})
		} catch (error) {
			logger.warn("PerformanceAggregator", "Failed to report task performance:", error)
		}
	}

	/**
	 * Register as hook listeners on the given ToolHookManager.
	 * Returns a dispose function to unregister.
	 */
	static registerForTask(
		taskId: string,
		hookManager: ToolHookManager = ToolHookManager.instance,
	): PerformanceAggregator {
		const aggregator = new PerformanceAggregator(taskId)

		const toolStartTimes = new Map<string, number>()

		const preHook: PreToolUseHook = async (_toolName, _input, ctx) => {
			if (ctx.taskId !== taskId) return { allow: true }
			toolStartTimes.set(ctx.toolUseId, Date.now())
			return { allow: true }
		}

		const postHook: PostToolUseHook = async (toolName, _input, _result, ctx) => {
			if (ctx.taskId !== taskId) return
			const startTime = toolStartTimes.get(ctx.toolUseId)
			const durationMs = startTime ? Date.now() - startTime : 0
			toolStartTimes.delete(ctx.toolUseId)
			aggregator.recordToolExecution(toolName, durationMs)
		}

		const failureHook: PostToolUseFailureHook = async (_toolName, _input, _error, ctx) => {
			if (ctx.taskId !== taskId) return
			const startTime = toolStartTimes.get(ctx.toolUseId)
			if (startTime !== undefined) {
				toolStartTimes.delete(ctx.toolUseId)
			}
			aggregator.recordError()
		}

		hookManager.registerPreHook(preHook)
		hookManager.registerPostHook(postHook)
		hookManager.registerFailureHook(failureHook)

		return aggregator
	}
}
