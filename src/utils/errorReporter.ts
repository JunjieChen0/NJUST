/**
 * Central place for extension-host errors that must not be silently dropped.
 * Keeps console structured; optional future hook (telemetry/UI) can subscribe here.
 */
export function reportExtensionError(scope: string, error: unknown, context?: Record<string, unknown>): void {
	const msg = error instanceof Error ? error.message : String(error)
	const stack = error instanceof Error ? error.stack : undefined
	const parts = [`[${scope}]`, msg]
	if (context && Object.keys(context).length > 0) {
		try {
			parts.push(JSON.stringify(context))
		} catch {
			parts.push("[context: non-serializable]")
		}
	}
	console.error(parts.join(" "))
	if (stack && process.env.NODE_ENV === "development") {
		console.error(stack)
	}
}
