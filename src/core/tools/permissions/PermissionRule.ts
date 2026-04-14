export type PermissionAction = "allow" | "deny" | "ask"

/**
 * Source of a permission rule, determining its precedence layer.
 * Priority ordering (highest to lowest): policy > policySettings > project > user > session
 *
 * policySettings: organization-level policy configuration (aligns with CC's org policy concept).
 * Inserted between policy and project, preserving existing relative ordering.
 */
export type PermissionSource = "user" | "project" | "policy" | "session" | "policySettings"

/**
 * Numeric weight for each source, used for sorting.
 * Higher value = higher priority.
 */
export const SOURCE_PRIORITY: Record<PermissionSource, number> = {
	policy: 300,
	policySettings: 250,
	project: 200,
	user: 100,
	session: 0,
}

export interface PermissionRule {
	/** Rule identifier */
	id: string
	/** Human-readable description */
	description: string
	/** Which action to take when rule matches */
	action: PermissionAction
	/** Tool name pattern (exact match or glob, e.g. "read_file", "write_*") */
	toolPattern: string
	/** Optional condition function for dynamic rules */
	condition?: (toolName: string, params: Record<string, unknown>) => boolean
	/** Priority (higher = evaluated first) */
	priority: number
	/**
	 * Source layer for this rule. Determines inter-layer precedence.
	 * Defaults to "session" for backward compatibility.
	 */
	source?: PermissionSource
}

// Built-in rule presets

export const READ_ONLY_AUTO_ALLOW: PermissionRule = {
	id: "built-in:read-only-auto-allow",
	description: "Auto-allow read-only tools",
	action: "allow",
	toolPattern: "*",
	condition: (_toolName, _params) => {
		// Placeholder — actual check happens in PermissionRuleEngine
		// which inspects tool.isReadOnly() at evaluation time.
		return false
	},
	priority: 0,
}

export const DESTRUCTIVE_ALWAYS_ASK: PermissionRule = {
	id: "built-in:destructive-always-ask",
	description: "Always ask confirmation for destructive tools",
	action: "ask",
	toolPattern: "*",
	condition: (_toolName, _params) => {
		// Placeholder — actual check happens in PermissionRuleEngine
		// which inspects tool.isDestructive() at evaluation time.
		return false
	},
	priority: 10,
}
