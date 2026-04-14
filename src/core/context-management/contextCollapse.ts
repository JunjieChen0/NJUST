import { ApiMessage } from "../task-persistence/apiMessages"

export type ContextCollapseResult = {
	messages: ApiMessage[]
	collapsed: boolean
}

/**
 * Zero-cost coarse collapse for old conversation ranges.
 * Keeps the first message + recent tail, replacing middle with one summary marker.
 */
export function contextCollapseMessages(
	messages: ApiMessage[],
	options: { contextPercent: number; triggerPercent?: number; keepRecentMessages?: number },
): ContextCollapseResult {
	const trigger = options.triggerPercent ?? 70
	if (messages.length < 18 || options.contextPercent < trigger) {
		return { messages, collapsed: false }
	}

	const keepRecent = Math.max(8, options.keepRecentMessages ?? 14)
	const head = messages[0]
	const tail = messages.slice(Math.max(1, messages.length - keepRecent))
	const collapsedRounds = Math.max(0, messages.length - 1 - tail.length)
	// Choose marker role to avoid consecutive same-role messages with head.
	// API requires alternating user/assistant roles.
	const markerRole = head.role === "user" ? "assistant" : "user"
	const marker: ApiMessage = {
		role: markerRole,
		content: `[Context collapsed: archived ${collapsedRounds} earlier messages to preserve context budget. Keep using latest state and continue.]`,
		ts: Date.now(),
	}
	return { messages: [head, marker, ...tail], collapsed: true }
}
