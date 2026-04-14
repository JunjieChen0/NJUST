/**
 * Sub-task configuration for context isolation and specialization.
 * Inspired by Claude Code's Fork mode and specialized sub-agents.
 */

export type SubAgentType =
	| "explore" // Code exploration: read-only tools, focused on search and understanding
	| "implement" // Implementation: full write permissions
	| "verify" // Verification: run tests and checks
	| "custom" // Custom: inherits parent tools

export type IsolationLevel = "shared" | "forked"

export interface SubTaskOptions {
	/** Isolation level for the sub-task context */
	isolationLevel: IsolationLevel
	/** Independent context budget for the sub-task (tokens) */
	contextBudget?: number
	/** Sub-task type determines available tools and prompt */
	agentType: SubAgentType
	/** Override: specific tools available (empty = inherit from type) */
	tools?: string[]
	/** Maximum result size to inject back into parent context */
	maxResultChars?: number
}

/** Default tool sets per agent type */
export const AGENT_TYPE_TOOLS: Record<SubAgentType, string[]> = {
	explore: ["read_file", "search_files", "list_files", "list_code_definition_names", "codebase_search"],
	implement: ["read_file", "write_to_file", "apply_diff", "execute_command", "search_files"],
	verify: ["read_file", "execute_command", "search_files", "list_files"],
	custom: [], // inherits parent task tools
}

/** Default context budgets per agent type */
export const AGENT_TYPE_CONTEXT_BUDGET: Record<SubAgentType, number> = {
	explore: 32_000,
	implement: 64_000,
	verify: 32_000,
	custom: 64_000,
}

/** Get effective tools for a sub-agent type, with optional overrides */
export function getEffectiveTools(options: SubTaskOptions): string[] {
	if (options.tools && options.tools.length > 0) {
		return options.tools
	}
	return AGENT_TYPE_TOOLS[options.agentType]
}

/** Get effective context budget for a sub-agent type */
export function getEffectiveContextBudget(options: SubTaskOptions): number {
	return options.contextBudget ?? AGENT_TYPE_CONTEXT_BUDGET[options.agentType]
}

/** Configuration for forked context generation */
export interface ForkedContextConfig {
	/** Maximum tokens for the parent context summary */
	summaryMaxTokens: number
	/** Maximum number of recent parent messages to consider */
	maxRecentMessages: number
	/** Whether to include file modification info in the summary */
	includeFileChanges: boolean
	/** Whether to include command execution info in the summary */
	includeCommands: boolean
	/** Maximum characters for the result summary injected back into parent */
	maxResultChars: number
}

export interface TaskResult {
	success: boolean
	summary: string
	isolationLevel?: IsolationLevel
	error?: string
}

/** Default configuration for forked context */
export const DEFAULT_FORKED_CONTEXT_CONFIG: ForkedContextConfig = {
	summaryMaxTokens: 10_000,
	maxRecentMessages: 10,
	includeFileChanges: true,
	includeCommands: true,
	maxResultChars: 2000,
}
