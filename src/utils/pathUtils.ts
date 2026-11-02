import * as vscode from "vscode"
import * as path from "path"
import { resolveRealPathFollowingLinks } from "./resolveRealPath"

/**
 * Real path for the workspace boundary check. Falls back to the given path when
 * it cannot be resolved (e.g. a link loop, which no write can go through either).
 */
function resolveRealPath(filePath: string): string {
	try {
		return resolveRealPathFollowingLinks(filePath)
	} catch {
		return filePath
	}
}

/**
 * Checks if a file path is outside all workspace folders.
 * Uses realpath to resolve symlinks and prevent path traversal bypasses.
 * For non-existent files, finds the nearest existing parent directory and
 * resolves its real path to detect symlink escapes.
 *
 * @param filePath The file path to check
 * @returns true if the path is outside all workspace folders, false otherwise
 */
export function isPathOutsideWorkspace(filePath: string): boolean {
	// If there are no workspace folders, consider everything outside workspace for safety
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		return true
	}

	// Normalize and resolve the path to handle .. and . components correctly
	const absolutePath = path.resolve(filePath)
	const realTarget = resolveRealPath(absolutePath)

	// Check if the resolved path is within any workspace folder
	return !vscode.workspace.workspaceFolders.some((folder) => {
		const realFolder = resolveRealPath(folder.uri.fsPath)
		return realTarget === realFolder || realTarget.startsWith(realFolder + path.sep)
	})
}
