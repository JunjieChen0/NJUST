import { Text } from "ink"

import { useTheme } from "../theme.js"
import { Spinner } from "../chrome/Spinner.js"

/**
 * Lifecycle status of a tool message, mirroring OpenCode's `InlineTool`/
 * `BlockTool` status states.
 */
export type ToolStatus = "pending" | "running" | "done" | "error"

export interface ToolStatusIndicatorProps {
	status?: ToolStatus
	/**
	 * When `true` and `status === "running"`, render the animated braille
	 * spinner instead of the static `◐` glyph. Defaults to `true`.
	 */
	animated?: boolean
}

/**
 * `<ToolStatusIndicator>` — a single glyph (or spinner) that reflects the
 * lifecycle state of a tool message.
 *
 * Mirrors OpenCode's `InlineTool` icon + `Spinner` behavior:
 *   pending  → `⧗` (warning color)
 *   running  → animated `<Spinner>` (warning color)
 *   done     → `✓` (success color)
 *   error    → `✗` (error color)
 *   unknown  → nothing
 */
export function ToolStatusIndicator({ status, animated = true }: ToolStatusIndicatorProps) {
	const theme = useTheme()

	if (!status) return null

	switch (status) {
		case "pending":
			return <Text color={theme.warningColor}>⧗</Text>
		case "running":
			return animated ? (
				<Spinner color={theme.warningColor} />
			) : (
				<Text color={theme.warningColor}>◐</Text>
			)
		case "done":
			return <Text color={theme.successColor}>✓</Text>
		case "error":
			return <Text color={theme.errorColor}>✗</Text>
		default:
			return null
	}
}
