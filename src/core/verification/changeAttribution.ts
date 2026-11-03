import * as path from "path"

import type { ProjectSnapshot } from "./projectFingerprint"
import type { FileChange, AttributedChange } from "./types"

export function diffSnapshots(before: ProjectSnapshot, after: ProjectSnapshot): FileChange[] {
	return [...new Set([...Object.keys(before.files), ...Object.keys(after.files)])].sort().flatMap((filePath) => {
		const previous = before.files[filePath]
		const current = after.files[filePath]
		if (previous === current) return []
		return [
			{
				path: filePath,
				change: previous === undefined ? "added" : current === undefined ? "deleted" : "modified",
			} as FileChange,
		]
	})
}

/** task_tool means the task's edit tools touched this path; all other origins stay unclassified. */
export function attributeChanges(
	changes: readonly FileChange[],
	root: string,
	taskWrittenPaths: readonly string[],
): AttributedChange[] {
	const normalize = (filePath: string) => {
		const resolved = path.resolve(root, filePath)
		return process.platform === "win32" ? resolved.toLowerCase() : resolved
	}
	const written = new Set(taskWrittenPaths.map(normalize))
	return changes.map((change) => ({ ...change, source: written.has(normalize(change.path)) ? "task_tool" : "other" }))
}
