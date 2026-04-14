import * as fs from "fs/promises"

type Entry = {
	content: string
	mtimeMs: number
	size: number
}

/**
 * Lightweight in-memory LRU cache for text file reads.
 * Invalidates by mtime+size to avoid stale reads.
 */
export class FileReadCache {
	private readonly maxEntries: number
	private readonly map = new Map<string, Entry>()

	constructor(maxEntries = 128) {
		this.maxEntries = Math.max(8, maxEntries)
	}

	private touch(key: string, entry: Entry): void {
		this.map.delete(key)
		this.map.set(key, entry)
	}

	private evictIfNeeded(): void {
		while (this.map.size > this.maxEntries) {
			const oldest = this.map.keys().next().value as string | undefined
			if (!oldest) return
			this.map.delete(oldest)
		}
	}

	async getTextFile(fullPath: string, mtimeMs: number, size: number): Promise<string> {
		const cached = this.map.get(fullPath)
		if (cached && cached.mtimeMs === mtimeMs && cached.size === size) {
			this.touch(fullPath, cached)
			return cached.content
		}

		const buffer = await fs.readFile(fullPath)
		const content = buffer.toString("utf-8")
		this.map.set(fullPath, { content, mtimeMs, size })
		this.evictIfNeeded()
		return content
	}

	clear(): void {
		this.map.clear()
	}
}

export const fileReadCache = new FileReadCache()
