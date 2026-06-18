import { useEffect, useRef, useState } from "react"
import { Text } from "ink"

/**
 * Punctuation characters at which the stepper "snaps" forward, matching
 * OpenCode's `TEXT_RENDER_SNAP` heuristic. Stepping stops mid-word and
 * jumps to the next whitespace/punctuation boundary for a smoother feel.
 */
const SNAP_RE = /[\s.,!?;:)\]]/

/**
 * Frame interval (ms) between reveal steps. OpenCode uses 24ms; we keep
 * the same value so streaming feels equivalently paced.
 */
const STEP_INTERVAL_MS = 24

/**
 * Computes the reveal step size based on how much text remains to show.
 * Mirrors OpenCode's `step()`:
 *   ≤12 chars remaining → 2
 *   ≤48 chars remaining → 4
 *   ≤96 chars remaining → 8
 *   otherwise           → min(24, ceil(remaining/8))
 */
function stepSize(remaining: number): number {
	if (remaining <= 12) return 2
	if (remaining <= 48) return 4
	if (remaining <= 96) return 8
	return Math.min(24, Math.ceil(remaining / 8))
}

export interface StreamingTextProps {
	/** Full content for the message (may grow as new chunks arrive). */
	content: string
	/** When true, characters are revealed progressively (typewriter). */
	isStreaming: boolean
	/** Color passed through to the underlying <Text>. Defaults to undefined. */
	color?: string
	/** Frame interval in ms. Defaults to 24. */
	intervalMs?: number
}

/**
 * `<StreamingText>` — typewriter-style progressive text reveal.
 *
 * Mirrors OpenCode's streaming markdown pacing. OpenCode delegates the
 * actual animation to `@opentui/core`'s `streaming={true}` prop on its
 * `<markdown>`/`<code>` elements; Ink has no equivalent, so we drive the
 * reveal from a component-local interval that consumes the full content
 * and reveals characters in `step()`-sized chunks snapped at punctuation.
 *
 * Key behaviors:
 * - When `isStreaming === false`, the full content is shown synchronously
 *   on the very first render (no waiting for an effect to fire).
 * - When a new chunk extends the content, the reveal continues from the
 *   current position (no "rewind"), avoiding visual jitter from the
 *   store's 150ms streaming debounce.
 * - When streaming finishes, any remaining hidden tail is revealed at
 *   once (no orphaned text).
 */
export function StreamingText({ content, isStreaming, color, intervalMs = STEP_INTERVAL_MS }: StreamingTextProps) {
	// Initialize visibleChars to the full content length when not streaming,
	// so the first render shows everything without waiting for an effect.
	const [visibleChars, setVisibleChars] = useState<number>(() => (isStreaming ? 0 : content.length))
	// Tracks the longest content we've started revealing so that shrinking
	// content (which shouldn't happen in practice) never moves the cursor
	// backwards.
	const maxSeenRef = useRef(isStreaming ? 0 : content.length)

	useEffect(() => {
		if (!isStreaming) {
			// Streaming finished (or never started) — reveal the tail at once.
			setVisibleChars(content.length)
			maxSeenRef.current = content.length
			return
		}

		// Nothing new to reveal yet.
		if (content.length <= maxSeenRef.current) {
			return
		}

		const target = content.length
		const timer = setInterval(() => {
			setVisibleChars((prev) => {
				if (prev >= target) {
					clearInterval(timer)
					return prev
				}
				const remaining = target - prev
				let next = Math.min(target, prev + stepSize(remaining))
				// Snap forward to the next punctuation boundary so we don't
				// pause mid-word (looks choppy).
				while (next < target && !SNAP_RE.test(content[next] ?? "")) {
					next += 1
				}
				maxSeenRef.current = Math.max(maxSeenRef.current, next)
				return next
			})
		}, intervalMs)

		return () => clearInterval(timer)
	}, [content, isStreaming, intervalMs])

	// Clamp to content length so we never slice past the end (e.g. when
	// content shrinks between renders).
	const slice = content.slice(0, Math.min(visibleChars, content.length))
	return <Text color={color}>{slice}</Text>
}
