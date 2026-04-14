/**
 * Prefetch coordination module.
 * Starts all prefetch operations in parallel at the beginning of each agent loop turn.
 */

import { globalSkillPrefetcher } from "./skillPrefetch"
import { globalMemoryPrefetcher } from "./memoryPrefetch"

export { globalSkillPrefetcher, SkillPrefetcher } from "./skillPrefetch"
export type { SkillPrefetchResult } from "./skillPrefetch"
export { globalMemoryPrefetcher, MemoryPrefetcher } from "./memoryPrefetch"
export type { MemoryPrefetchResult } from "./memoryPrefetch"

/**
 * Start all prefetch operations in parallel.
 * Call this at the beginning of each agent loop iteration.
 */
export function startAllPrefetch(options: {
	skillFetchFn?: () => Promise<string[]>
	memoryFetchFn?: () => Promise<string[]>
}): void {
	if (options.skillFetchFn) {
		globalSkillPrefetcher.startPrefetch(options.skillFetchFn)
	}
	if (options.memoryFetchFn) {
		globalMemoryPrefetcher.startPrefetch(options.memoryFetchFn)
	}
}
