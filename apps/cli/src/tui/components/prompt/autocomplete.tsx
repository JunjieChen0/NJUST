/**
 * Autocomplete System
 *
 * Supports multiple trigger types: slash commands, file paths, modes, history.
 *
 * The picker component renders inside the prompt box (in-flow) so it
 * doesn't need absolute positioning. The OpenTUI renderer handles the
 * underlying layout and selection highlight.
 *
 * For fuzzy matching we use fuzzysort (already a CLI dependency) — gives
 * us the same ranking OpenCode uses for the command palette.
 */

import { createMemo, For, Show } from "solid-js"
import fuzzysort from "fuzzysort"
import { Text, Box } from "../index.tsx"
import { useTheme } from "../../context/theme.tsx"

export interface AutocompleteItem {
	label: string
	value: string
	description?: string
	category?: string
}

export interface AutocompleteMatch {
	prefix: string
	query: string
}

export interface AutocompleteTrigger {
	/** Character that triggers this autocomplete (e.g., "/", "@", ">", "#") */
	trigger: string
	/** Detect if the trigger is active */
	detect(textBeforeCursor: string): AutocompleteMatch | null
	/** Get items for the current query */
	getItems(match: AutocompleteMatch): AutocompleteItem[]
}

// =============================================================================
// Slash Command Trigger
// =============================================================================

export class SlashCommandTrigger implements AutocompleteTrigger {
	trigger = "/"

	constructor(private commands: Array<{ name: string; description?: string }>) {}

	detect(textBeforeCursor: string): AutocompleteMatch | null {
		const match = textBeforeCursor.match(/\/(\w*)$/)
		if (!match) return null
		return { prefix: match[0], query: match[1] }
	}

	getItems(match: AutocompleteMatch): AutocompleteItem[] {
		const query = match.query.toLowerCase()
		return this.commands
			.filter((cmd) => cmd.name.toLowerCase().includes(query))
			.map((cmd) => ({
				label: `/${cmd.name}`,
				value: `/${cmd.name} `,
				description: cmd.description,
				category: "Commands",
			}))
	}
}

// =============================================================================
// File Path Trigger
// =============================================================================

export class FileTrigger implements AutocompleteTrigger {
	trigger = "@"

	constructor(private fileProvider: (query: string) => string[]) {}

	detect(textBeforeCursor: string): AutocompleteMatch | null {
		const match = textBeforeCursor.match(/@([\w./-]*)$/)
		if (!match) return null
		return { prefix: match[0], query: match[1] }
	}

	getItems(match: AutocompleteMatch): AutocompleteItem[] {
		const files = this.fileProvider(match.query)
		return files.map((file) => ({
			label: `@${file}`,
			value: `@${file} `,
			description: "File",
			category: "Files",
		}))
	}
}

// =============================================================================
// Mode Trigger
// =============================================================================

export class ModeTrigger implements AutocompleteTrigger {
	trigger = ">"

	constructor(private modes: Array<{ name: string; description?: string }>) {}

	detect(textBeforeCursor: string): AutocompleteMatch | null {
		const match = textBeforeCursor.match(/>\s*(\w*)$/)
		if (!match) return null
		return { prefix: match[0], query: match[1] }
	}

	getItems(match: AutocompleteMatch): AutocompleteItem[] {
		const query = match.query.toLowerCase()
		return this.modes
			.filter((mode) => mode.name.toLowerCase().includes(query))
			.map((mode) => ({
				label: `> ${mode.name}`,
				value: `> ${mode.name} `,
				description: mode.description,
				category: "Modes",
			}))
	}
}

// =============================================================================
// History Trigger
// =============================================================================

export class HistoryTrigger implements AutocompleteTrigger {
	trigger = "#"

	constructor(private history: string[]) {}

	detect(textBeforeCursor: string): AutocompleteMatch | null {
		const match = textBeforeCursor.match(/#\s*(.*)$/)
		if (!match) return null
		return { prefix: match[0], query: match[1] }
	}

	getItems(match: AutocompleteMatch): AutocompleteItem[] {
		const query = match.query.toLowerCase()
		return this.history
			.filter((item) => item.toLowerCase().includes(query))
			.slice(0, 10)
			.map((item, index) => ({
				label: `#${index + 1} ${item.slice(0, 50)}${item.length > 50 ? "..." : ""}`,
				value: item,
				description: "From history",
				category: "History",
			}))
	}
}

// =============================================================================
// Fuzzy-filtered picker (uses fuzzysort like OpenCode's command palette)
// =============================================================================

export function AutocompletePicker(props: {
	items: AutocompleteItem[]
	selectedIndex: number
	query?: string
	maxHeight?: number
	onSelect: () => void
	onClose: () => void
}) {
	const { theme } = useTheme()

	// Apply fuzzysort when a query is provided. When empty, show everything.
	const filteredItems = createMemo<AutocompleteItem[]>(() => {
		const q = (props.query ?? "").trim()
		const items = props.items
		if (!q) return items.slice(0, 10)

		const result = fuzzysort.go(q, items, {
			keys: ["label", "description", "category"],
			limit: 10,
		})
		return result.map((r) => r.obj)
	})

	const maxHeight = createMemo(() => Math.min(props.maxHeight ?? 6, filteredItems().length))

	// Group by category for visual clarity
	const grouped = createMemo(() => {
		const groups = new Map<string, AutocompleteItem[]>()
		for (const item of filteredItems()) {
			const cat = item.category ?? "Other"
			if (!groups.has(cat)) groups.set(cat, [])
			groups.get(cat)!.push(item)
		}
		return Array.from(groups.entries())
	})

	// Flatten for global selectedIndex lookup
	const flatItems = createMemo(() => filteredItems())

	return (
		<Box
			flexDirection="column"
			border={true}
			borderColor={theme.colors.borderSubtle}
			backgroundColor={theme.colors.backgroundElement}
			paddingLeft={1}
			paddingRight={1}
			maxHeight={maxHeight()}>
			<Show
				when={flatItems().length > 0}
				fallback={<Text color={theme.colors.textMuted}>No matching items</Text>}>
				<For each={grouped()}>
					{([category, items]) => (
						<Box flexDirection="column">
							<Text color={theme.colors.textMuted}>{category}</Text>
							<For each={items}>
								{(item) => {
									const idx = flatItems().indexOf(item)
									const isSelected = idx === props.selectedIndex
									return (
										<Box
											flexDirection="row"
											backgroundColor={isSelected ? theme.colors.selectedBackground : undefined}
											onMouseDown={() => {
												// Click selects the item
												if (idx >= 0) props.onSelect()
											}}>
											<Text
												color={isSelected ? theme.colors.primary : theme.colors.text}
												bold={isSelected}>
												{isSelected ? "▶ " : "  "}
												{item.label}
											</Text>
											<Show when={item.description}>
												<Text color={theme.colors.textMuted}> {item.description}</Text>
											</Show>
										</Box>
									)
								}}
							</For>
						</Box>
					)}
				</For>
			</Show>
		</Box>
	)
}
