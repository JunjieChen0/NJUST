import type { SessionMemory } from "../condense/sessionMemoryCompact"

/**
 * Settings passed to system prompt generation functions
 */
export interface SystemPromptSettings {
	todoListEnabled: boolean
	useAgentRules: boolean
	/** When true, recursively discover and load .njust_ai/rules from subdirectories */
	enableSubfolderRules?: boolean
	newTaskRequireTodos: boolean
	/** When true, model should hide vendor/company identity in responses */
	isStealthModel?: boolean
	/** When true, the web_search tool is available for real-time information */
	enableWebSearch?: boolean
	/**
	 * Max estimated tokens (~chars/4) for the dynamic Cangjie context block.
	 * When set (e.g. from model context window), overrides default unless workspace config wins inside resolver.
	 */
	cangjieContextTokenBudget?: number
	/** Current task id used by prompt delta modules (e.g. MCP instructions delta). */
	taskId?: string
	/** Model context window for prompt token budgeting. */
	contextWindow?: number
	/** Current turn index for adaptive prompt pruning (0-based). */
	turnIndex?: number
	/** Feature flag to enable turn-aware static prompt pruning. */
	enableTurnAwarePromptPruning?: boolean
	/** Cross-session memory from a previous session, injected into the system prompt. */
	sessionMemory?: SessionMemory
}
