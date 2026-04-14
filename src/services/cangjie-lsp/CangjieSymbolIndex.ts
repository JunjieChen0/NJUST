import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import {
	parseCangjieDefinitions,
	parseCangjieWithFallback,
	computeCangjieSignature,
	extractCangjieDeclarationMeta,
	type CangjieDef,
	type CangjieDefKind,
	type CangjieSymbolVisibility,
} from "../tree-sitter/cangjieParser"
import { Package } from "../../shared/package"
import { extractCangjieImportPackagePrefixes, posixPathMatchesImportPackage } from "./cangjieImportPaths"

const INDEX_DIR = ".cangjie-index"
const INDEX_FILE = "symbols.json"
const INDEX_VERSION = 5
const REFERENCE_RE = /\b([A-Z]\w+|[a-z_]\w*)\b/g

/**
 * Per-line lexer-lite: exclude `//` comments and single-quoted / double-quoted strings.
 * Not full AST; matches how we scan {@link REFERENCE_RE} hits.
 */
function isCodeTokenPosition(line: string, index: number): boolean {
	let inString = false
	let quote = ""
	let escaped = false
	for (let i = 0; i < line.length; i++) {
		const ch = line[i]
		const next = i + 1 < line.length ? line[i + 1] : ""
		if (!inString && ch === "/" && next === "/") {
			return index < i
		}
		if (inString) {
			if (escaped) {
				escaped = false
				continue
			}
			if (ch === "\\") {
				escaped = true
				continue
			}
			if (ch === quote) {
				inString = false
				quote = ""
			}
			if (i === index) return false
		} else if (ch === "\"" || ch === "'") {
			if (i <= index) {
				inString = true
				quote = ch
			}
		}
		if (i === index) return !inString
	}
	return true
}

