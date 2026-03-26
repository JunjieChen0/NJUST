import * as vscode from "vscode"
import fs from "fs/promises"
import * as path from "path"

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"])

function getMimeType(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase()
	switch (ext) {
		case ".png":
			return "image/png"
		case ".jpeg":
		case ".jpg":
			return "image/jpeg"
		case ".webp":
			return "image/webp"
		default:
			return "application/octet-stream"
	}
}

export type SelectContextFilesResult = {
	/** Non-image paths → @-mentions in the input */
	mentionPaths: string[]
	/** Image files read as data URLs for vision */
	imageDataUrls: string[]
}

/**
 * Open workspace file picker. Image files are read as data URLs; other paths are returned for mentions.
 */
export async function selectContextFiles(): Promise<SelectContextFilesResult> {
	const uris = await vscode.window.showOpenDialog({
		canSelectMany: true,
		openLabel: "Add",
	})

	if (!uris?.length) {
		return { mentionPaths: [], imageDataUrls: [] }
	}

	const mentionPaths: string[] = []
	const imageDataUrls: string[] = []

	for (const uri of uris) {
		const fsPath = uri.fsPath
		const ext = path.extname(fsPath).toLowerCase()
		if (IMAGE_EXTS.has(ext)) {
			try {
				const buffer = await fs.readFile(fsPath)
				const base64 = buffer.toString("base64")
				const mime = getMimeType(fsPath)
				imageDataUrls.push(`data:${mime};base64,${base64}`)
			} catch {
				mentionPaths.push(fsPath)
			}
		} else {
			mentionPaths.push(fsPath)
		}
	}

	return { mentionPaths, imageDataUrls }
}
