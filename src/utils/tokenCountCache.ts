import crypto from "crypto"

import type { TokenCountResult } from "./countTokens"

const DEFAULT_MAX_SIZE = 256

/**
 * LRU cache for TokenCountResult keyed by a stable content hash.
 * Avoids redundant tiktoken/native computation on the same content block.
 */
export class TokenCountCache {
	private readonly maxSize: number
	private readonly cache = new Map<string, TokenCountResult>()

	constructor(maxSize = DEFAULT_MAX_SIZE) {
		this.maxSize = maxSize
	}

	private static hashContent(content: unknown): string {
		const serialized = typeof content === "string" ? content : JSON.stringify(content)
		return crypto.createHash("sha256").update(serialized).digest("hex")
	}

	get(content: unknown): TokenCountResult | undefined {
		const key = TokenCountCache.hashContent(content)
		const entry = this.cache.get(key)
		if (entry === undefined) {
			return undefined
		}
		// Move to end (most-recently-used) by re-inserting.
		this.cache.delete(key)
		this.cache.set(key, entry)
		return entry
	}

	set(content: unknown, result: TokenCountResult): void {
		const key = TokenCountCache.hashContent(content)
		if (this.cache.has(key)) {
			this.cache.delete(key)
		} else if (this.cache.size >= this.maxSize) {
			// Evict least-recently-used (first entry).
			const oldest = this.cache.keys().next().value
			if (oldest !== undefined) {
				this.cache.delete(oldest)
			}
		}
		this.cache.set(key, result)
	}

	get size(): number {
		return this.cache.size
	}

	clear(): void {
		this.cache.clear()
	}
}

export const tokenCountCache = new TokenCountCache()
