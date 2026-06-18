import { Box, Text, useInput } from "ink"

import { useTheme } from "../theme.js"

import { DialogShell } from "./DialogShell.js"

export interface DialogAlertProps {
	title: string
	message: string
	okLabel?: string
	onClose: () => void
}

/**
 * `<DialogAlert>` — single-button informational dialog.
 *
 * Pressing Enter (or Esc, handled by DialogHost) closes it.
 */
export function DialogAlert({ title, message, okLabel = "OK", onClose }: DialogAlertProps) {
	const theme = useTheme()

	useInput((_input, key) => {
		if (key.return) onClose()
	})

	return (
		<DialogShell title={title}>
			<Box marginBottom={1}>
				<Text color={theme.textMuted} wrap="wrap">
					{message}
				</Text>
			</Box>
			<Box justifyContent="flex-end">
				<Box paddingLeft={2} paddingRight={2}>
					<Text backgroundColor={theme.primary} color={theme.selectedListItemText}>
						{okLabel}
					</Text>
				</Box>
			</Box>
		</DialogShell>
	)
}
