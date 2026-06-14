/**
 * Global API request timing utilities.
 *
 * Extracted from Task.ts to avoid circular dependencies.
 * Used by TaskExecutor and TaskStreamProcessor.
 */

/**
 * Timestamp of the last global API request.
 * Used for rate limiting across all tasks.
 */
let lastGlobalApiRequestTime: number | undefined

/**
 * Get the last global API request timestamp.
 */
export function getLastGlobalApiRequestTime(): number | undefined {
	return lastGlobalApiRequestTime
}

/**
 * Set the last global API request timestamp.
 *
 * Uses Math.max to avoid a data race where two concurrent tasks both read
 * the old value, then one writes a newer timestamp that the other
 * immediately clobbers with an older one.  Keeping the maximum is
 * sufficient for rate-limiting purposes and is lock-free.
 */
export function setLastGlobalApiRequestTime(time: number | undefined): void {
	if (time === undefined) {
		lastGlobalApiRequestTime = undefined
		return
	}
	const prev = lastGlobalApiRequestTime
	if (prev === undefined || time > prev) {
		lastGlobalApiRequestTime = time
	}
}
