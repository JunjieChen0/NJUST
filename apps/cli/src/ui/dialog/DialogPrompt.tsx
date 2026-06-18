import { Box, Text, useInput } from "ink"
import { useState } from "react"

import { useTheme } from "../theme.js"

import { DialogShell } from "./DialogShell.js"

export interface DialogPromptProps {
	title: string
	message?: string
	placeholder?: string
	initialValue?: string
	onSubmit: (value: string) => void
	onCancel: () => void
	/** Optional validator returning an error string when invalid. */
	validate?: (value: string) => string | undefined
	/**
	 * When true, render typed characters as `•` to hide secrets (mirrors
	 * OpenCode's `Prompt.password({ message: "Enter your API key" })`).
	 */
	mask?: boolean
}

/**
 * `<DialogPrompt>` — single-line text input dialog.
 *
 * Mirrors OpenCode `dialog-prompt.tsx`. Enter submits, Esc cancels (handled
 * by DialogHost too). For multi-line input, prefer wiring the existing
 * `MultilineTextInput` directly via `DialogProvider.replace(...)`.
 */
export function DialogPrompt({
	title,
	message,
	placeholder = "",
	initialValue = "",
	onSubmit,
	onCancel,
	validate,
	mask = false,
}: DialogPromptProps) {
	const theme = useTheme()
	const [value, setValue] = useState(initialValue)
	const error = validate?.(value)

	useInput((input, key) => {
		if (key.return) {
			if (error) return
			onSubmit(value)
			return
		}
		if (key.escape) {
			onCancel()
			return
		}
		if (key.backspace || key.delete) {
			setValue((v) => v.slice(0, -1))
			return
		}
		if (input && !key.ctrl && !key.meta && input >= " ") {
			setValue((v) => v + input)
		}
	})

	const displayValue = mask && value ? "•".repeat(value.length) : value

	return (
		<DialogShell title={title} subtitle={message}>
			<Box>
				<Text color={theme.textMuted}>›{" "}</Text>
				<Text color={theme.text}>{displayValue || <Text color={theme.textMuted}>{placeholder}</Text>}</Text>
				<Text color={theme.primary}>▌</Text>
			</Box>
			{error && (
				<Box marginTop={1}>
					<Text color={theme.error}>{error}</Text>
				</Box>
			)}
		</DialogShell>
	)
}
