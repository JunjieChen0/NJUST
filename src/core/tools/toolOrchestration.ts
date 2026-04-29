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
 * JSON.stringify with sorted keys so semantically identical objects
 * always produce the same string regardless of property insertion order.
 */
export function stableStringify(value: unknown): string {
	if (value === null || value === undefined) return ""
	if (typeof value !== "object") return String(value)
	if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]"
	const sorted = Object.keys(value as Record<string, unknown>)
		.sort()
		.reduce(
			(acc, k) => {
				const v = (value as Record<string, unknown>)[k]
				if (v !== undefined) acc[k] = v
				return acc
			},
			{} as Record<string, unknown>,
		)
	return JSON.stringify(sorted, (_k, v) => {
		if (v && typeof v === "object" && !Array.isArray(v)) {
			return Object.keys(v)
				.sort()
				.reduce(
					(a: Record<string, unknown>, key) => {
						a[key] = v[key]
						return a
					},
					{} as Record<string, unknown>,
				)
		}
		return v
	})
}

/**
 * Build a canonical dedupe key for a readonly tool call.
 * Uses only the fields that determine the semantic identity of the call,
 * so that key-order differences or extra undefined fields don't defeat dedup.
 */
function canonicalKeyForReadonlyTool(call: ToolUse): string {
	const args = (call.nativeArgs ?? call.params ?? {}) as Record<string, unknown>
	switch (call.name) {
		case "read_file":
			return `read_file:${args.path ?? ""}:${args.mode ?? ""}:${args.offset ?? ""}:${args.limit ?? ""}`
		case "list_files":
			return `list_files:${args.path ?? ""}:${args.recursive ?? ""}`
		case "search_files":
			return `search_files:${args.path ?? ""}:${args.regex ?? ""}:${args.file_pattern ?? ""}:${args.semantic_query ?? ""}`
		default:
			return `${call.name}:${stableStringify(args)}`
	}
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
		const key = canonicalKeyForReadonlyTool(call)
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
