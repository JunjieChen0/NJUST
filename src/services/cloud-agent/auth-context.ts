/**
 * Cloud Agent authentication context.
 *
 * This module provides immutable, per-task authentication context types
 * and a factory. There is **no** module-level global state — every consumer
 * receives an explicit `AuthContext` via parameter passing.
 *
 * Token values are intentionally excluded from `AuthContext` to prevent
 * accidental leakage into logs, error messages, or audit records.
 */

export type AuthTokenSource = "global-device-token" | "profile-device-token" | "api-key" | "bearer" | "basic" | "custom"

export interface AuthContext {
	readonly authenticated: boolean
	readonly tokenSource: AuthTokenSource | null
	readonly profileId: string
}

const NO_AUTH: AuthContext = {
	authenticated: false,
	tokenSource: null,
	profileId: "",
}

export interface AuthCheckResult {
	allowed: boolean
	reason?: string
}

/**
 * Create an authenticated context for a Cloud Agent task.
 * Only call this when the profile actually has a non-empty token/key;
 * otherwise use {@link unauthenticatedContext}.
 */
export function createAuthContext(profileId: string, tokenSource: AuthTokenSource): AuthContext {
	return {
		authenticated: true,
		tokenSource,
		profileId,
	}
}

/** Returns the singleton unauthenticated context. */
export function unauthenticatedContext(): AuthContext {
	return NO_AUTH
}

/**
 * Check whether tool execution is permitted under the given auth context.
 */
export function checkToolExecutionAuth(authContext: AuthContext): AuthCheckResult {
	if (!authContext.authenticated) {
		return {
			allowed: false,
			reason:
				"Tool execution denied: no authenticated Cloud Agent session. " +
				"All deferred tool calls require a valid auth context (device token or API key).",
		}
	}
	return { allowed: true }
}
