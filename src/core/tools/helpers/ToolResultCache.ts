type ToolResultCacheEntry = {
	value: string
	expiresAt: number
}

/**
 * Lightweight TTL cache for read-only tool results.
 */
export class ToolResultCache {
	private readonly ttlMs: number
	private readonly maxEntries: number
	private readonly store = new Map<string, ToolResultCacheEntry>()

	constructor(options?: { ttlMs?: number; maxEntries?: number }) {
		this.ttlMs = options?.ttlMs ?? 15_000
		this.maxEntries = options?.maxEntries ?? 256
	}

	get(key: string): string | undefined {
		const entry = this.store.get(key)
		if (!entry) return undefined
		if (Date.now() > entry.expiresAt) {
			this.store.delete(key)
			return undefined
		}
		return entry.value
	}

	set(key: string, value: string): void {
		if (this.store.size >= this.maxEntries) {
			const oldestKey = this.store.keys().next().value as string | undefined
			if (oldestKey) this.store.delete(oldestKey)
		}
		this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
	}

	makeKey(toolName: string, args: unknown): string {
		return `${toolName}:${JSON.stringify(args ?? {})}`
	}
}

export const toolResultCache = new ToolResultCache()
