import * as fs from "fs"
import { ApiMessage } from "../task-persistence/apiMessages"

/** Maximum number of files to restore after compaction */
export const POST_COMPACT_MAX_FILES_TO_RESTORE = 5

/** Total token budget for all restored file content */
export const POST_COMPACT_TOKEN_BUDGET = 50_000

/** Maximum tokens per individual restored file */
export const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000

/** Maximum tokens per restored skill description */
export const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000

type RestoreOptions = {
	recentFiles?: string[]
	activeSkills?: string[]
	mcpDelta?: string
}

/**
 * Estimate token count for a given text (~4 chars per token).
 */
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4)
}

/**
 * Truncate content to fit within a token budget, keeping head (60%) and tail (30%)
 * with a truncation marker in between.
 */
function truncateToTokenBudget(content: string, maxTokens: number): string {
	const maxChars = maxTokens * 4
	if (content.length <= maxChars) return content
	const headChars = Math.floor(maxChars * 0.6)
	const tailChars = Math.floor(maxChars * 0.3)
	const omittedTokens = estimateTokens(content) - maxTokens
	return (
		content.slice(0, headChars) +
		`\n\n... [truncated: ${omittedTokens} tokens omitted] ...\n\n` +
		content.slice(-tailChars)
	)
}

/**
 * Post-compact context restoration: reads recent files from disk and injects
 * their content (within a token budget) back into the conversation after compaction.
 * Also restores active skill names and MCP delta hints.
 */
export function postCompactRestore(messages: ApiMessage[], options?: RestoreOptions): ApiMessage[] {
	if (!options) return messages

	const hasFiles = options.recentFiles && options.recentFiles.length > 0
	const hasSkills = options.activeSkills && options.activeSkills.length > 0
	const hasMcp = options.mcpDelta && options.mcpDelta.trim().length > 0

	if (!hasFiles && !hasSkills && !hasMcp) return messages

	let totalTokensUsed = 0
	const restoredParts: string[] = []

	// Restore file contents with token budget control
	if (hasFiles) {
		const filesToRestore = options.recentFiles!.slice(0, POST_COMPACT_MAX_FILES_TO_RESTORE)
		for (const filePath of filesToRestore) {
			if (totalTokensUsed >= POST_COMPACT_TOKEN_BUDGET) break
			try {
				const content = fs.readFileSync(filePath, "utf-8")
				const remainingBudget = Math.min(
					POST_COMPACT_MAX_TOKENS_PER_FILE,
					POST_COMPACT_TOKEN_BUDGET - totalTokensUsed,
				)
				const truncated = truncateToTokenBudget(content, remainingBudget)
				const tokens = estimateTokens(truncated)
				totalTokensUsed += tokens
				restoredParts.push(`### File: ${filePath}\n\`\`\`\n${truncated}\n\`\`\``)
			} catch {
				// File not readable or doesn't exist, add a lightweight hint instead
				restoredParts.push(`### File: ${filePath}\n(file no longer available)`)
			}
		}
	}

	// Restore active skill descriptions
	if (hasSkills) {
		const skillsToRestore = options.activeSkills!.slice(0, 3)
		for (const skill of skillsToRestore) {
			if (totalTokensUsed >= POST_COMPACT_TOKEN_BUDGET) break
			const truncated = truncateToTokenBudget(skill, POST_COMPACT_MAX_TOKENS_PER_SKILL)
			restoredParts.push(`### Active Skill: ${truncated}`)
			totalTokensUsed += estimateTokens(truncated) + 10
		}
	}

	// Restore MCP delta (lightweight hint)
	if (hasMcp) {
		const mcpText = options.mcpDelta!.trim().slice(0, 1000)
		restoredParts.push(`### MCP delta\n${mcpText}`)
		totalTokensUsed += estimateTokens(mcpText)
	}

	if (restoredParts.length === 0) return messages

	const restoreMessage: ApiMessage = {
		role: "user",
		content: `[Post-compact restore]\nThe following files and context were restored after conversation compaction:\n\n${restoredParts.join("\n\n")}`,
		ts: Date.now(),
	}

	return [...messages, restoreMessage]
}
