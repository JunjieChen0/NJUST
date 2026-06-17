import { Box, Text } from "ink"
import Fuzzysort from "fuzzysort"

import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

export interface ProblemResult extends AutocompleteItem {
	summary: string
	source: string
}

export interface ProblemsTriggerConfig {
	getResults: () => ProblemResult[]
}

/**
 * Create a @problems trigger for diagnostic/error mentions.
 *
 * Activates when the user types "@problems:" followed by a search query.
 * Uses local history of error patterns from tool outputs (best effort).
 */
export function createProblemsTrigger(config: ProblemsTriggerConfig): AutocompleteTrigger<ProblemResult> {
	const { getResults } = config

	function getResultsWithFuzzySort(query: string): ProblemResult[] {
		const results = getResults()

		if (!query || results.length === 0) {
			return results
		}

		const fuzzyResults = Fuzzysort.go(query, results, {
			keys: ["summary", "source"],
			threshold: -10000,
		})

		return fuzzyResults.map((result) => result.obj)
	}

	return {
		id: "problems",
		triggerChar: "@problems:",
		position: "anywhere",

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			const triggerIndex = lineText.lastIndexOf("@problems:")

			if (triggerIndex === -1) {
				return null
			}

			const query = lineText.substring(triggerIndex + 10)

			if (query.includes(" ")) {
				return null
			}

			return { query, triggerIndex }
		},

		search: (_query: string): ProblemResult[] => {
			return getResultsWithFuzzySort(_query)
		},

		refreshResults: (query: string): ProblemResult[] => {
			return getResultsWithFuzzySort(query)
		},

		renderItem: (item: ProblemResult, isSelected: boolean) => {
			const color = isSelected ? "cyan" : undefined

			return (
				<Box paddingLeft={2}>
					<Text color={color}>{item.summary}</Text>
					<Text color="gray"> ({item.source})</Text>
				</Box>
			)
		},

		getReplacementText: (item: ProblemResult, lineText: string, triggerIndex: number): string => {
			const before = lineText.substring(0, triggerIndex)
			return `${before}@problems:${item.key} `
		},

		emptyMessage: "No problems found in recent output",
		debounceMs: 100,
	}
}
