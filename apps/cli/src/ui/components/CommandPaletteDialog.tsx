/**
 * `<CommandPaletteDialog>` — backed by `DialogSelect`.
 *
 * Drop-in replacement for the legacy `CommandPalette` overlay. Mounted via
 * `useDialog().replace(() => <CommandPaletteDialog onTrigger={...} />)`.
 *
 * Mirrors OpenCode's `component/command-palette.tsx`: fuzzy filter + grouped
 * by category + keyboard shortcut hint per row.
 */

import { Text } from "ink"

import { DialogSelect, type DialogSelectOption } from "../dialog/DialogSelect.js"
import { useTheme } from "../theme.js"
import { GLOBAL_COMMANDS } from "../../lib/utils/commands.js"

export interface PaletteEntry {
	name: string
	description: string
	shortcut?: string
	category: string
}

/** Built-in keyboard shortcuts surfaced in the palette as non-runnable hints. */
const KEYBOARD_SHORTCUTS: PaletteEntry[] = [
	{ name: "Cycle Mode", description: "Switch to next mode", shortcut: "Ctrl+M", category: "Shortcuts" },
	{ name: "Toggle TODO", description: "Show/hide TODO list", shortcut: "Ctrl+T", category: "Shortcuts" },
	{ name: "API Profile", description: "Open API profile picker", shortcut: "Ctrl+P", category: "Shortcuts" },
	{
		name: "Condense Context",
		description: "Compress conversation context",
		shortcut: "Ctrl+R",
		category: "Shortcuts",
	},
	{
		name: "Toggle Focus",
		description: "Switch between scroll and input",
		shortcut: "Tab",
		category: "Shortcuts",
	},
	{ name: "Exit", description: "Press twice to exit", shortcut: "Ctrl+C", category: "Shortcuts" },
]

function buildPaletteEntries(): PaletteEntry[] {
	const entries: PaletteEntry[] = GLOBAL_COMMANDS.map((cmd) => ({
		name: `/${cmd.name}`,
		description: cmd.description,
		category: "Commands",
	}))
	entries.push(...KEYBOARD_SHORTCUTS)
	return entries
}

export interface CommandPaletteDialogProps {
	onSelect: (entry: PaletteEntry) => void
	onCancel?: () => void
}

export function CommandPaletteDialog({ onSelect, onCancel }: CommandPaletteDialogProps) {
	const theme = useTheme()
	const entries = buildPaletteEntries()
	const options: DialogSelectOption<PaletteEntry>[] = entries.map((entry) => ({
		value: entry,
		title: entry.name,
		description: entry.shortcut ? `${entry.description} ` : entry.description,
		category: entry.category,
	}))

	return (
		<DialogSelect
			title="Command Palette"
			options={options}
			onSelect={(value) => onSelect(value)}
			onCancel={onCancel}
			footer={
				<Text color={theme.textMuted}>
					type to search • ↑↓ navigate • Enter select • Esc close
				</Text>
			}
		/>
	)
}
