import { Box, Text } from "ink"
import type { PropsWithChildren, ReactNode } from "react"

import { useTheme } from "../theme.js"

export interface DialogShellProps {
	/** Bold title displayed at the top. */
	title?: string
	/** Right-side hint (typically `esc`). */
	hint?: ReactNode
	/** Optional sub-line below the title. */
	subtitle?: string
}

/**
 * `<DialogShell>` — common header/title chrome for dialog content.
 *
 * Mirrors OpenCode's title row: bold title on the left, muted `esc` hint on
 * the right, with a 1-line gap before children.
 */
export function DialogShell({
	title,
	hint = "esc",
	subtitle,
	children,
}: PropsWithChildren<DialogShellProps>) {
	const theme = useTheme()
	return (
		<Box flexDirection="column" paddingLeft={2} paddingRight={2}>
			{(title || hint) && (
				<Box flexDirection="row" justifyContent="space-between">
					<Text color={theme.text} bold>
						{title}
					</Text>
					<Text color={theme.textMuted}>{hint}</Text>
				</Box>
			)}
			{subtitle && (
				<Box>
					<Text color={theme.textMuted}>{subtitle}</Text>
				</Box>
			)}
			{(title || subtitle) && <Box height={1} />}
			{children}
		</Box>
	)
}
