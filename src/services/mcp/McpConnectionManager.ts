/**
 * Connection map / refcount coordination (plan Task 6).
 * `McpHub` still owns runtime state; use this module for new code that should not touch the hub directly.
 */
export type McpConnectionManagerSeam = {
	readonly note: "Incremental extraction from McpHub"
}
