/**
 * Pure helpers for extracting Cangjie import package prefixes from source text.
 * Shared by prompt context and symbol index (no vscode dependency).
 */

const IMPORT_REGEX = /^\s*import\s+([\w.]+)\.\*?\s*$/gm
const IMPORT_BRACE_REGEX = /^\s*import\s+([\w.]+)\s*(?=\{)/gm
const FROM_IMPORT_REGEX = /^\s*from\s+([\w.]+)\s+import\s+/gm

/** Package prefixes like `std.io`, `foo.bar` (no trailing dot). */
export function extractCangjieImportPackagePrefixes(content: string): string[] {
	const imports: string[] = []
	let match: RegExpExecArray | null

	IMPORT_REGEX.lastIndex = 0
	while ((match = IMPORT_REGEX.exec(content)) !== null) {
		imports.push(match[1])
	}

	IMPORT_BRACE_REGEX.lastIndex = 0
	while ((match = IMPORT_BRACE_REGEX.exec(content)) !== null) {
		imports.push(match[1].replace(/\.+$/, ""))
	}

	FROM_IMPORT_REGEX.lastIndex = 0
	while ((match = FROM_IMPORT_REGEX.exec(content)) !== null) {
		imports.push(match[1])
	}

	return [...new Set(imports)]
}

/**
 * True if `posixRelPath` (forward slashes) plausibly belongs to package `pkg` (`a.b.c` → `a/b/c`).
 * Avoids substring false positives (e.g. `utils` vs `my_utils`).
 */
export function posixPathMatchesImportPackage(posixRelPath: string, pkg: string): boolean {
	const norm = posixRelPath.replace(/\\/g, "/").replace(/^\/+/, "")
	const needle = pkg.replace(/\./g, "/")
	if (!needle) return false
	if (norm === needle) return true
	if (norm.startsWith(needle + "/")) return true
	if (norm.includes("/" + needle + "/")) return true
	if (norm.endsWith("/" + needle)) return true
	return false
}
