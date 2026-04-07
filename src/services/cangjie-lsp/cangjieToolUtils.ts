import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { Package } from "../../shared/package"

/**
 * Detect CANGJIE_HOME from environment or well-known install locations.
 */
export function detectCangjieHome(): string | undefined {
	if (process.env.CANGJIE_HOME && fs.existsSync(process.env.CANGJIE_HOME)) {
		return process.env.CANGJIE_HOME
	}

	const wellKnownPaths = process.platform === "win32"
		? ["D:\\cangjie", "C:\\cangjie", path.join(process.env.LOCALAPPDATA || "", "cangjie")]
		: ["/usr/local/cangjie", path.join(process.env.HOME || "", ".cangjie")]

	for (const p of wellKnownPaths) {
		if (p && fs.existsSync(path.join(p, "bin"))) {
			return p
		}
	}

	return undefined
}

/**
 * Build environment variables for running Cangjie SDK tools.
 * Ensures runtime libraries are on PATH / LD_LIBRARY_PATH.
 */
export function buildCangjieToolEnv(cangjieHome?: string): Record<string, string> {
	const home = cangjieHome || detectCangjieHome()
	if (!home) return { ...process.env } as Record<string, string>

	const env = { ...process.env } as Record<string, string>
	env["CANGJIE_HOME"] = home

	const sep = process.platform === "win32" ? ";" : ":"
	const extraPaths: string[] = []

	if (process.platform === "win32") {
		extraPaths.push(path.join(home, "runtime", "lib", "windows_x86_64_llvm"))
		extraPaths.push(path.join(home, "lib", "windows_x86_64_llvm"))
	} else {
		extraPaths.push(path.join(home, "runtime", "lib", "linux_x86_64_llvm"))
		extraPaths.push(path.join(home, "lib", "linux_x86_64_llvm"))
	}
	extraPaths.push(path.join(home, "bin"))
	extraPaths.push(path.join(home, "tools", "bin"))
	extraPaths.push(path.join(home, "tools", "lib"))

	const existing = env["PATH"] || env["Path"] || ""
	const pathKey = process.platform === "win32" ? "Path" : "PATH"
	env[pathKey] = extraPaths.filter((p) => fs.existsSync(p)).join(sep) + sep + existing

	if (process.platform !== "win32") {
		const ldPaths = extraPaths.filter((p) => fs.existsSync(p))
		const existingLd = env["LD_LIBRARY_PATH"] || ""
		if (ldPaths.length > 0) {
			env["LD_LIBRARY_PATH"] = ldPaths.join(sep) + (existingLd ? sep + existingLd : "")
		}
	}

	return env
}

/**
 * Resolve a Cangjie SDK tool executable by checking:
 * 1. User-configured path in settings
 * 2. CANGJIE_HOME environment variable
 * 3. Well-known install locations
 * 4. System PATH (fallback)
 */
export function resolveCangjieToolPath(
	toolName: string,
	configKey?: string,
): string | undefined {
	if (configKey) {
		const configured = vscode.workspace
			.getConfiguration(Package.name)
			.get<string>(configKey, "")
		if (configured) {
			const resolved = path.resolve(configured)
			if (fs.existsSync(resolved)) return resolved
			return undefined
		}
	}

	const exeName = process.platform === "win32" ? `${toolName}.exe` : toolName

	const cangjieHome = detectCangjieHome()
	if (cangjieHome) {
		const candidates = [
			path.join(cangjieHome, "bin", exeName),
			path.join(cangjieHome, "tools", "bin", exeName),
		]
		for (const c of candidates) {
			if (fs.existsSync(c)) return c
		}
	}

	return exeName
}

// ---------------------------------------------------------------------------
// LSP ahead-of-time query utilities
// ---------------------------------------------------------------------------

/**
 * Get all symbol definitions in a file with their signatures.
 * Useful for AI to understand what a file exports before modifying it.
 */
export function getSymbolContextForFile(filePath: string): string | null {
	// Lazy import to avoid circular dependency at module load time
	const { CangjieSymbolIndex } = require("./CangjieSymbolIndex")
	const index = CangjieSymbolIndex.getInstance()
	if (!index) return null

	const normalized = path.resolve(filePath)
	const symbols = index.getSymbolsByDirectory(path.dirname(normalized))
		.filter((s: { filePath: string }) => path.resolve(s.filePath) === normalized)

	if (symbols.length === 0) return null

	const lines = symbols.map((s: { kind: string; name: string; signature: string; startLine: number }) => {
		const sig = s.signature ? `: \`${s.signature}\`` : ""
		return `- ${s.kind} **${s.name}**${sig} (line ${s.startLine + 1})`
	})

	return `文件 ${path.basename(filePath)} 的符号:\n${lines.join("\n")}`
}

/**
 * Find all references to a symbol name across the workspace.
 * Helps AI understand impact before renaming or modifying a function/type.
 */
export function getReferencesForSymbol(symbolName: string): string | null {
	const { CangjieSymbolIndex } = require("./CangjieSymbolIndex")
	const index = CangjieSymbolIndex.getInstance()
	if (!index) return null

	const refs = index.findReferences(symbolName)
	if (refs.length === 0) return null

	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ""
	const grouped = new Map<string, number[]>()

	for (const ref of refs.slice(0, 50)) {
		const relPath = path.relative(cwd, ref.filePath).replace(/\\/g, "/")
		if (!grouped.has(relPath)) grouped.set(relPath, [])
		grouped.get(relPath)!.push(ref.line + 1)
	}

	const lines = Array.from(grouped.entries()).map(
		([file, lineNums]) => `- ${file}: 行 ${lineNums.slice(0, 10).join(", ")}${lineNums.length > 10 ? " …" : ""}`,
	)

	return `符号 "${symbolName}" 的引用 (${refs.length} 处):\n${lines.join("\n")}`
}

/**
 * Auto-detect the correct `package` declaration for a file based on its
 * path relative to the project's src directory.
 * Returns null if the package can't be determined.
 */
export function autoDetectPackageDeclaration(filePath: string): string | null {
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	if (!cwd) return null

	const cjpmToml = path.join(cwd, "cjpm.toml")
	if (!fs.existsSync(cjpmToml)) return null

	try {
		const content = fs.readFileSync(cjpmToml, "utf-8")
		const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m)
		const srcDirMatch = content.match(/^\s*src-dir\s*=\s*"([^"]+)"/m)
		const rootName = nameMatch?.[1] || "default"
		const srcDir = srcDirMatch?.[1] || "src"

		const srcRoot = path.join(cwd, srcDir)
		const absFile = path.resolve(filePath)

		if (!absFile.startsWith(srcRoot)) return null

		const relDir = path.relative(srcRoot, path.dirname(absFile))
		if (!relDir || relDir === ".") {
			return rootName
		}

		const subPackage = relDir.replace(/[\\/]/g, ".")
		return `${rootName}.${subPackage}`
	} catch {
		return null
	}
}
