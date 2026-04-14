import fs from "fs"
import path from "path"

/** Shipped under extensionPath for VSIX (must match sync script + cangjie-context). */
export const BUNDLED_CANGJIE_CORPUS_SEGMENTS = ["bundled-cangjie-corpus", "CangjieCorpus-1.0.0"] as const

let bundledCorpusPathCache: { extensionPath: string; value: string | null } | null = null

/**
 * Absolute path to bundled corpus directory if it exists on disk.
 */
export function getBundledCangjieCorpusPath(extensionPath: string | undefined): string | null {
	if (!extensionPath) return null
	if (bundledCorpusPathCache && bundledCorpusPathCache.extensionPath === extensionPath) {
		return bundledCorpusPathCache.value
	}
	const p = path.join(extensionPath, ...BUNDLED_CANGJIE_CORPUS_SEGMENTS)
	const value = fs.existsSync(p) ? p : null
	bundledCorpusPathCache = { extensionPath, value }
	return value
}

/**
 * True if `absolutePath` is the corpus root or a file/directory inside it.
 */
export function isPathUnderBundledCangjieCorpus(absolutePath: string, extensionPath: string | undefined): boolean {
	const root = getBundledCangjieCorpusPath(extensionPath)
	if (!root) return false
	const abs = path.resolve(absolutePath)
	const base = path.resolve(root)
	const rel = path.relative(base, abs)
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		return false
	}
	return true
}

/**
 * True if `absolutePath` is the corpus root, inside it, or a prefix of it.
 * Highly useful for filtering streaming partial JSON where the path is typed character by character.
 *
 * @param rawPartialPath - The un-resolved path from streaming. On Windows, a partial like "c"
 *   gets resolved relative to cwd (e.g. "D:\proj\c") which loses the drive-letter match.
 *   Passing the raw string enables a direct prefix comparison against the corpus root.
 */
export function isPathPotentiallyUnderCangjieCorpus(
	absolutePath: string,
	extensionPath: string | undefined,
	rawPartialPath?: string,
): boolean {
	const root = getBundledCangjieCorpusPath(extensionPath)
	if (!root) return false

	// Normalize and lowercase for prefix comparison
	const abs = path.resolve(absolutePath).toLowerCase()
	const base = path.resolve(root).toLowerCase()

	if (abs.startsWith(base)) return true
	if (base.startsWith(abs)) return true

	// During streaming, the raw partial path (e.g. "c", "c:", "c:/U") may not resolve
	// correctly because path.resolve treats short partials as relative to cwd.
	// Compare the raw string directly using forward-slash normalisation.
	if (rawPartialPath) {
		const rawNorm = rawPartialPath.replace(/\\/g, "/").toLowerCase()
		const baseNorm = root.replace(/\\/g, "/").toLowerCase()
		if (baseNorm.startsWith(rawNorm) || rawNorm.startsWith(baseNorm)) {
			return true
		}
	}

	return false
}
