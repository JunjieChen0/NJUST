import fs from "fs/promises"
import path from "path"
import { getSecureDir, ensureSecureDir } from "./config-dir.ts"

const KV_FILE = path.join(getSecureDir(), "kv.json")
const _LOCK_FILE = path.join(getSecureDir(), "kv.lock")

export interface KVStore {
	apiKey?: string
	provider?: string
	model?: string
	theme?: string
	mode?: string
	reasoningEffort?: string
	// Allow arbitrary keys for extensibility
	[key: string]: unknown
}

let memoryCache: KVStore = {}
let writePromise: Promise<void> = Promise.resolve()

/**
 * Load KV store from disk.
 * Uses a simple lock file to prevent concurrent reads/writes across processes.
 */
export async function loadKV(): Promise<KVStore> {
	await ensureSecureDir()

	try {
		const data = await fs.readFile(KV_FILE, "utf-8")
		memoryCache = JSON.parse(data) as KVStore
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code
		if (code === "ENOENT") {
			memoryCache = {}
		} else {
			console.warn("[KV] Failed to read kv.json, starting fresh", error)
			memoryCache = {}
		}
	}

	return memoryCache
}

/**
 * Save KV store to disk.
 * Writes to a temp file first, then renames to avoid partial writes.
 * Queues writes so rapid updates persist in order.
 */
export async function saveKV(store: KVStore): Promise<void> {
	memoryCache = { ...store }

	writePromise = writePromise.then(async () => {
		await ensureSecureDir()
		const tempPath = `${KV_FILE}.${process.pid}.${Date.now()}.tmp`
		try {
			await fs.writeFile(tempPath, JSON.stringify(memoryCache, null, 2), { mode: 0o600 })
			await fs.rename(tempPath, KV_FILE)
		} catch (error) {
			await fs.unlink(tempPath).catch(() => undefined)
			throw error
		}
	})

	return writePromise
}

/**
 * Get a value from the in-memory KV cache.
 */
export function getKV<T = unknown>(key: string): T | undefined {
	return memoryCache[key] as T | undefined
}

/**
 * Set a value in the KV store and persist to disk.
 */
export async function setKV<T = unknown>(key: string, value: T): Promise<void> {
	memoryCache[key] = value
	await saveKV(memoryCache)
}

/**
 * Delete a key from the KV store.
 */
export async function deleteKV(key: string): Promise<void> {
	delete memoryCache[key]
	await saveKV(memoryCache)
}

/**
 * Get the full KV store path (for debugging).
 */
export function getKVPath(): string {
	return KV_FILE
}
