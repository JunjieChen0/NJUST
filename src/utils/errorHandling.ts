/**
 * Error handler for `.catch()` that silently ignores AbortError
 * (thrown when a task/request is cancelled) and re-throws everything else.
 */
export function ignoreAbortError(error: unknown): void {
	if (error instanceof Error && error.name === "AbortError") {
		return
	}

	throw error
}
