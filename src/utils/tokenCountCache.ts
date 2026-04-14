/**
 * Token Count Cache - LRU cache for token counting results.
 *
 * Avoids redundant tiktoken calls by caching content hash → token count.
 * Uses JavaScript Map insertion order for LRU eviction.
 */
import { createHash } from "crypto"

const DEFAULT_CACHE_SIZE = 1000
const SHORT_TEXT_THRESHOLD = 100 // texts shorter than this use content directly as key

export class TokenCountCache {
	private cache: Map<string, number> = new Map()
	private maxSize: number
	private hits = 0
	private misses = 0

	constructor(maxSize: number = DEFAULT_CACHE_SIZE) {
		this.maxSize = maxSize
	}

	/**
	 * Get token count for content, using cache when available.
	 * @param content Text to count tokens for
	 * @param countFn Actual token counting function (called on cache miss)
	 */
	getTokenCount(content: string, countFn: (text: string) => number): number {
		const key = this.getKey(content)

		if (this.cache.has(key)) {
			this.hits++
			// Move to end (most recently used) by deleting and re-inserting
			const value = this.cache.get(key)!
			this.cache.delete(key)
			this.cache.set(key, value)
			return value
		}

		this.misses++
		const count = countFn(content)

		// Evict oldest entry if at capacity
		if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value
			if (firstKey !== undefined) {
				this.cache.delete(firstKey)
			}
		}

		this.cache.set(key, count)
		return count
	}

	/**
	 * Batch token counting with cache.
	 */
	getTokenCountBatch(contents: string[], countFn: (text: string) => number): number[] {
		return contents.map((c) => this.getTokenCount(c, countFn))
	}

	getHitRate(): number {
		const total = this.hits + this.misses
		return total === 0 ? 0 : this.hits / total
	}

	getStats() {
		return {
			size: this.cache.size,
			maxSize: this.maxSize,
			hits: this.hits,
			misses: this.misses,
			hitRate: this.getHitRate(),
		}
	}

	clear(): void {
		this.cache.clear()
		this.hits = 0
		this.misses = 0
	}

	/**
	 * Generate cache key: short texts use content directly, long texts use MD5 hash.
	 */
	private getKey(content: string): string {
		if (content.length < SHORT_TEXT_THRESHOLD) {
			return content
		}
		return createHash("md5").update(content).digest("hex")
	}
}

/** Global singleton instance */
export const globalTokenCountCache = new TokenCountCache()

/**
 * Convenience function: cached token counting.
 * Drop-in replacement for direct tiktoken calls.
 *
 * Usage:
 *   // Before: const count = countTokens(text)
 *   // After:  const count = cachedCountTokens(text, countTokens)
 *
 * Integration points in the codebase:
 * - src/core/context-management/index.ts: estimateTokenCount()
 * - src/core/task/Task.ts: api.countTokens() calls
 * - src/core/condense/index.ts: apiHandler.countTokens()
 */
export function cachedCountTokens(content: string, countFn: (text: string) => number): number {
	return globalTokenCountCache.getTokenCount(content, countFn)
}
