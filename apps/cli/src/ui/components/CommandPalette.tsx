import { useState, useMemo } from "react"
import { Box, Text, useInput } from "ink"

import { useTheme } from "../theme.js"
import { GLOBAL_COMMANDS } from "../../lib/utils/commands.js"

/** A single entry in the command palette. */
interface PaletteEntry {
	name: string
	description: string
	shortcut?: string
	category: string
}

/** Build the full list of palette entries from global commands + keyboard shortcuts. */
function buildPaletteEntries(): PaletteEntry[] {
	const entries: PaletteEntry[] = []

	// Global slash commands
	for (const cmd of GLOBAL_COMMANDS) {
		entries.push({
			name: `/${cmd.name}`,
			description: cmd.description,
			category: "Commands",
		})
	}

	// Keyboard shortcuts
	const shortcuts: PaletteEntry[] = [
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

	entries.push(...shortcuts)
	return entries
}

/** Simple fuzzy match: check if filter is a subsequence of entry text. */
function fuzzyMatch(query: string, text: string): boolean {
	if (!query) return true
	const q = query.toLowerCase()
	const t = text.toLowerCase()
	let qi = 0
	for (let ti = 0; ti < t.length && qi < q.length; ti++) {
		if (t[ti] === q[qi]) qi++
	}
	return qi === q.length
}

export interface CommandPaletteProps {
	onSelect: (entry: PaletteEntry) => void
	onClose: () => void
}

export function CommandPalette({ onSelect, onClose }: CommandPaletteProps) {
	const theme = useTheme()
	const [filter, setFilter] = useState("")
	const [selectedIndex, setSelectedIndex] = useState(0)

	const allEntries = useMemo(() => buildPaletteEntries(), [])

	const filtered = useMemo(() => {
		if (!filter) return allEntries
		return allEntries.filter(
			(e) => fuzzyMatch(filter, e.name) || fuzzyMatch(filter, e.description) || fuzzyMatch(filter, e.category),
		)
	}, [filter, allEntries])

	// Reset selection when filter changes
	useMemo(() => setSelectedIndex(0), [filter])

	useInput(
		(input, key) => {
			if (key.escape) {
				onClose()
				return
			}
			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0))
				return
			}
			if (key.downArrow) {
				setSelectedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : filtered.length - 1))
				return
			}
			if (key.return) {
				const entry = filtered[selectedIndex]
				if (entry) {
					onSelect(entry)
				}
				return
			}
			// Handle backspace
			if (key.backspace || key.delete) {
				setFilter((prev) => prev.slice(0, -1))
				return
			}
			// Handle printable characters
			if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
				setFilter((prev) => prev + input)
				return
			}
		},
		{ isActive: true },
	)

	// Group entries by category
	const grouped = useMemo(() => {
		const groups: Record<string, PaletteEntry[]> = {}
		for (const entry of filtered) {
			const cat = entry.category
			if (!groups[cat]) groups[cat] = []
			groups[cat]!.push(entry)
		}
		return groups
	}, [filtered])

	// Flatten grouped entries for index tracking
	const flatIndex = useMemo(() => {
		const flat: { entry: PaletteEntry; globalIndex: number }[] = []
		let idx = 0
		for (const [, entries] of Object.entries(grouped)) {
			for (const entry of entries) {
				flat.push({ entry, globalIndex: idx })
				idx++
			}
		}
		return flat
	}, [grouped])

	const maxVisible = 12

	return (
		<Box flexDirection="column" padding={1}>
			<Box flexDirection="row" marginBottom={1}>
				<Text bold color={theme.titleColor}>
					Command Palette
				</Text>
				<Text color={theme.dimText}> — type to search, ↑↓ to navigate, Enter to select</Text>
			</Box>

			{/* Search input */}
			<Box marginBottom={1}>
				<Text color={theme.promptColorActive}>{"> "}</Text>
				<Text color={theme.text}>{filter}</Text>
				<Text color={theme.dimText}>▋</Text>
			</Box>

			{/* Results */}
			<Box flexDirection="column">
				{filtered.length === 0 ? (
					<Text color={theme.dimText}>No commands found</Text>
				) : (
					Object.entries(grouped)
						.slice(0, maxVisible)
						.map(([category, entries]) => (
							<Box key={category} flexDirection="column" marginBottom={0}>
								<Text color={theme.dimText} dimColor>
									{category}
								</Text>
								{entries.map((entry) => {
									const globalIdx = flatIndex.findIndex((f) => f.entry === entry)
									const isSelected = globalIdx === selectedIndex
									return (
										<Box key={`${category}-${entry.name}`}>
											<Text color={isSelected ? theme.focusColor : theme.text}>
												{isSelected ? "▶ " : "  "}
												{entry.name}
											</Text>
											<Text color={theme.dimText}> {entry.description}</Text>
											{entry.shortcut && (
												<Text color={theme.dimText} dimColor>
													{" "}
													[{entry.shortcut}]
												</Text>
											)}
										</Box>
									)
								})}
							</Box>
						))
				)}
			</Box>

			<Box marginTop={1}>
				<Text color={theme.dimText}>Press Esc to close</Text>
			</Box>
		</Box>
	)
}
