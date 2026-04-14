/**
 * Async Hook Registry
 *
 * Manages registration and execution of hooks with priority ordering.
 * Inspired by Claude Code's AsyncHookRegistry.
 *
 * Initially serves as an internal extension point. Can be opened to
 * users/plugins in future iterations.
 */

import { HookType, AnyHookContext, HookHandler, RegisteredHook, HookResult } from "./types"

export class HookRegistry {
	private hooks: Map<HookType, RegisteredHook[]> = new Map()
	private nextId: number = 1

	/**
	 * Register a hook handler.
	 * @returns Hook ID for later removal
	 */
	register<T extends AnyHookContext>(
		hookType: HookType,
		name: string,
		handler: HookHandler<T>,
		priority: number = 100,
	): string {
		const id = `hook_${this.nextId++}`
		const hook: RegisteredHook = {
			id,
			name,
			hookType,
			handler: handler as HookHandler,
			priority,
		}

		const existing = this.hooks.get(hookType) || []
		existing.push(hook)
		// Sort by priority (ascending)
		existing.sort((a, b) => a.priority - b.priority)
		this.hooks.set(hookType, existing)

		return id
	}

	/**
	 * Unregister a hook by ID.
	 */
	unregister(hookId: string): boolean {
		const hookTypes = Array.from(this.hooks.keys())
		for (const type of hookTypes) {
			const hooks = this.hooks.get(type)!
			const index = hooks.findIndex((h) => h.id === hookId)
			if (index !== -1) {
				hooks.splice(index, 1)
				return true
			}
		}
		return false
	}

	/**
	 * Execute all hooks of the given type in priority order.
	 * For pre-hooks: stops if any handler returns { abort: true }.
	 * For post-hooks: runs all handlers regardless.
	 *
	 * @returns Combined result - abort if any pre-hook aborted
	 */
	async execute<T extends AnyHookContext>(context: T): Promise<HookResult> {
		const hooks = this.hooks.get(context.hookType) || []

		for (const hook of hooks) {
			try {
				const result = await hook.handler(context)

				// For pre-hooks, check abort
				if (result && result.abort && context.hookType.startsWith("pre")) {
					return {
						abort: true,
						message: result.message || `Aborted by hook "${hook.name}"`,
					}
				}
			} catch (error) {
				// Hook errors should not crash the main flow
				console.error(`[HookRegistry] Hook "${hook.name}" (${hook.hookType}) threw:`, error)
			}
		}

		return { abort: false }
	}

	/**
	 * Get all registered hooks for a given type.
	 */
	getHooks(hookType: HookType): readonly RegisteredHook[] {
		return this.hooks.get(hookType) || []
	}

	/**
	 * Get total number of registered hooks.
	 */
	get size(): number {
		let total = 0
		const allHooks = Array.from(this.hooks.values())
		for (const hooks of allHooks) {
			total += hooks.length
		}
		return total
	}

	/**
	 * Clear all registered hooks.
	 */
	clear(): void {
		this.hooks.clear()
	}
}

// Global singleton
export const globalHookRegistry = new HookRegistry()
