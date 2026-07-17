import { NamedError } from "@njust-ai/types"

export type OperationalErrorCode =
	| "unauthorized"
	| "forbidden"
	| "invalid_input"
	| "resource_limit"
	| "outside_workspace"
	| "user_rejected"
	| "timeout"
	| "external_service"
	| "internal"

const SAFE_MESSAGES: Record<OperationalErrorCode, string> = {
	unauthorized: "Authentication required.",
	forbidden: "Access denied.",
	invalid_input: "Invalid input provided.",
	resource_limit: "Resource limit exceeded.",
	outside_workspace: "Operation outside workspace boundary.",
	user_rejected: "Operation rejected by user.",
	timeout: "Operation timed out.",
	external_service: "External service error.",
	internal: "Internal error.",
}

export class OperationalError extends NamedError {
	readonly code: OperationalErrorCode
	readonly safeMessage: string

	constructor(
		code: OperationalErrorCode,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options)
		this.name = "OperationalError"
		this.code = code
		this.safeMessage = SAFE_MESSAGES[code]
	}

	toSafeSummary(): string {
		return `[${this.code}] ${this.safeMessage}`
	}
}

export function isOperationalError(e: unknown): e is OperationalError {
	return e instanceof OperationalError
}

export function toOperationalError(e: unknown): OperationalError {
	if (isOperationalError(e)) return e
	const message = e instanceof Error ? e.message : String(e)
	return new OperationalError("internal", message)
}
