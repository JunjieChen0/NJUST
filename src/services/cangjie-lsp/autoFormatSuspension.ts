import * as path from "path"

/** Project roots where save-time cjfmt must not run (e.g. while a check-only task is active), with holder counts. */
const suspendedRoots = new Map<string, number>()

function normalize(p: string): string {
	const resolved = path.resolve(p)
	return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/** Suspend save-time auto-format under `root`. Returns an idempotent release function. */
export function suspendCangjieAutoFormat(root: string): () => void {
	const key = normalize(root)
	suspendedRoots.set(key, (suspendedRoots.get(key) ?? 0) + 1)
	let released = false
	return () => {
		if (released) return
		released = true
		const remaining = (suspendedRoots.get(key) ?? 1) - 1
		if (remaining > 0) suspendedRoots.set(key, remaining)
		else suspendedRoots.delete(key)
	}
}

export function isCangjieAutoFormatSuspended(filePath: string): boolean {
	const target = normalize(filePath)
	for (const root of suspendedRoots.keys()) {
		if (target === root || target.startsWith(root + path.sep)) return true
	}
	return false
}
