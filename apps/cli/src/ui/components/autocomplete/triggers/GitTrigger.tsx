import { Box, Text } from "ink"
import Fuzzysort from "fuzzysort"

import type { GitCommit } from "@njust-ai/types"

import { Icon } from "../../Icon.js"
import type { AutocompleteTrigger, AutocompleteItem, TriggerDetectionResult } from "../types.js"

export interface GitResult extends AutocompleteItem {
	hash: string
	subject: string
	author?: string
	date?: string
}

export interface GitTriggerConfig {
	onSearch: (query: string) => void
	getResults: () => GitResult[]
}

/**
 * Create a @git trigger for commit mentions.
 *
 * Activates when the user types "@git:" followed by a search query.
 */
export function createGitTrigger(config: GitTriggerConfig): AutocompleteTrigger<GitResult> {
	const { onSearch, getResults } = config

	function getResultsWithFuzzySort(query: string): GitResult[] {
		const results = getResults()

		if (!query || results.length === 0) {
			return results
		}

		const fuzzyResults = Fuzzysort.go(query, results, {
			keys: ["subject", "hash"],
			threshold: -10000,
		})

		return fuzzyResults.map((result) => result.obj)
	}

	return {
		id: "git",
		triggerChar: "@git:",
		position: "anywhere",

		detectTrigger: (lineText: string): TriggerDetectionResult | null => {
			const triggerIndex = lineText.lastIndexOf("@git:")

			if (triggerIndex === -1) {
				return null
			}

			const query = lineText.substring(triggerIndex + 5)

			if (query.includes(" ")) {
				return null
			}

			return { query, triggerIndex }
		},

		search: (query: string): GitResult[] => {
			onSearch(query)
			return []
		},

		refreshResults: (query: string): GitResult[] => {
			return getResultsWithFuzzySort(query)
		},

		renderItem: (item: GitResult, isSelected: boolean) => {
			const color = isSelected ? "cyan" : undefined

			return (
				<Box paddingLeft={2}>
					<Icon name="terminal" color={color} />
					<Text> </Text>
					<Text color={color}>
						{item.hash.slice(0, 7)} {item.subject}
					</Text>
				</Box>
			)
		},

		getReplacementText: (item: GitResult, lineText: string, triggerIndex: number): string => {
			const before = lineText.substring(0, triggerIndex)
			return `${before}@git:${item.hash} `
		},

		emptyMessage: "No matching commits found",
		debounceMs: 150,
	}
}

export function toGitResult(commit: GitCommit): GitResult {
	return {
		key: commit.hash,
		hash: commit.hash,
		subject: commit.subject,
		author: commit.author,
		date: commit.date,
	}
}
