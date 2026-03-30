/**
 * Error handler for `.catch()` that silently ignores AbortError
 * (thrown when a task/request is cancelled) and AskIgnoredError
 * (thrown by `Task#ask()` when a partial message is added/updated,
 * which is intentional control-flow and not an actual error).
 *
 * Re-throws everything else.
 */
export function ignoreAbortError(error: unknown): void {
	if (error instanceof Error && (error.name === "AbortError" || error.name === "AskIgnoredError")) {
		return
	}

	throw error
}
