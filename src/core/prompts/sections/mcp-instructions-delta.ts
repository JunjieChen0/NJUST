const snapshotByTask = new Map<string, string>()

/**
 * Compute incremental MCP instruction payload compared to previous snapshot.
 */
export function computeMcpInstructionsDelta(taskId: string, current: string): string {
	const prev = snapshotByTask.get(taskId) ?? ""
	snapshotByTask.set(taskId, current)
	if (!prev) return current
	if (prev === current) return ""
	if (current.startsWith(prev)) return current.slice(prev.length)
	// Fallback: return full when structure changed
	return current
}

export function clearMcpInstructionsDelta(taskId: string): void {
	snapshotByTask.delete(taskId)
}
