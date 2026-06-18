import { memo, useEffect, useState } from "react"
import { Text } from "ink"

import { useTheme } from "../theme.js"

/**
 * Braille-dot spinner frames — same set OpenCode uses (and what `LoadingText`
 * historically used). 10 frames, ~80ms tick = ~800ms full revolution.
 *
 * Note: opentui-spinner upstream is 12 frames; we use the 10-frame variant
 * because the visual difference is imperceptible at terminal cell sizes and
 * the 10-frame set is what was already shipping.
 */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

const DEFAULT_INTERVAL_MS = 80

export interface SpinnerProps {
	/** Override the color (CSS hex). Defaults to `theme.primary`. */
	color?: string
	/** Frame interval in ms. Defaults to 80. */
	intervalMs?: number
}

/**
 * `<Spinner>` — animated braille dot.
 *
 * Stand-alone replacement for OpenCode's `<spinner>` component (their version
 * is OpenTUI-specific and uses a Knight-Rider gradient). Ink can't replicate
 * the gradient sweep cheaply, so we just render the current frame in
 * `theme.primary` — visually close at small sizes.
 */
export const Spinner = memo(function Spinner({ color, intervalMs = DEFAULT_INTERVAL_MS }: SpinnerProps) {
	const theme = useTheme()
	const [frame, setFrame] = useState(0)

	useEffect(() => {
		const id = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), intervalMs)
		return () => clearInterval(id)
	}, [intervalMs])

	return <Text color={color ?? theme.primary}>{SPINNER_FRAMES[frame]}</Text>
})
