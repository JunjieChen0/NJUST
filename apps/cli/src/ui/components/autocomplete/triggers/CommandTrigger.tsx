import { Box, Text } from "ink"
import Fuzzysort from "fuzzysort"

import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

export interface CommandResult extends AutocompleteItem {
	command: string
	source: "allowed" | "history"
}

export interface CommandTriggerConfig {
	getResults: () => CommandResult[]
}

/**
 * Create a @command trigger for command mentions.
 *
 * Activates when the user types "@command:" followed by a search query.
 * Uses allowedCommands from state + history of executed commands (best effort).
 */
export function createCommandTrigger(config: CommandTriggerConfig): AutocompleteTrigger<CommandResult> {
	const { getResults } = config

	function getResultsWithFuzzySort(query: string): CommandResult[] {
		const results = getResults()

		if (!query || results.length === 0) {
			return results
		}

		const fuzzyResults = Fuzzysort.go(query, results, {
			keys: ["command"],
			threshold: -10000,
		})

		return fuzzyResults.map((result) => result.obj)
	}

	return {
		id: "command",
		triggerChar: "@command:",
		position: "anywhere",

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			const triggerIndex = lineText.lastIndexOf("@command:")

			if (triggerIndex === -1) {
				return null
			}

			const query = lineText.substring(triggerIndex + 9)

			if (query.includes(" ")) {
				return null
			}

			return { query, triggerIndex }
		},

		search: (_query: string): CommandResult[] => {
			return getResultsWithFuzzySort(_query)
		},

		refreshResults: (query: string): CommandResult[] => {
			return getResultsWithFuzzySort(query)
		},

		renderItem: (item: CommandResult, isSelected: boolean) => {
			const color = isSelected ? "cyan" : undefined
			const sourceLabel = item.source === "allowed" ? "allowed" : "history"

			return (
				<Box paddingLeft={2}>
					<Text color={color}>{item.command}</Text>
					<Text color="gray"> ({sourceLabel})</Text>
				</Box>
			)
		},

		getReplacementText: (item: CommandResult, lineText: string, triggerIndex: number): string => {
			const before = lineText.substring(0, triggerIndex)
			return `${before}@command:${item.command} `
		},

		emptyMessage: "No commands found",
		debounceMs: 100,
	}
}
