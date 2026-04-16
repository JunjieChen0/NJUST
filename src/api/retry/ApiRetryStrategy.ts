/**
 * Exponential backoff with optional Retry-After (seconds) (report D.2).
 */
export type ApiRetryOptions = {
	maxAttempts: number
	baseDelayMs: number
	maxDelayMs: number
	jitterRatio: number
}

export const DEFAULT_API_RETRY_OPTIONS: ApiRetryOptions = {
	maxAttempts: 4,
	baseDelayMs: 1_000,
	maxDelayMs: 60_000,
	jitterRatio: 0.1,
}

export function computeBackoffMs(attempt: number, options: ApiRetryOptions, retryAfterSeconds?: number): number {
	if (retryAfterSeconds !== undefined && retryAfterSeconds >= 0) {
		return Math.min(retryAfterSeconds * 1000, options.maxDelayMs)
	}
	const exp = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** Math.max(0, attempt))
	const jitter = exp * options.jitterRatio * (Math.random() * 2 - 1)
	return Math.max(0, Math.round(exp + jitter))
}

export async function delayMs(ms: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms))
}

export type RetryAttemptInfo = {
	attempt: number
	delayMs: number
	error: unknown
}

/**
 * Stateless retry executor. Wraps an async operation with exponential backoff,
 * honouring Retry-After and the classifier's shouldRetry decision.
 *
 * Usage:
 *   const executor = new ApiRetryExecutor()
 *   const result = await executor.execute(() => provider.fetch(...))
 */
export class ApiRetryExecutor {
	private readonly options: ApiRetryOptions

	constructor(options?: Partial<ApiRetryOptions>) {
		this.options = { ...DEFAULT_API_RETRY_OPTIONS, ...options }
	}

	/**
	 * Execute `fn` with automatic retries.
	 *
	 * @param fn - The async operation to retry
	 * @param shouldRetry - Predicate: given the error and attempt number, return
	 *   `{ retry: boolean; retryAfterSeconds?: number }`. When omitted every
	 *   error is retried up to maxAttempts.
	 * @param onRetry - Optional callback fired before each retry delay.
	 */
	async execute<T>(
		fn: () => Promise<T>,
		shouldRetry?: (error: unknown, attempt: number) => { retry: boolean; retryAfterSeconds?: number },
		onRetry?: (info: RetryAttemptInfo) => void,
	): Promise<T> {
		let lastError: unknown
		for (let attempt = 0; attempt < this.options.maxAttempts; attempt++) {
			try {
				return await fn()
			} catch (error) {
				lastError = error

				if (attempt >= this.options.maxAttempts - 1) {
					break
				}

				const decision = shouldRetry?.(error, attempt) ?? { retry: true }
				if (!decision.retry) {
					break
				}

				const delay = computeBackoffMs(attempt, this.options, decision.retryAfterSeconds)
				onRetry?.({ attempt, delayMs: delay, error })
				await delayMs(delay)
			}
		}
		throw lastError
	}
}
