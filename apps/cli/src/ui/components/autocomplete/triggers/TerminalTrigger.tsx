import { Box, Text } from "ink"
import Fuzzysort from "fuzzysort"

import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

export interface TerminalResult extends AutocompleteItem {
	command: string
	outputPreview: string
	index: number
}

export interface TerminalTriggerConfig {
	getResults: () => TerminalResult[]
}

/**
 * Create a @terminal trigger for terminal output mentions.
 *
 * Activates when the user types "@terminal:" followed by a search query.
 * Uses local history of command_output messages (best effort).
 */
export function createTerminalTrigger(config: TerminalTriggerConfig): AutocompleteTrigger<TerminalResult> {
	const { getResults } = config

	function getResultsWithFuzzySort(query: string): TerminalResult[] {
		const results = getResults()

		if (!query || results.length === 0) {
			return results
		}

		const fuzzyResults = Fuzzysort.go(query, results, {
			keys: ["command", "outputPreview"],
			threshold: -10000,
		})

		return fuzzyResults.map((result) => result.obj)
	}

	return {
		id: "terminal",
		triggerChar: "@terminal:",
		position: "anywhere",

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			const triggerIndex = lineText.lastIndexOf("@terminal:")

			if (triggerIndex === -1) {
				return null
			}

			const query = lineText.substring(triggerIndex + 10)

			if (query.includes(" ")) {
				return null
			}

			return { query, triggerIndex }
		},

		search: (_query: string): TerminalResult[] => {
			return getResultsWithFuzzySort(_query)
		},

		refreshResults: (query: string): TerminalResult[] => {
			return getResultsWithFuzzySort(query)
		},

		renderItem: (item: TerminalResult, isSelected: boolean) => {
			const color = isSelected ? "cyan" : undefined

			return (
				<Box paddingLeft={2}>
					<Text color={color}>${item.command}</Text>
					<Text color="gray"> → {item.outputPreview}</Text>
				</Box>
			)
		},

		getReplacementText: (item: TerminalResult, lineText: string, triggerIndex: number): string => {
			const before = lineText.substring(0, triggerIndex)
			return `${before}@terminal:${item.index} `
		},

		emptyMessage: "No terminal output found in recent history",
		debounceMs: 100,
	}
}
