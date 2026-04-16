import { createHash } from "crypto"

export interface CompletionCacheOptions {
	maxEntries: number
	ttlMs: number
}

export interface CompletionCacheKeyParts {
	filePath: string
	line: number
	character: number
	prefixHash: string
	engine: "cangjie" | "generic"
}

/**
 * LRU + TTL cache for inline completion results.
 */
export class CompletionCache {
	private readonly opts: CompletionCacheOptions
	private readonly map = new Map<string, { value: string; expires: number }>()

	constructor(opts: CompletionCacheOptions) {
		this.opts = opts
	}

	static hashPrefix(prefix: string): string {
		return createHash("sha256").update(prefix.slice(0, 20), "utf8").digest("hex").slice(0, 16)
	}

	makeKey(parts: CompletionCacheKeyParts): string {
		return `${parts.engine}|${parts.filePath}|${parts.line}|${parts.character}|${parts.prefixHash}`
	}

	get(key: string): string | undefined {
		const hit = this.map.get(key)
		if (!hit) return undefined
		if (Date.now() > hit.expires) {
			this.map.delete(key)
			return undefined
		}
		// LRU touch: re-insert
		this.map.delete(key)
		this.map.set(key, hit)
		return hit.value
	}

	set(key: string, value: string): void {
		if (this.map.size >= this.opts.maxEntries) {
			const first = this.map.keys().next().value as string | undefined
			if (first !== undefined) this.map.delete(first)
		}
		this.map.set(key, { value, expires: Date.now() + this.opts.ttlMs })
	}
}
