/**
 * Node 20 can emit this protocol error from its inspector HTTP bridge while
 * VS Code is attached to the extension host. It is not an application error,
 * but it is delivered through process-level uncaughtException handling.
 */
export function isKnownNodeInspectorProtocolError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false

	const candidate = error as { message?: unknown; stack?: unknown }
	return (
		candidate.message === "Missing dataLength in event" &&
		typeof candidate.stack === "string" &&
		candidate.stack.includes("broadcastToFrontend (node:inspector:") &&
		candidate.stack.includes("dataReceived (node:inspector:")
	)
}
