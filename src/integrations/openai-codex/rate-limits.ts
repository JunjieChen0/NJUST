/**
 * OpenAI Codex rate limits - stub for simplified version
 */

export interface RateLimitInfo {
	limit: number
	remaining: number
	reset: number
	primary?: RateLimitInfo
	usedPercent?: number
	resetsAt?: string | number
	fetchedAt?: number
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function fetchOpenAiCodexRateLimitInfo(
	_accessToken: string,
	_options?: { accountId?: string | null },
): Promise<RateLimitInfo | undefined> {
	// No-op in simplified version
	return undefined
}
