export type PromptCacheUsage = {
	cacheReadInputTokens?: number
	cacheCreationInputTokens?: number
}

export function summarizePromptCacheUsage(u: PromptCacheUsage): string {
	const read = u.cacheReadInputTokens ?? 0
	const created = u.cacheCreationInputTokens ?? 0
	return `prompt-cache read=${read} create=${created}`
}
