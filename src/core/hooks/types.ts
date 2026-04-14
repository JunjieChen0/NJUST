/**
 * Hook System Type Definitions
 *
 * Defines the hook types and interfaces for the extensible hook system.
 */

export type HookType =
	| "preToolUse" // Before tool execution
	| "postToolUse" // After tool execution (success)
	| "postToolUseFailure" // After tool execution (failure)
	| "preCompact" // Before context compaction
	| "postCompact" // After context compaction

export interface HookContext {
	/** The hook type being executed */
	hookType: HookType
	/** Task ID for correlation */
	taskId?: string
	/** Timestamp when the hook was triggered */
	timestamp: number
}

export interface PreToolUseContext extends HookContext {
	hookType: "preToolUse"
	toolName: string
	toolInput: Record<string, unknown>
}

export interface PostToolUseContext extends HookContext {
	hookType: "postToolUse"
	toolName: string
	toolInput: Record<string, unknown>
	toolOutput: string
	durationMs: number
}

export interface PostToolUseFailureContext extends HookContext {
	hookType: "postToolUseFailure"
	toolName: string
	toolInput: Record<string, unknown>
	error: string
	durationMs: number
}

export interface PreCompactContext extends HookContext {
	hookType: "preCompact"
	messageCount: number
	tokenCount: number
}

export interface PostCompactContext extends HookContext {
	hookType: "postCompact"
	messageCountBefore: number
	messageCountAfter: number
	tokenCountBefore: number
	tokenCountAfter: number
}

export type AnyHookContext =
	| PreToolUseContext
	| PostToolUseContext
	| PostToolUseFailureContext
	| PreCompactContext
	| PostCompactContext

/**
 * Hook handler function signature.
 * Return value:
 * - void/undefined: continue normally
 * - { abort: true }: cancel the operation (only for pre-hooks)
 */
export type HookHandler<T extends AnyHookContext = AnyHookContext> = (context: T) => Promise<HookResult | void>

export interface HookResult {
	/** If true, abort the operation (only effective for pre-hooks) */
	abort?: boolean
	/** Optional message explaining the abort reason */
	message?: string
}

export interface RegisteredHook<T extends AnyHookContext = AnyHookContext> {
	id: string
	name: string
	hookType: HookType
	handler: HookHandler<T>
	priority: number // Lower number = higher priority (runs first)
}
