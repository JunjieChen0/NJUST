/**
 * Reads `detail.target.value` from VS Code webview custom events.
 * The UI toolkit dispatches CustomEvent-like objects for its inputs, which
 * React's synthetic event typings do not describe.
 */
export function getCustomEventValue(event: unknown): string | undefined {
	const detail = (event as { detail?: { target?: { value?: unknown } } })?.detail
	const value = detail?.target?.value
	return typeof value === "string" ? value : undefined
}
