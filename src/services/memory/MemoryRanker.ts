/**
 * MemoryRanker — Relevance scoring for memory entries.
 *
 * Ranks memories by how relevant they are to the current conversation context.
 * Uses simple keyword overlap scoring (Jaccard similarity on tokens).
 * Higher score = more relevant = should be injected first.
 */

import type { MemoryEntry } from "./MemoryStore"

function tokenize(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9_]+/)
			.filter((t) => t.length >= 3),
	)
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 || b.size === 0) return 0
	const intersection = new Set([...a].filter((x) => b.has(x)))
	const union = new Set([...a, ...b])
	return intersection.size / union.size
}

/**
 * Score a memory entry's relevance to the given query context.
 * Returns 0.0 (irrelevant) to 1.0 (highly relevant).
 */
export function scoreRelevance(memory: MemoryEntry, query: string): number {
	const queryTokens = tokenize(query)

	// Score from content
	const contentScore = jaccardSimilarity(queryTokens, tokenize(memory.content))

	// Score from tags
	const tagText = (memory.tags ?? []).join(" ")
	const tagScore = jaccardSimilarity(queryTokens, tokenize(tagText))

	// Score from recency (newer = slightly higher)
	const ageHours = (Date.now() - memory.timestamp) / (1000 * 60 * 60)
	const recencyScore = Math.max(0, 1 - ageHours / 720) // linear decay over 30 days

	return contentScore * 0.6 + tagScore * 0.25 + recencyScore * 0.15
}

/**
 * Rank an array of memories by relevance to the query, highest first.
 * Only returns memories with score above the threshold.
 */
export function rankMemories(
	memories: MemoryEntry[],
	query: string,
	threshold: number = 0.05,
	maxResults: number = 10,
): MemoryEntry[] {
	const scored = memories
		.map((m) => ({ memory: m, score: scoreRelevance(m, query) }))
		.filter((s) => s.score >= threshold)
		.sort((a, b) => b.score - a.score)

	return scored.slice(0, maxResults).map((s) => s.memory)
}
