/**
 * Unified logger for NJUST_AI.
 * Provides scope-prefixed logging across four levels.
 * Zero external dependencies; does not depend on VS Code API.
 *
 * All arguments pass through {@link redactSecrets} so that API keys, bearer
 * tokens and inline credentials never end up in console output / output
 * channels / telemetry files, even when a caller logs a raw command string or
 * an error object. This is a last line of defence; callers should still avoid
 * deliberately logging secrets.
 *
 * Usage:
 *   logger.error("Scope", "message", err)
 *   logger.warn("Scope", "message")
 *   logger.info("Scope", "message")
 *   logger.debug("Scope", "message")  // dev/debug only
 */

const REDACTED = "[REDACTED]"

/** Each rule is a regex plus a replacer run over the FINAL serialized string. */
type RedactRule = { pattern: RegExp; replace: (...args: string[]) => string }

const REDACT_RULES: RedactRule[] = [
	// Common provider key prefixes: sk-, ant-api, ghp_, xai-, AKIA, gho_, etc.
	{
		pattern:
			/\b(?:sk-[A-Za-z0-9_-]{16,}|ant-api[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g,
		replace: () => REDACTED,
	},
	// Bearer token in a header/assignment: "Authorization: Bearer xxx".
	{
		pattern: /(Authorization\s*[:=]\s*Bearer\s+)\S+/gi,
		replace: (_match: string, prefix: string) => `${prefix}${REDACTED}`,
	},
	// Generic key/secret/token/password assignments (env vars, JSON, CLI flags).
	{
		pattern:
			/((?:api[_-]?key|apikey|secret|token|password|passwd|auth|credential|access[_-]?key)["'\s]*[:=]["'\s]*)([^\s"',;&}]{6,})/gi,
		replace: (_match: string, prefix: string) => `${prefix}${REDACTED}`,
	},
	// Basic-auth credentials embedded in URLs: https://user:pass@host
	{
		pattern: /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
		replace: (_match: string, scheme: string) => `${scheme}${REDACTED}@`,
	},
	// Private key blocks.
	{
		pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
		replace: () => REDACTED,
	},
]

export function redactSecrets(text: string): string {
	let result = text
	for (const { pattern, replace } of REDACT_RULES) {
		result = result.replace(pattern, replace)
	}
	return result
}

let _debugEnabled: boolean | undefined

function isDebugEnabled(): boolean {
	if (_debugEnabled === undefined) {
		_debugEnabled =
			process.env.NODE_ENV === "development" ||
			process.env.DEBUG !== undefined ||
			(typeof process !== "undefined" && process.env && process.env.VSCODE_DEBUG_MODE === "true")
	}
	return _debugEnabled
}

/**
 * Invalidate cached debug flag.
 * Call if environment variables change at runtime.
 */
export function invalidateDebugCache(): void {
	_debugEnabled = undefined
}

function serializeArg(arg: unknown): string {
	if (arg === null) return "null"
	if (arg === undefined) return "undefined"
	if (typeof arg === "string") return arg
	if (arg instanceof Error) return `Error: ${arg.message}\n${arg.stack || ""}`
	try {
		return JSON.stringify(
			arg,
			(_key, value) => {
				if (typeof value === "bigint") return `BigInt(${value})`
				if (typeof value === "function") return `Function: ${value.name || "anonymous"}`
				if (typeof value === "symbol") return value.toString()
				return value
			},
			2,
		)
	} catch {
		return `[Non-serializable: ${Object.prototype.toString.call(arg)}]`
	}
}

function formatMessage(scope: string, message: string, args: readonly unknown[]): string {
	const prefix = `[${scope}] ${message}`
	const serialized = args.length === 0 ? "" : ` ${args.map(serializeArg).join(" ")}`
	// Redact AFTER full serialization so object/Error arguments are covered.
	return redactSecrets(`${prefix}${serialized}`)
}

export const logger = {
	error(scope: string, message: string, ...args: unknown[]): void {
		console.error(formatMessage(scope, message, args))
	},

	warn(scope: string, message: string, ...args: unknown[]): void {
		console.warn(formatMessage(scope, message, args))
	},

	info(scope: string, message: string, ...args: unknown[]): void {
		console.log(formatMessage(scope, message, args))
	},

	debug(scope: string, message: string, ...args: unknown[]): void {
		if (!isDebugEnabled()) return
		console.debug(formatMessage(scope, message, args))
	},
}