/** Avoid `"Map"` matching `"HashMap"` / false positives in comments or string literals. */
function symbolNameUsedInSource(symName: string, content: string): boolean {
	if (!symName) return false
	const lines = content.split("\n")
	if (!/^[A-Za-z_]\w*$/.test(symName)) {
		for (const line of lines) {
			let from = 0
			while (from <= line.length) {
				const idx = line.indexOf(symName, from)
				if (idx < 0) break
				if (isCodeTokenPosition(line, idx)) return true
				from = idx + 1
			}
		}
		return false
	}
	try {
		const re = new RegExp(`\\b${symName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g")
		for (const line of lines) {
			let m: RegExpExecArray | null
			re.lastIndex = 0
			while ((m = re.exec(line)) !== null) {
				if (isCodeTokenPosition(line, m.index)) return true
			}
		}
		return false
	} catch {
		for (const line of lines) {
			let from = 0
			while (from <= line.length) {
				const idx = line.indexOf(symName, from)
				if (idx < 0) break
				if (isCodeTokenPosition(line, idx)) return true
				from = idx + 1
			}
		}
		return false
	}
}

export interface SymbolEntry {
	name: string
	kind: CangjieDefKind
	filePath: string
	startLine: number
	endLine: number
	signature: string
	/** From declaration line; omitted in v2 index on disk */
	visibility?: CangjieSymbolVisibility
	modifiers?: string[]
	typeParams?: string
}

export interface ReferenceEntry {
	filePath: string
	line: number
	column: number
}

interface FileEntry {
	mtime: number
	symbols: SymbolEntry[]
	references?: Record<string, Array<{ line: number; column: number }>>
}

interface IndexData {
	version: number
	files: Record<string, FileEntry>
}

export class CangjieSymbolIndex implements vscode.Disposable {
	private static instance: CangjieSymbolIndex | undefined

	private data: IndexData = { version: INDEX_VERSION, files: {} }
	private nameIndex = new Map<string, SymbolEntry[]>()
	private watcher: vscode.FileSystemWatcher | undefined
	private disposables: vscode.Disposable[] = []
	private indexPath: string | undefined
	private dirty = false
	private flushTimer: ReturnType<typeof setTimeout> | undefined
	private indexing = false
	/** mtime-scored raw lines for hot-path reference scans */
	private readFileCache = new Map<string, { mtime: number; lines: string[] }>()
	private referenceIndex = new Map<string, ReferenceEntry[]>()
	private dependencyCache = new Map<string, string[]>()
	private reverseDependencyCache = new Map<string, string[]>()
	private directoryIndex = new Map<string, Set<string>>()
	private _fileCount = 0
	private _symbolCount = 0
	/** Normalized `from|to` primitive keys → short hint for prompt augmentation */
	private conversionEdgeMap = new Map<string, string>()

	constructor(private readonly outputChannel: vscode.OutputChannel) {
		CangjieSymbolIndex.instance = this
	}

	static getInstance(): CangjieSymbolIndex | undefined {
		return CangjieSymbolIndex.instance
	}

	async initialize(): Promise<void> {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
		if (!workspaceFolder) return

		const root = workspaceFolder.uri.fsPath
		const indexDir = path.join(root, INDEX_DIR)
		this.indexPath = path.join(indexDir, INDEX_FILE)

		this.loadFromDisk()

		this.watcher = vscode.workspace.createFileSystemWatcher("**/*.cj")
		this.disposables.push(this.watcher)

		this.watcher.onDidChange((uri) => void this.reindexFile(uri.fsPath))
		this.watcher.onDidCreate((uri) => void this.reindexFile(uri.fsPath))
		this.watcher.onDidDelete((uri) => this.removeFile(uri.fsPath))

		await this.fullIndex(root)
	}

	private loadFromDisk(): void {
		if (!this.indexPath) return
		try {
			if (fs.existsSync(this.indexPath)) {
				const raw = fs.readFileSync(this.indexPath, "utf-8")
				const parsed = JSON.parse(raw) as IndexData
				if (parsed.version === INDEX_VERSION) {
					this.data = parsed
					this.readFileCache.clear()
					this.rebuildNameIndex()
					this.outputChannel.appendLine(`[SymbolIndex] Loaded index with ${Object.keys(this.data.files).length} files`)
				}
			}
		} catch {
			this.data = { version: INDEX_VERSION, files: {} }
		}
	}

	private rebuildNameIndex(): void {
		this.nameIndex.clear()
		this.referenceIndex.clear()
		this.directoryIndex.clear()
		this._fileCount = 0
		this._symbolCount = 0
		for (const [filePath, fileEntry] of Object.entries(this.data.files)) {
			this._fileCount++
			this._symbolCount += fileEntry.symbols.length
			this.addFileToDirectoryIndex(filePath)
			for (const sym of fileEntry.symbols) {
				let list = this.nameIndex.get(sym.name)
				if (!list) { list = []; this.nameIndex.set(sym.name, list) }
				list.push(sym)
			}
			if (fileEntry.references) {
				for (const [name, refs] of Object.entries(fileEntry.references)) {
					let list = this.referenceIndex.get(name)
					if (!list) {
						list = []
						this.referenceIndex.set(name, list)
					}
					for (const ref of refs) list.push({ filePath, line: ref.line, column: ref.column })
				}
			}
		}
		this.rebuildDependencyCaches()
		this.rebuildConversionEdges()
	}

	private rebuildConversionEdges(): void {
		this.conversionEdgeMap.clear()
		const builtIn: Array<[string, string, string]> = [
			["int32", "int64", "快速修复: 使用 `.toInt64()` 或 `Int64(...)`"],
			["uint32", "uint64", "快速修复: 使用 `.toUInt64()` 或 `UInt64(...)`"],
			["int64", "int32", "快速修复: 使用 `.toInt32()`（注意范围/溢出）"],
			["float32", "float64", "快速修复: 使用 `.toFloat64()`"],
			["int64", "float64", "快速修复: 使用 `.toFloat64()`"],
		]
		for (const [a, b, hint] of builtIn) {
			this.conversionEdgeMap.set(`${a}|${b}`, hint)
		}

		for (const sym of this.getAllSymbols()) {
			if (sym.kind !== "func" || !/^to[A-Za-z]\w*$/.test(sym.name)) continue
			const sig = sym.signature.replace(/\s+/g, " ")
			const ret = sig.match(/\)\s*:\s*([\w.]+)\s*$/i)?.[1]
			if (!ret) continue
			const paramPart = sig.match(/\(([^)]*)\)/i)?.[1] ?? ""
			const fromT =
				paramPart.match(/(?:self|_\w*)\s*:\s*([\w.]+)/i)?.[1] ||
				paramPart.match(/:\s*([\w.]+)/i)?.[1]
			if (!fromT) continue
			const fk = CangjieSymbolIndex.normalizeConversionTypeKey(fromT)
			const tk = CangjieSymbolIndex.normalizeConversionTypeKey(ret)
			if (!fk || !tk) continue
			const key = `${fk}|${tk}`
			if (!this.conversionEdgeMap.has(key)) {
				const shortFile = path.basename(sym.filePath)
				this.conversionEdgeMap.set(key, `快速修复: 尝试 \`.${sym.name}()\`（见 ${shortFile}）`)
			}
		}
	}

	private static normalizeConversionTypeKey(raw: string): string {
		const leaf = raw.includes(".") ? raw.replace(/^.*\./, "") : raw
		return leaf.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
	}

	/** Best-effort hint for numeric/type widening from compiler diagnostic text */
	getConversionHintFromDiagnosticMessage(message: string): string | null {
		const m2 = message.match(
			/[`'"]([\w.]+)[`'"]?\s*(?:and|与|but|但|,)\s*[`'"]([\w.]+)[`'"]?/i,
		)
		if (m2?.[1] && m2[2]) {
			const a = CangjieSymbolIndex.normalizeConversionTypeKey(m2[1])
			const b = CangjieSymbolIndex.normalizeConversionTypeKey(m2[2])
			return this.getConversionHintForTypes(a, b) ?? this.getConversionHintForTypes(b, a)
		}
		const types = [...message.matchAll(/\b(Int\d+|UInt\d+|Float\d+)\b/gi)].map((x) => x[1])
		if (types.length >= 2) {
			const a = CangjieSymbolIndex.normalizeConversionTypeKey(types[0]!)
			const b = CangjieSymbolIndex.normalizeConversionTypeKey(types[types.length - 1]!)
			return this.getConversionHintForTypes(a, b) ?? this.getConversionHintForTypes(b, a)
		}
		return null
	}

	getConversionHintForTypes(fromTypeKey: string, toTypeKey: string): string | null {
		if (!fromTypeKey || !toTypeKey) return null
		return this.conversionEdgeMap.get(`${fromTypeKey}|${toTypeKey}`) ?? null
	}

	private rebuildDependencyCaches(): void {
		this.dependencyCache.clear()
		this.reverseDependencyCache.clear()
		for (const filePath of Object.keys(this.data.files)) {
			this.updateDependenciesForFile(filePath)
		}
	}

	private removeDependenciesForFile(filePath: string): void {
		const oldDeps = this.dependencyCache.get(filePath) ?? []
		for (const dep of oldDeps) {
			const arr = this.reverseDependencyCache.get(dep)
			if (!arr) continue
			const next = arr.filter((f) => f !== filePath)
			if (next.length > 0) this.reverseDependencyCache.set(dep, next)
			else this.reverseDependencyCache.delete(dep)
		}
		this.dependencyCache.delete(filePath)
	}

	private updateDependenciesForFile(filePath: string): void {
		this.removeDependenciesForFile(filePath)
		const deps = this.computeFileDependencies(filePath)
		this.dependencyCache.set(filePath, deps)
		for (const dep of deps) {
			const arr = this.reverseDependencyCache.get(dep) ?? []
			arr.push(filePath)
			this.reverseDependencyCache.set(dep, arr)
		}
	}

	private addFileToDirectoryIndex(filePath: string): void {
		const normalized = filePath.replace(/\\/g, "/")
		const segs = normalized.split("/")
		for (let i = 1; i < segs.length; i++) {
			const dir = segs.slice(0, i).join("/")
			let set = this.directoryIndex.get(dir)
			if (!set) {
				set = new Set<string>()
				this.directoryIndex.set(dir, set)
			}
			set.add(filePath)
		}
	}

	private removeFileFromDirectoryIndex(filePath: string): void {
		for (const [dir, set] of this.directoryIndex) {
			if (!set.delete(filePath)) continue
			if (set.size === 0) this.directoryIndex.delete(dir)
		}
	}

	private removeReferencesFromIndex(filePath: string, refs?: Record<string, Array<{ line: number; column: number }>>): void {
		if (!refs) return
		for (const [name, list] of Object.entries(refs)) {
			const existing = this.referenceIndex.get(name)
			if (!existing) continue
			const keep = existing.filter((entry) => {
				if (entry.filePath !== filePath) return true
				return !list.some((r) => r.line === entry.line && r.column === entry.column)
			})
			if (keep.length > 0) this.referenceIndex.set(name, keep)
			else this.referenceIndex.delete(name)
		}
	}

	private addReferencesToIndex(filePath: string, refs?: Record<string, Array<{ line: number; column: number }>>): void {
		if (!refs) return
		for (const [name, list] of Object.entries(refs)) {
			let existing = this.referenceIndex.get(name)
			if (!existing) {
				existing = []
				this.referenceIndex.set(name, existing)
			}
			for (const r of list) {
				existing.push({ filePath, line: r.line, column: r.column })
			}
		}
	}

	private addToNameIndex(symbols: SymbolEntry[]): void {
		for (const sym of symbols) {
			let list = this.nameIndex.get(sym.name)
			if (!list) { list = []; this.nameIndex.set(sym.name, list) }
			list.push(sym)
		}
		this._symbolCount += symbols.length
	}

	private removeFromNameIndex(symbols: SymbolEntry[]): void {
		for (const sym of symbols) {
			const list = this.nameIndex.get(sym.name)
			if (!list) continue
			const idx = list.indexOf(sym)
			if (idx >= 0) list.splice(idx, 1)
			if (list.length === 0) this.nameIndex.delete(sym.name)
		}
		this._symbolCount = Math.max(0, this._symbolCount - symbols.length)
	}

	private scheduleSave(): void {
		this.dirty = true
		if (this.flushTimer) return
		this.flushTimer = setTimeout(() => {
			this.flushTimer = undefined
			this.saveToDisk()
		}, 5_000)
	}

	private saveToDisk(): void {
		if (!this.indexPath || !this.dirty) return
		try {
			const dir = path.dirname(this.indexPath)
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
			fs.writeFileSync(this.indexPath, JSON.stringify(this.data), "utf-8")
			this.dirty = false
		} catch (err) {
			this.outputChannel.appendLine(`[SymbolIndex] Failed to save: ${err}`)
		}
	}

	private async fullIndex(root: string): Promise<void> {
		if (this.indexing) return
		this.indexing = true
		const t0 = Date.now()

		try {
			const files = await vscode.workspace.findFiles("**/*.cj", "**/target/**", 2000)
			const pending: string[] = []

			for (const uri of files) {
				const filePath = uri.fsPath
				const stat = fs.statSync(filePath)
				const mtime = stat.mtimeMs
				const existing = this.data.files[filePath]

				if (existing && existing.mtime >= mtime) continue

				pending.push(filePath)
			}

			const batchSize = this.useCjcAst ? 4 : 12
			for (let i = 0; i < pending.length; i += batchSize) {
				await Promise.all(pending.slice(i, i + batchSize).map((fp) => this.reindexFile(fp)))
			}
			const updated = pending.length
			if (updated > 0) this.rebuildDependencyCaches()

			const staleFiles = Object.keys(this.data.files).filter((f) => !fs.existsSync(f))
			for (const f of staleFiles) {
				this.removeFile(f)
			}

			if (updated > 0 || staleFiles.length > 0) {
				this.scheduleSave()
			}

			this.outputChannel.appendLine(
				`[Perf] Symbol index built in ${Date.now() - t0}ms (${files.length} files, ${updated} updated, ${staleFiles.length} removed)`,
			)
		} finally {
			this.indexing = false
		}
	}

	private get useCjcAst(): boolean {
		return vscode.workspace.getConfiguration(Package.name).get<boolean>("cangjieTools.useCjcAstForIndex", false)
	}

	async reindexFile(filePath: string): Promise<void> {
		if (!filePath.endsWith(".cj")) return

		try {
			const stat = fs.statSync(filePath)
			const content = fs.readFileSync(filePath, "utf-8")
			this.readFileCache.set(filePath, { mtime: stat.mtimeMs, lines: content.split("\n") })
			const defs = this.useCjcAst
				? await parseCangjieWithFallback(filePath, content)
				: parseCangjieDefinitions(content)
			const lines = content.split("\n")
			const refsByName: Record<string, Array<{ line: number; column: number }>> = {}
			for (let i = 0; i < lines.length; i++) {
				let match: RegExpExecArray | null
				REFERENCE_RE.lastIndex = 0
				while ((match = REFERENCE_RE.exec(lines[i])) !== null) {
					if (!isCodeTokenPosition(lines[i], match.index)) continue
					const name = match[1]
					const arr = refsByName[name] ?? []
					arr.push({ line: i, column: match.index })
					refsByName[name] = arr
				}
			}

			const symbols: SymbolEntry[] = defs
				.filter((d) => d.kind !== "import")
				.map((d) => {
					const meta = extractCangjieDeclarationMeta(lines, d.startLine, d.name)
					return {
						name: d.name,
						kind: d.kind,
						filePath,
						startLine: d.startLine,
						endLine: d.endLine,
						signature: computeCangjieSignature(lines, d),
						visibility: meta.visibility,
						modifiers: meta.modifiers.length > 0 ? meta.modifiers : undefined,
						typeParams: meta.typeParams,
					}
				})

			const oldEntry = this.data.files[filePath]
			if (oldEntry) {
				this.removeFromNameIndex(oldEntry.symbols)
				this.removeReferencesFromIndex(filePath, oldEntry.references)
				this.removeDependenciesForFile(filePath)
				this.removeFileFromDirectoryIndex(filePath)
			} else {
				this._fileCount++
			}
			this.data.files[filePath] = { mtime: stat.mtimeMs, symbols, references: refsByName }
			this.addFileToDirectoryIndex(filePath)
			this.addToNameIndex(symbols)
			this.addReferencesToIndex(filePath, refsByName)
			if (!this.indexing) this.updateDependenciesForFile(filePath)
			this.scheduleSave()
		} catch {
			// File may have been deleted or be unreadable
		}
	}

	private removeFile(filePath: string): void {
		this.readFileCache.delete(filePath)
		const entry = this.data.files[filePath]
		if (entry) {
			this.removeFromNameIndex(entry.symbols)
			this.removeReferencesFromIndex(filePath, entry.references)
			this.removeDependenciesForFile(filePath)
			this.removeFileFromDirectoryIndex(filePath)
			delete this.data.files[filePath]
			this._fileCount = Math.max(0, this._fileCount - 1)
			this.scheduleSave()
		}
	}

	private getFileLinesCached(filePath: string): string | null {
		try {
			const st = fs.statSync(filePath)
			const hit = this.readFileCache.get(filePath)
			if (hit && hit.mtime === st.mtimeMs) {
				return hit.lines.join("\n")
			}
			const content = fs.readFileSync(filePath, "utf-8")
			const lines = content.split("\n")
			this.readFileCache.set(filePath, { mtime: st.mtimeMs, lines })
			return content
		} catch {
			return null
		}
	}

	// ── Query APIs ──

	findDefinitions(name: string): SymbolEntry[] {
		return this.nameIndex.get(name) ?? []
	}

	findDefinitionsByKind(name: string, kind: CangjieDefKind): SymbolEntry[] {
		return this.findDefinitions(name).filter((s) => s.kind === kind)
	}

	findReferences(name: string): ReferenceEntry[] {
		return this.referenceIndex.get(name) ?? []
	}

	findSymbolsByPrefix(prefix: string, limit = 50): SymbolEntry[] {
		const results: SymbolEntry[] = []
		const lowerPrefix = prefix.toLowerCase()
		for (const file of Object.values(this.data.files)) {
			for (const sym of file.symbols) {
				if (sym.name.toLowerCase().startsWith(lowerPrefix)) {
					results.push(sym)
					if (results.length >= limit) return results
				}
			}
		}
		return results
	}

	getAllSymbols(): SymbolEntry[] {
		const all: SymbolEntry[] = []
		for (const file of Object.values(this.data.files)) {
			all.push(...file.symbols)
		}
		return all
	}

	/**
	 * Smallest enclosing symbol for a 0-based line in filePath (innermost by line span).
	 */
	findEnclosingSymbol(filePath: string, line: number): SymbolEntry | null {
		const fileEntry = this.data.files[filePath]
		if (!fileEntry) return null

		const candidates = fileEntry.symbols.filter(
			(s) => line >= s.startLine && line <= s.endLine && s.kind !== "import" && s.kind !== "package",
		)
		if (candidates.length === 0) return null

		candidates.sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))
		return candidates[0] ?? null
	}

	getSymbolsByDirectory(dirPath: string): SymbolEntry[] {
		const normalized = dirPath.replace(/\\/g, "/")
		const files = this.directoryIndex.get(normalized)
		if (!files || files.size === 0) return []
		const results: SymbolEntry[] = []
		for (const filePath of files) {
			const fileEntry = this.data.files[filePath]
			if (fileEntry) results.push(...fileEntry.symbols)
		}
		return results
	}

	getSymbolsByFile(filePath: string): SymbolEntry[] {
		return this.data.files[filePath]?.symbols ?? []
	}

	getIndexedFiles(): string[] {
		return Object.keys(this.data.files)
	}

	get fileCount(): number {
		return this._fileCount
	}

	get symbolCount(): number {
		return this._symbolCount
	}

	// ── Cross-file dependency graph queries ──

	private computeFileDependencies(filePath: string): string[] {
		try {
			const raw = this.getFileLinesCached(filePath)
			if (raw === null) return []
			const content = raw
			const importedPackages = new Set(extractCangjieImportPackagePrefixes(content))
			if (importedPackages.size === 0) return []

			const depFiles = new Set<string>()
			for (const [fp, entry] of Object.entries(this.data.files)) {
				if (fp === filePath) continue
				for (const sym of entry.symbols) {
					if (sym.kind === "package") continue
					const relPath = fp.replace(/\\/g, "/")
					for (const pkg of importedPackages) {
						if (posixPathMatchesImportPackage(relPath, pkg)) {
							depFiles.add(fp)
							break
						}
					}
				}
			}
			return [...depFiles]
		} catch {
			return []
		}
	}

	/**
	 * Extract import paths from a file and map them to indexed files.
	 * Returns files that the given file depends on (imports from).
	 */
	getFileDependencies(filePath: string): string[] {
		return this.dependencyCache.get(filePath) ?? []
	}

	/**
	 * Find all files that import/reference symbols defined in the given file.
	 * These are the "reverse dependencies" — files that would break if the
	 * given file's API changes.
	 */
	getReverseDependencies(filePath: string): string[] {
		return this.reverseDependencyCache.get(filePath) ?? []
	}

	/**
	 * Symbols declared with `public` in signature (API surface; default visibility is package-internal).
	 */
	getPublicSymbolsForFile(filePath: string): SymbolEntry[] {
		const fileEntry = this.data.files[filePath]
		if (!fileEntry) return []

		const publicWord = /\bpublic\b/
		return fileEntry.symbols.filter((s) => {
			if (s.kind === "import" || s.kind === "package") return false
			if (s.visibility !== undefined) {
				return s.visibility === "public"
			}
			return publicWord.test(s.signature)
		})
	}

	dispose(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer)
		}
		this.saveToDisk()
		this.disposables.forEach((d) => d.dispose())
		if (CangjieSymbolIndex.instance === this) {
			CangjieSymbolIndex.instance = undefined
		}
	}
}
