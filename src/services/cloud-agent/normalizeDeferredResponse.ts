import type { DeferredResponse, DeferredToolCall } from "./types"

function pickNonEmptyString(...candidates: unknown[]): string | undefined {
	for (const v of candidates) {
		if (typeof v === "string" && v.trim().length > 0) {
			return v
		}
	}
	return undefined
}

function parseArgumentsField(raw: unknown): Record<string, unknown> {
	if (raw === undefined || raw === null) {
		return {}
	}
	if (typeof raw === "object" && !Array.isArray(raw)) {
		return raw as Record<string, unknown>
	}
	if (typeof raw === "string") {
		const s = raw.trim()
		if (!s) return {}
		try {
			const parsed = JSON.parse(s) as unknown
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>
			}
		} catch {
			return { _raw_arguments: s }
		}
	}
	return {}
}

/**
 * Parse one pending tool entry from either NJUST deferred shape or OpenAI-style `tool_calls[]`.
 */
export function parseDeferredToolCallItem(item: unknown): DeferredToolCall | null {
	if (!item || typeof item !== "object") {
		return null
	}
	const o = item as Record<string, unknown>

	const callId = pickNonEmptyString(o.call_id, o.id, o.tool_call_id)
	let tool = pickNonEmptyString(o.tool, o.name)
	let args = parseArgumentsField(o.arguments)

	const fn = o.function
	if (fn && typeof fn === "object") {
		const f = fn as Record<string, unknown>
		tool = tool ?? pickNonEmptyString(f.name)
		const fnArgs = f.arguments
		if (fnArgs !== undefined) {
			args = parseArgumentsField(fnArgs)
		}
	}

	if (!callId || !tool) {
		return null
	}
	return { call_id: callId, tool, arguments: args }
}

/**
 * Some servers send `tool_calls` (OpenAI-like) instead of `pending_tools`. Normalize so Task always
 * executes and resumes with matching counts.
 */
export function normalizeDeferredResponse(raw: unknown): DeferredResponse {
	if (!raw || typeof raw !== "object") {
		throw new Error("Cloud Agent: deferred response is not a JSON object")
	}
	const r = raw as DeferredResponse & { tool_calls?: unknown[] }

	const fromPending = Array.isArray(r.pending_tools)
		? r.pending_tools.map(parseDeferredToolCallItem).filter((x): x is DeferredToolCall => x !== null)
		: []

	let pending_tools = fromPending
	if (pending_tools.length === 0 && Array.isArray(r.tool_calls)) {
		pending_tools = r.tool_calls.map(parseDeferredToolCallItem).filter((x): x is DeferredToolCall => x !== null)
	}

	return { ...r, pending_tools }
}
