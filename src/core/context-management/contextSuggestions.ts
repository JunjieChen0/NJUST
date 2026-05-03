import { TokenBreakdown, DuplicateReadInfo, LargeToolResultInfo, LARGE_RESULT_THRESHOLD } from "./contextAnalysis"

/**
 * A single optimization suggestion.
 */
export type Suggestion = {
	type: "warning" | "info" | "tip"
	message: string
	detail?: string
}

/** Results exceeding this many tokens get an individual "very large" warning. */
const VERY_LARGE_RESULT_THRESHOLD = LARGE_RESULT_THRESHOLD * 2.5 // 5000 tokens

/**
 * Generate optimization suggestions based on token usage analysis.
 *
 * Rules:
 * - Tool results >60% → suggest compacting
 * - Duplicate reads >20% of tokens → suggest reusing
 * - Summaries >30% of tokens → suggest cleaning up old summaries
 * - Many large tool results → suggest reviewing tool usage
 * - High system prompt proportion → note (usually fixed)
 * - Many summary messages → suggest truncating very old ones
 */
export function generateSuggestions(
	breakdown: TokenBreakdown,
	duplicateReads: DuplicateReadInfo[],
	estimatedDuplicateReadTokens: number,
	largeToolResults: LargeToolResultInfo[],
	summaryMessageCount: number,
): Suggestion[] {
	const suggestions: Suggestion[] = []

	if (breakdown.totalTokens === 0) return suggestions

	const toolResultPct = breakdown.toolResultTokens / breakdown.totalTokens
	const summaryPct = breakdown.summaryTokens / breakdown.totalTokens
	const dupReadPct = estimatedDuplicateReadTokens / breakdown.totalTokens
	const toolUsePct = breakdown.toolUseTokens / breakdown.totalTokens

	// Large tool result proportion
	if (toolResultPct > 0.6 && largeToolResults.length > 0) {
		suggestions.push({
			type: "warning",
			message: `Tool results consume ${Math.round(toolResultPct * 100)}% of context.`,
			detail:
				largeToolResults.length > 2
					? `${largeToolResults.length} tool results exceed 2K tokens each. Consider compacting to reduce overhead.`
					: "Consider compacting to reduce tool result overhead.",
		})
	} else if (toolResultPct > 0.4) {
		suggestions.push({
			type: "info",
			message: `Tool results are ${Math.round(toolResultPct * 100)}% of context.`,
			detail: "Compression will become beneficial when this exceeds 60%.",
		})
	}

	// Summary chain length
	if (summaryPct > 0.3 && summaryMessageCount >= 2) {
		suggestions.push({
			type: "tip",
			message: `${summaryMessageCount} summary messages occupy ${Math.round(summaryPct * 100)}% of context.`,
			detail: "Old summaries can be consolidated to free space.",
		})
	}

	// Duplicate reads
	if (dupReadPct > 0.2) {
		suggestions.push({
			type: "warning",
			message: `Re-reading files costs ~${Math.round(dupReadPct * 100)}% of context.`,
			detail:
				duplicateReads.length > 0
					? `"${duplicateReads[0].filePath}" read ${duplicateReads[0].readCount}x. Consider referencing previously read content.`
					: "Consider referencing previously read content to avoid re-reads.",
		})
	}

	// Many tool uses (high tool_use proportion)
	if (toolUsePct > 0.3) {
		suggestions.push({
			type: "info",
			message: `Tool call definitions use ${Math.round(toolUsePct * 100)}% of context.`,
			detail: "This is normal for tool-heavy sessions. Compression will reduce overhead.",
		})
	}

	// Large individual results
	const veryLargeResults = largeToolResults.filter((r) => r.estimatedTokens > VERY_LARGE_RESULT_THRESHOLD)
	if (veryLargeResults.length > 0) {
		suggestions.push({
			type: "warning",
			message: `${veryLargeResults.length} tool result(s) exceed 5K tokens each.`,
			detail: "Very large results can significantly impact context usage. Consider truncating output.",
		})
	}

	// Summary-based optimization tip
	if (summaryMessageCount >= 3) {
		suggestions.push({
			type: "tip",
			message: `Session has ${summaryMessageCount} accumulated summaries.`,
			detail: "Consider starting a fresh session if summaries dominate the conversation.",
		})
	}

	return suggestions
}

/**
 * Format suggestions as a compact text block.
 */
export function formatSuggestions(suggestions: Suggestion[]): string {
	if (suggestions.length === 0) return ""
	return suggestions
		.map((s) => {
			const icon = s.type === "warning" ? "!" : s.type === "info" ? "i" : "?"
			const detail = s.detail ? ` — ${s.detail}` : ""
			return `[${icon}] ${s.message}${detail}`
		})
		.join("\n")
}
