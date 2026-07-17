/**
 * Prompt cache usage monitoring utilities.
 *
 * Pure functions with no vscode or core dependencies — lives in shared
 * so that both api/ and core/ layers can import without cross-layer coupling.
 */
export type PromptCacheUsage = {
	cacheReadInputTokens?: number
	cacheCreationInputTokens?: number
}

export function summarizePromptCacheUsage(u: PromptCacheUsage): string {
	const read = u.cacheReadInputTokens ?? 0
	const created = u.cacheCreationInputTokens ?? 0
	return `prompt-cache read=${read} create=${created}`
}
