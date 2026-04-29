import * as vscode from "vscode"
import * as path from "path"
import * as fsSync from "fs"

/**
 * Checks if a file path is outside all workspace folders.
 * Uses realpath to resolve symlinks and prevent path traversal bypasses.
 * Falls back to logical path when realpath fails (e.g., file does not exist yet).
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

	// Resolve symlinks for the target path
	let realTarget: string
	try {
		realTarget = fsSync.realpathSync(absolutePath)
	} catch {
		// File may not exist yet (e.g., write_to_file creating new file)
		realTarget = absolutePath
	}

	// Check if the resolved path is within any workspace folder
	return !vscode.workspace.workspaceFolders.some((folder) => {
		let realFolder: string
		try {
			realFolder = fsSync.realpathSync(folder.uri.fsPath)
		} catch {
			realFolder = folder.uri.fsPath
		}
		return realTarget === realFolder || realTarget.startsWith(realFolder + path.sep)
	})
}
