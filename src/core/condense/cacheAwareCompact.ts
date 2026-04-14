/**
 * Cache-Aware Compression Module
 *
 * Prevents automatic context compression from breaking provider-level
 * prompt cache when the cache hit rate is high. Compression invalidates
 * cached prompt prefixes, so when the cache is being utilized effectively,
 * skipping compression can actually reduce costs and latency.
 *
 * Inspired by Claude Code's apiMicrocompact.ts prompt cache break detection.
 */

/**
 * Determines if automatic compression should be skipped to preserve prompt cache.
 *
 * When the provider-level prompt cache hit rate exceeds a threshold (default 80%),
 * compressing the conversation would break the cached prefix and increase costs
 * rather than save them. In such cases, it's better to let the conversation
 * continue using the cache until the hit rate drops.
 *
 * @param cacheReadTokens - Number of tokens served from the provider's prompt cache
 * @param totalInputTokens - Total number of input tokens sent to the API
 * @param threshold - Cache hit rate threshold above which compression is skipped (default 0.8)
 * @returns True if compression should be skipped to preserve cache
 */
export function shouldSkipCompactForCache(
	cacheReadTokens: number,
	totalInputTokens: number,
	threshold: number = 0.8,
): boolean {
	if (totalInputTokens <= 0) {
		return false
	}

	const cacheHitRate = cacheReadTokens / totalInputTokens

	// If cache hit rate exceeds threshold, compression would break more cache than it saves
	if (cacheHitRate > threshold) {
		return true
	}
	return false
}

/**
 * Calculates an adjusted compression threshold that accounts for cache utilization.
 *
 * Higher cache hit rates raise the effective compression threshold, making
 * compression less aggressive. This ensures the system doesn't prematurely
 * invalidate a well-performing cache.
 *
 * @param baseThreshold - The base compression threshold percentage (e.g. 80 for 80%)
 * @param cacheReadTokens - Number of tokens served from the provider's prompt cache
 * @param totalInputTokens - Total number of input tokens sent to the API
 * @returns Adjusted threshold percentage (capped at 95%)
 */
export function getAdjustedCompactThreshold(
	baseThreshold: number,
	cacheReadTokens: number,
	totalInputTokens: number,
): number {
	if (totalInputTokens <= 0) {
		return baseThreshold
	}

	const cacheHitRate = cacheReadTokens / totalInputTokens

	// Raise threshold proportionally to cache utilization
	// e.g., 80% cache hit rate -> threshold raised by ~12 percentage points
	const adjustment = Math.min(cacheHitRate * 15, 15)
	return Math.min(baseThreshold + adjustment, 95)
}
