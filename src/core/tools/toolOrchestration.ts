import type { ToolUse } from "../../shared/tools"

export type ToolExecutionBatch = {
	mode: "parallel" | "serial"
	calls: ToolUse[]
}

export type ToolDedupResult = {
	uniqueCalls: ToolUse[]
	duplicateToOriginal: Map<string, string>
}

/**
 * Phase-B orchestration: partition tool calls into serial/parallel batches.
 * Only consecutive concurrency-safe calls are grouped into parallel batches.
 */
export function dedupeReadonlyToolCalls(calls: ToolUse[]): ToolDedupResult {
	const duplicateToOriginal = new Map<string, string>()
	const uniqueCalls: ToolUse[] = []
	const seen = new Map<string, string>()
	const readonlyTools = new Set(["read_file", "list_files", "search_files"])

	for (const call of calls) {
		if (!readonlyTools.has(call.name)) {
			uniqueCalls.push(call)
			continue
		}
		const key = `${call.name}:${JSON.stringify(call.nativeArgs ?? call.params ?? {})}`
		const firstId = seen.get(key)
		if (!firstId) {
			seen.set(key, call.id!)
			uniqueCalls.push(call)
			continue
		}
		duplicateToOriginal.set(call.id!, firstId)
	}

	return { uniqueCalls, duplicateToOriginal }
}

export function partitionToolCalls(
	calls: ToolUse[],
	isConcurrencySafe: (call: ToolUse) => boolean,
): ToolExecutionBatch[] {
	if (calls.length === 0) return []

	const batches: ToolExecutionBatch[] = []
	let i = 0
	while (i < calls.length) {
		const call = calls[i]
		if (!isConcurrencySafe(call)) {
			batches.push({ mode: "serial", calls: [call] })
			i++
			continue
		}
		const run: ToolUse[] = [call]
		let j = i + 1
		while (j < calls.length && isConcurrencySafe(calls[j])) {
			run.push(calls[j])
			j++
		}
		batches.push({ mode: run.length > 1 ? "parallel" : "serial", calls: run })
		i = j
	}

	return batches
}
