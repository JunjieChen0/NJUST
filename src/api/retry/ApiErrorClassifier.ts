import { redactApiSecrets } from "../../utils/redactApiSecrets"

/**
 * Retry / error taxonomy for API calls (report D.2).
 */
export enum ApiErrorCategory {
	RetryableNetwork = "retryable_network",
	RateLimited = "rate_limited",
	ServerError = "server_error",
	ClientError = "client_error",
	Unknown = "unknown",
}

export function classifyHttpStatus(status: number | undefined): ApiErrorCategory {
	if (status === undefined) {
		return ApiErrorCategory.Unknown
	}
	if (status === 429) {
		return ApiErrorCategory.RateLimited
	}
	if (status >= 500) {
		return ApiErrorCategory.ServerError
	}
	if (status >= 400) {
		return ApiErrorCategory.ClientError
	}
	return ApiErrorCategory.Unknown
}

/**
 * Best-effort Retry-After (seconds) from OpenAI-style errors or Response headers.
 */
export function getRetryAfterSecondsFromError(error: unknown): number | undefined {
	const e = error as { headers?: { get?: (n: string) => string | null }; response?: { headers?: Headers } } & {
		retryAfter?: number
	}
	if (typeof e?.retryAfter === "number" && Number.isFinite(e.retryAfter)) {
		return e.retryAfter
	}
	const raw =
		e?.headers?.get?.("retry-after") ??
		(e?.response?.headers && typeof e.response.headers.get === "function"
			? e.response.headers.get("retry-after")
			: undefined)
	if (raw == null || raw === "") {
		return undefined
	}
	const n = Number(raw)
	if (Number.isFinite(n)) {
		return n
	}
	const retryDate = Date.parse(raw)
	if (!Number.isNaN(retryDate)) {
		// Enforce minimum 1s delay to prevent retry storms from clock skew
		return Math.max(1, (retryDate - Date.now()) / 1000)
	}
	return undefined
}

export type ApiRetryDecision = {
	/** Whether a safe automatic retry may be attempted for this failure */
	shouldRetry: boolean
	category: ApiErrorCategory
	/** Optional delay hint in seconds (429, Retry-After) */
	retryAfterSeconds?: number
}

/**
 * Policy for wrapping `createMessage` / stream start: never retry clear auth failures;
 * retry rate limits (honour Retry-After), 5xx, and unknown/network faults.
 */
export function analyzeErrorForRetry(error: unknown): ApiRetryDecision {
	const status =
		(error as { status?: number })?.status ??
		(error as { response?: { status?: number } })?.response?.status

	if (status === 401 || status === 403) {
		return { shouldRetry: false, category: ApiErrorCategory.ClientError }
	}
	if (status === 429) {
		return {
			shouldRetry: true,
			category: ApiErrorCategory.RateLimited,
			retryAfterSeconds: getRetryAfterSecondsFromError(error),
		}
	}
	if (status !== undefined && status >= 500) {
		return { shouldRetry: true, category: ApiErrorCategory.ServerError }
	}
	if (status !== undefined && status >= 400) {
		return { shouldRetry: false, category: ApiErrorCategory.ClientError }
	}
	if (status === undefined) {
		return { shouldRetry: true, category: ApiErrorCategory.RetryableNetwork }
	}
	return { shouldRetry: false, category: ApiErrorCategory.Unknown }
}

/** Safe one-line representation of an error for logs/metrics (strips bearer / sk- style secrets). */
export function redactErrorForTelemetry(error: unknown): string {
	if (error instanceof Error) {
		return redactApiSecrets(`${error.name}: ${error.message}`)
	}
	return redactApiSecrets(String(error))
}
