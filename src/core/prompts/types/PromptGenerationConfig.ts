/**
 * Optional knobs for system prompt assembly (incremental migration from ad-hoc parameters).
 */
export type PromptGenerationConfig = {
	/** Override Cangjie context section token budget when set. */
	cangjieContextTokenBudget?: number
}
