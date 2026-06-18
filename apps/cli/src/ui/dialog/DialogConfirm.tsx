import { Box, Text, useInput } from "ink"
import { useState } from "react"

import { useTheme } from "../theme.js"

import { DialogShell } from "./DialogShell.js"

export interface DialogConfirmProps {
	title: string
	message: string
	confirmLabel?: string
	cancelLabel?: string
	onConfirm: () => void
	onCancel: () => void
	/** When true, focus starts on Cancel rather than Confirm. */
	defaultCancel?: boolean
}

/**
 * `<DialogConfirm>` — two-button confirm dialog.
 *
 * Mirrors OpenCode `dialog-confirm.tsx`: left/right toggles selection, Enter
 * confirms the selected button, Esc cancels (handled by DialogHost too).
 */
export function DialogConfirm({
	title,
	message,
	confirmLabel = "Confirm",
	cancelLabel = "Cancel",
	onConfirm,
	onCancel,
	defaultCancel = false,
}: DialogConfirmProps) {
	const theme = useTheme()
	const [active, setActive] = useState<"confirm" | "cancel">(defaultCancel ? "cancel" : "confirm")

	useInput((_input, key) => {
		if (key.leftArrow || key.rightArrow || key.tab) {
			setActive((a) => (a === "confirm" ? "cancel" : "confirm"))
			return
		}
		if (key.return) {
			if (active === "confirm") onConfirm()
			else onCancel()
		}
	})

	const button = (kind: "cancel" | "confirm", label: string) => {
		const isActive = kind === active
		return (
			<Box paddingLeft={2} paddingRight={2}>
				<Text
					backgroundColor={isActive ? theme.primary : undefined}
					color={isActive ? theme.selectedListItemText : theme.textMuted}
				>
					{label}
				</Text>
			</Box>
		)
	}

	return (
		<DialogShell title={title}>
			<Box marginBottom={1}>
				<Text color={theme.textMuted} wrap="wrap">
					{message}
				</Text>
			</Box>
			<Box flexDirection="row" justifyContent="flex-end" gap={1}>
				{button("cancel", cancelLabel)}
				{button("confirm", confirmLabel)}
			</Box>
		</DialogShell>
	)
}
