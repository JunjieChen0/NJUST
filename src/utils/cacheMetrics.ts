/**
 * Cache Metrics Tracker
 *
 * Tracks per-request cache usage entries with detailed token breakdowns
 * for Anthropic prompt caching and other provider-level caches.
 *
 * Provides:
 * - Per-request entry recording (input, cache_creation, cache_read, output tokens)
 * - Sliding-window hit rate calculation
 * - Aggregate summary with estimated savings
 *
 * This is the minimal observability version: data collection and exposure only,
 * no UI rendering.
 */

export interface CacheUsageEntry {
	timestamp: number
	inputTokens: number
	cacheCreationInputTokens: number
	cacheReadInputTokens: number
	outputTokens: number
	model: string
}

export interface CacheMetricsSummary {
	totalRequests: number
	totalInputTokens: number
	totalCacheCreationTokens: number
	totalCacheReadTokens: number
	/** 0-1, cache_read / (cache_read + cache_creation + non_cache_input) */
	cacheHitRate: number
	/** Estimated savings percent compared to no-cache scenario */
	estimatedSavingsPercent: number
}

export class CacheMetrics {
	private entries: CacheUsageEntry[] = []
	private readonly maxEntries: number = 500 // Keep the most recent 500 requests

	/**
	 * Record a single API call's cache metrics.
	 */
	record(entry: CacheUsageEntry): void {
		this.entries.push(entry)
		if (this.entries.length > this.maxEntries) {
			this.entries.shift()
		}
	}

	/**
	 * Get the cache hit rate for the most recent `windowSize` requests.
	 * Returns 0 if there are no entries or no cache-related tokens.
	 */
	getRecentHitRate(windowSize: number = 10): number {
		const recent = this.entries.slice(-windowSize)
		if (recent.length === 0) {
			return 0
		}

		let totalInput = 0
		let totalCacheRead = 0

		for (const entry of recent) {
			totalInput += entry.inputTokens + entry.cacheCreationInputTokens + entry.cacheReadInputTokens
			totalCacheRead += entry.cacheReadInputTokens
		}

		return totalInput > 0 ? totalCacheRead / totalInput : 0
	}

	/**
	 * Get an aggregate summary across all recorded entries.
	 */
	getSummary(): CacheMetricsSummary {
		if (this.entries.length === 0) {
			return {
				totalRequests: 0,
				totalInputTokens: 0,
				totalCacheCreationTokens: 0,
				totalCacheReadTokens: 0,
				cacheHitRate: 0,
				estimatedSavingsPercent: 0,
			}
		}

		let totalInputTokens = 0
		let totalCacheCreationTokens = 0
		let totalCacheReadTokens = 0

		for (const entry of this.entries) {
			totalInputTokens += entry.inputTokens
			totalCacheCreationTokens += entry.cacheCreationInputTokens
			totalCacheReadTokens += entry.cacheReadInputTokens
		}

		const allInputTokens = totalInputTokens + totalCacheCreationTokens + totalCacheReadTokens
		const cacheHitRate = allInputTokens > 0 ? totalCacheReadTokens / allInputTokens : 0

		// Anthropic cache reads are billed at ~10% of normal input price.
		// Estimated savings: cache_read_tokens * 0.9 / all_input_tokens
		const estimatedSavingsPercent = allInputTokens > 0 ? (totalCacheReadTokens * 0.9) / allInputTokens : 0

		return {
			totalRequests: this.entries.length,
			totalInputTokens,
			totalCacheCreationTokens,
			totalCacheReadTokens,
			cacheHitRate,
			estimatedSavingsPercent,
		}
	}

	/**
	 * Get the most recent cache entries (for debugging / logging).
	 */
	getRecentEntries(count: number = 10): CacheUsageEntry[] {
		return this.entries.slice(-count)
	}

	/**
	 * Reset all recorded metrics.
	 */
	reset(): void {
		this.entries = []
	}
}

/** Singleton instance for global cache metrics tracking */
export const globalCacheMetrics = new CacheMetrics()
