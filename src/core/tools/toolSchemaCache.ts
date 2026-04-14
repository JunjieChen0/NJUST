/**
 * Tool Schema Cache
 *
 * Caches serialized tool definitions to avoid redundant construction
 * and serialization on every API call. Session-level cache that invalidates
 * on configuration changes.
 */

import type OpenAI from "openai"

export interface CachedToolSchema {
	name: string
	schema: OpenAI.Chat.ChatCompletionTool
	hash: string
}

export class ToolSchemaCache {
	private cache: Map<string, CachedToolSchema> = new Map()
	private configHash: string | null = null

	/**
	 * Get a cached tool schema, or null if not cached/stale.
	 */
	get(toolName: string): CachedToolSchema | null {
		return this.cache.get(toolName) ?? null
	}

	/**
	 * Set a tool schema in the cache.
	 */
	set(toolName: string, schema: CachedToolSchema): void {
		this.cache.set(toolName, schema)
	}

	/**
	 * Check if the configuration has changed (tools list, MCP config, etc.)
	 * If changed, clear the cache.
	 */
	validateConfig(newConfigHash: string): boolean {
		if (this.configHash !== null && this.configHash !== newConfigHash) {
			this.clear()
			this.configHash = newConfigHash
			return false // cache was invalidated
		}
		this.configHash = newConfigHash
		return true // cache is still valid
	}

	/**
	 * Get all cached tool schemas as an array of tools.
	 */
	getAllTools(): OpenAI.Chat.ChatCompletionTool[] {
		return Array.from(this.cache.values()).map((cached) => cached.schema)
	}

	/**
	 * Get cache size (number of cached tool schemas)
	 */
	get size(): number {
		return this.cache.size
	}

	clear(): void {
		this.cache.clear()
		this.configHash = null
	}
}

export const globalToolSchemaCache = new ToolSchemaCache()
