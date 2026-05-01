import { ApiMessage } from "../task-persistence/apiMessages"
import { ContextHierarchy, findTurnIndex, computeTurnSelfAttentionMean } from "./contextHierarchy"

export type SnipCompactOptions = {
	contextPercent: number
	triggerPercent?: number
	keepRecentMessages?: number
}

const DEFAULT_TRIGGER_PERCENT = 50
const DEFAULT_KEEP_RECENT_MESSAGES = 10

function compactLongText(text: string, maxChars: number = 600): string {
	if (text.length <= maxChars) return text
	const head = Math.floor(maxChars * 0.7)
	const tail = maxChars - head
	return `${text.slice(0, head)}\n...[snip compacted ${text.length - maxChars} chars]...\n${text.slice(-tail)}`
}

/**
 * Fast non-API compaction layer for old completed turns.
 * Phase-A keeps semantics conservative by compacting old long plain-text messages only.
 */
export function snipCompactMessages(
	messages: ApiMessage[],
	options: SnipCompactOptions,
	hierarchy?: ContextHierarchy,
): ApiMessage[] {
	const triggerPercent = options.triggerPercent ?? DEFAULT_TRIGGER_PERCENT
	if (messages.length === 0 || options.contextPercent < triggerPercent) return messages

	const keepRecent = options.keepRecentMessages ?? DEFAULT_KEEP_RECENT_MESSAGES
	const boundary = Math.max(0, messages.length - keepRecent)

	let changed = false
	const out = messages.map((m, idx) => {
		if (idx >= boundary) return m
		if (typeof m.content !== "string") return m

		// HCA: scale snip threshold by turn importance
		// High-importance turns: up to 1200 chars retained
		// Low-importance turns: as low as 300 chars retained
		let maxChars = 600
		if (hierarchy) {
			const turnIdx = findTurnIndex(hierarchy, idx)
			if (turnIdx >= 0) {
				const importance = computeTurnSelfAttentionMean(hierarchy, turnIdx)
				maxChars = Math.round(300 + importance * 900)
			}
		}

		const compacted = compactLongText(m.content, maxChars)
		if (compacted === m.content) return m
		changed = true
		return { ...m, content: compacted }
	})

	return changed ? out : messages
}
