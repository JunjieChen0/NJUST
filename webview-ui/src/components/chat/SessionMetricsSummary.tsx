import { memo, useMemo, useState } from "react"

import { useExtensionState } from "@src/context/ExtensionStateContext"

const SessionMetricsSummary = () => {
	const { taskMetricsHistory, currentTaskItem } = useExtensionState()
	const [scope, setScope] = useState<"task" | "session">("task")

	const summary = useMemo(() => {
		const allRows = taskMetricsHistory ?? []
		const rows =
			scope === "task" && currentTaskItem?.id
				? allRows.filter((r) => r.taskId === currentTaskItem.id)
				: allRows
		if (rows.length === 0) {
			return null
		}
		const count = rows.length
		const avgCacheHit = rows.reduce((sum, r) => sum + r.cacheHitRate, 0) / count
		const avgSaved = rows.reduce((sum, r) => sum + r.estimatedSavingsPercent, 0) / count
		const avgLatency = rows.reduce((sum, r) => sum + r.latencyMs, 0) / count
		const totalInput = rows.reduce((sum, r) => sum + r.inputTokens, 0)
		const totalOutput = rows.reduce((sum, r) => sum + r.outputTokens, 0)
		const latest = rows[rows.length - 1]
		const breakBySource = latest?.cacheBreaksBySource ?? {}
		const topBreak = Object.entries(breakBySource).sort((a, b) => b[1] - a[1])[0]
		return {
			count,
			avgCacheHit,
			avgSaved,
			avgLatency,
			totalInput,
			totalOutput,
			cacheBreaksTotal: latest?.cacheBreaksTotal ?? 0,
			topBreakSource: topBreak?.[0] ?? "none",
			topBreakCount: topBreak?.[1] ?? 0,
			breakBySource,
		}
	}, [taskMetricsHistory, scope, currentTaskItem?.id])

	if (!summary) {
		return null
	}

	const breakDetailsTitle = Object.entries(summary.breakBySource)
		.filter(([, count]) => Number(count) > 0)
		.sort((a, b) => Number(b[1]) - Number(a[1]))
		.map(([source, count]) => `${source}: ${count}`)
		.join("\n")

	return (
		<div className="mx-3 mt-2 px-3 py-2 rounded-lg border border-vscode-inputOption-activeBorder/40 bg-vscode-input-background text-xs text-vscode-descriptionForeground flex flex-wrap gap-3">
			<div className="flex items-center gap-1 mr-2">
				<button
					onClick={() => setScope("task")}
					className={`px-2 py-0.5 rounded border ${scope === "task" ? "border-vscode-inputOption-activeBorder text-vscode-foreground" : "border-vscode-panel-border"}`}>
					Task
				</button>
				<button
					onClick={() => setScope("session")}
					className={`px-2 py-0.5 rounded border ${scope === "session" ? "border-vscode-inputOption-activeBorder text-vscode-foreground" : "border-vscode-panel-border"}`}>
					Session
				</button>
			</div>
			<span title="samples in selected scope">Samples {summary.count}</span>
			<span title="average cache hit rate">AvgCache {(summary.avgCacheHit * 100).toFixed(0)}%</span>
			<span title="average estimated savings">AvgSaved {summary.avgSaved.toFixed(1)}%</span>
			<span title="average request latency">AvgLatency {Math.round(summary.avgLatency)}ms</span>
			<span title="total input tokens">In {summary.totalInput.toLocaleString()}</span>
			<span title="total output tokens">Out {summary.totalOutput.toLocaleString()}</span>
			<span title="total prompt cache break events">Breaks {summary.cacheBreaksTotal}</span>
			<span title={breakDetailsTitle || "no cache breaks recorded"}>
				TopBreak {summary.topBreakSource} ({summary.topBreakCount})
			</span>
		</div>
	)
}

export default memo(SessionMetricsSummary)
