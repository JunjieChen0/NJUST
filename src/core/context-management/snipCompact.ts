import { ApiMessage } from "../task-persistence/apiMessages"

export type SnipCompactOptions = {
	contextPercent: number
	triggerPercent?: number
	keepRecentMessages?: number
}

const DEFAULT_TRIGGER_PERCENT = 50
const DEFAULT_KEEP_RECENT_MESSAGES = 10

function compactLongText(text: string): string {
	const max = 600
	if (text.length <= max) return text
	const head = Math.floor(max * 0.7)
	const tail = max - head
	return `${text.slice(0, head)}\n...[snip compacted ${text.length - max} chars]...\n${text.slice(-tail)}`
}

/**
 * Fast non-API compaction layer for old completed turns.
 * Phase-A keeps semantics conservative by compacting old long plain-text messages only.
 */
export function snipCompactMessages(messages: ApiMessage[], options: SnipCompactOptions): ApiMessage[] {
	const triggerPercent = options.triggerPercent ?? DEFAULT_TRIGGER_PERCENT
	if (messages.length === 0 || options.contextPercent < triggerPercent) return messages

	const keepRecent = options.keepRecentMessages ?? DEFAULT_KEEP_RECENT_MESSAGES
	const boundary = Math.max(0, messages.length - keepRecent)

	let changed = false
	const out = messages.map((m, idx) => {
		if (idx >= boundary) return m
		if (typeof m.content !== "string") return m
		const compacted = compactLongText(m.content)
		if (compacted === m.content) return m
		changed = true
		return { ...m, content: compacted }
	})

	return changed ? out : messages
}
