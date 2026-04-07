import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { execFile } from "child_process"
import { promisify } from "util"
import { resolveCangjieToolPath, buildCangjieToolEnv } from "./cangjieToolUtils"
import { recordLearnedFix } from "../../core/prompts/sections/cangjie-context"

const execFileAsync = promisify(execFile)

const COMPILE_TIMEOUT_MS = 60_000
const FORMAT_TIMEOUT_MS = 15_000

// re-export CjcErrorPattern regex used by enhanceCjcErrorOutput
const CJC_ERROR_LOCATION_RE = /==>\s+(.+?):(\d+):(\d+):/g

export interface CompileResult {
	success: boolean
	output: string
	errorCount: number
	errorLocations: Array<{ file: string; line: number; col: number }>
}

export interface FormatResult {
	formatted: boolean
	output: string
}

/**
 * Compile guard – provides post-write hooks for .cj files:
 *  1. Auto-compile via `cjpm build` after file save
 *  2. Auto-format via `cjfmt -f` before/after save
 *  3. Record resolved errors to learned-fixes
 */
export class CangjieCompileGuard implements vscode.Disposable {
	private disposables: vscode.Disposable[] = []
	private lastErrors = new Map<string, string>()

	constructor(private readonly outputChannel: vscode.OutputChannel) {}

	/**
	 * Register a post-save pipeline for .cj files (Phases 3.1, 3.2, 3.3):
	 *   1. Auto-format with cjfmt (Phase 3.2)
	 *   2. Auto-compile with cjpm build (Phase 3.1)
	 *   3. Report cjlint diagnostic count (Phase 3.3)
	 *   4. Record resolved error→fix patterns (Phase 1.3)
	 */
	registerSaveHook(): void {
		const watcher = vscode.workspace.onDidSaveTextDocument(async (doc) => {
			if (doc.languageId !== "cangjie" && !doc.fileName.endsWith(".cj")) return

			const cwd = this.findCjpmRoot(doc.uri)
			if (!cwd) return

			// Step 1: Auto-format with cjfmt (Phase 3.2)
			const formatResult = await this.formatFile(doc.fileName)
			if (formatResult.formatted) {
				this.outputChannel.appendLine(
					`[CompileGuard] 🎨 cjfmt formatted ${path.basename(doc.fileName)}`,
				)
			}

			// Step 2: Auto-compile (Phase 3.1) — track errors before and after
			const beforeErrors = new Map(this.lastErrors)
			const result = await this.compile(cwd)

			if (result.success) {
				// Step 4: Record resolved error patterns to learned-fixes (Phase 1.3)
				for (const [errorKey, errorMsg] of beforeErrors) {
					if (!this.lastErrors.has(errorKey)) {
						const suggestion = this.getSuggestionForError(errorMsg)
						if (suggestion) {
							recordLearnedFix(cwd, errorMsg, suggestion)
							this.outputChannel.appendLine(
								`[CompileGuard] 📚 Learned fix recorded for: ${errorMsg.slice(0, 60)}…`,
							)
						}
					}
				}
				this.outputChannel.appendLine(
					`[CompileGuard] ✅ Build passed after saving ${path.basename(doc.fileName)}`,
				)
			} else {
				this.outputChannel.appendLine(
					`[CompileGuard] ❌ Build failed (${result.errorCount} error(s)) after saving ${path.basename(doc.fileName)}`,
				)
			}

			// Step 3: Report cjlint diagnostic count (Phase 3.3, non-blocking)
			const lintDiagCount = this.countCjlintDiagnostics(doc.uri)
			if (lintDiagCount > 0) {
				this.outputChannel.appendLine(
					`[CompileGuard] ⚠️  ${lintDiagCount} cjlint diagnostic(s) on ${path.basename(doc.fileName)} — run cjpm build -l to review`,
				)
			}
		})
		this.disposables.push(watcher)
	}

	/**
	 * Count active cjlint diagnostics for a file (Phase 3.3).
	 * Used to surface linting issues in the output channel after save.
	 */
	private countCjlintDiagnostics(uri: vscode.Uri): number {
		const diags = vscode.languages.getDiagnostics(uri)
		return diags.filter((d) => d.source === "cjlint").length
	}

	/**
	 * Run `cjpm build` in the given project root.
	 */
	async compile(cwd: string): Promise<CompileResult> {
		const cjpmPath = resolveCangjieToolPath("cjpm", "cangjieTools.cjpmPath")
		if (!cjpmPath) {
			return { success: false, output: "cjpm not found", errorCount: 0, errorLocations: [] }
		}

		try {
			const { stdout, stderr } = await execFileAsync(
				cjpmPath,
				["build"],
				{
					timeout: COMPILE_TIMEOUT_MS,
					cwd,
					env: buildCangjieToolEnv() as NodeJS.ProcessEnv,
				},
			)
			const output = stdout + stderr
			this.lastErrors.clear()
			return { success: true, output, errorCount: 0, errorLocations: [] }
		} catch (error: unknown) {
			const err = error as { stdout?: string; stderr?: string; message?: string }
			const output = (err.stdout || "") + (err.stderr || "") + (err.message || "")

			const errorLocations: CompileResult["errorLocations"] = []
			this.lastErrors.clear()

			let match: RegExpExecArray | null
			CJC_ERROR_LOCATION_RE.lastIndex = 0
			while ((match = CJC_ERROR_LOCATION_RE.exec(output)) !== null) {
				const file = match[1]
				const line = parseInt(match[2], 10)
				const col = parseInt(match[3], 10)
				errorLocations.push({ file, line, col })
				this.lastErrors.set(`${file}:${line}`, output.slice(match.index, match.index + 200))
			}

			return {
				success: false,
				output,
				errorCount: errorLocations.length || 1,
				errorLocations,
			}
		}
	}

	/**
	 * Format a single .cj file using cjfmt.
	 */
	async formatFile(filePath: string): Promise<FormatResult> {
		const cjfmtPath = resolveCangjieToolPath("cjfmt", "cangjieTools.cjfmtPath")
		if (!cjfmtPath) {
			return { formatted: false, output: "cjfmt not found" }
		}

		const tmpOutput = path.join(os.tmpdir(), `cjfmt_guard_${Date.now()}.cj`)
		try {
			await execFileAsync(
				cjfmtPath,
				["-f", filePath, "-o", tmpOutput],
				{
					timeout: FORMAT_TIMEOUT_MS,
					env: buildCangjieToolEnv() as NodeJS.ProcessEnv,
				},
			)

			if (!fs.existsSync(tmpOutput)) {
				return { formatted: false, output: "No output produced" }
			}

			const original = fs.readFileSync(filePath, "utf-8")
			const formatted = fs.readFileSync(tmpOutput, "utf-8")

			if (original !== formatted) {
				fs.writeFileSync(filePath, formatted, "utf-8")
				return { formatted: true, output: "File formatted" }
			}

			return { formatted: false, output: "Already formatted" }
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error)
			return { formatted: false, output: msg }
		} finally {
			try { fs.unlinkSync(tmpOutput) } catch {}
		}
	}

	/**
	 * Format all .cj files that have been modified (from visible editors).
	 */
	async formatDirtyCangjieFiles(): Promise<number> {
		let count = 0
		for (const editor of vscode.window.visibleTextEditors) {
			const doc = editor.document
			if ((doc.languageId === "cangjie" || doc.fileName.endsWith(".cj")) && doc.isDirty) {
				const result = await this.formatFile(doc.fileName)
				if (result.formatted) count++
			}
		}
		return count
	}

	private findCjpmRoot(uri: vscode.Uri): string | undefined {
		const folder = vscode.workspace.getWorkspaceFolder(uri)
		if (!folder) return undefined
		const tomlPath = path.join(folder.uri.fsPath, "cjpm.toml")
		return fs.existsSync(tomlPath) ? folder.uri.fsPath : undefined
	}

	private getSuggestionForError(errorMsg: string): string | null {
		// Map common error patterns to fix suggestions
		const patterns: Array<[RegExp, string]> = [
			[/undeclared|cannot find|not found|未找到符号/, "添加缺失的 import 语句或检查拼写"],
			[/type mismatch|incompatible types|类型不匹配/, "修正类型声明或添加类型转换"],
			[/immutable|cannot assign|不可变/, "将 let 改为 var"],
			[/non-exhaustive|incomplete match/, "补全 match 分支或添加 case _ =>"],
			[/mut function|mut.*let/, "将 let 改为 var 以允许调用 mut 方法"],
			[/missing return|no return/, "确保所有分支都有返回值"],
			[/recursive struct/, "struct 不能自引用，改用 class"],
			[/main.*Int64|main.*signature/, "main 函数签名必须为 main(): Int64"],
		]

		for (const [pattern, suggestion] of patterns) {
			if (pattern.test(errorMsg)) return suggestion
		}
		return null
	}

	dispose(): void {
		this.disposables.forEach((d) => d.dispose())
	}

	// ── Phase 2.3: cjpm tree integration ──

	/**
	 * Run `cjpm tree` to get the exact dependency tree.
	 * Returns the tree output as text, or null if unavailable.
	 * This is more accurate than regex-parsing cjpm.toml.
	 */
	async runCjpmTree(cwd: string, depthLimit = 3): Promise<string | null> {
		const cjpmPath = resolveCangjieToolPath("cjpm", "cangjieTools.cjpmPath")
		if (!cjpmPath) return null

		try {
			const { stdout, stderr } = await execFileAsync(
				cjpmPath,
				["tree", "-V", "--depth", String(depthLimit)],
				{
					timeout: 15_000,
					cwd,
					env: buildCangjieToolEnv() as NodeJS.ProcessEnv,
				},
			)
			const output = (stdout + stderr).trim()
			return output.length > 0 ? output : null
		} catch {
			// cjpm tree may not be available in all SDK versions
			return null
		}
	}

	/**
	 * Get a concise package dependency summary for the AI context.
	 * Tries cjpm tree first; falls back to empty string.
	 * Result is cached per-second to avoid re-running on every prompt.
	 */
	private treeCache: { cwd: string; result: string; ts: number } | undefined

	async getCjpmTreeSummary(cwd: string): Promise<string> {
		const now = Date.now()
		if (this.treeCache && this.treeCache.cwd === cwd && now - this.treeCache.ts < 30_000) {
			return this.treeCache.result
		}

		const tree = await this.runCjpmTree(cwd)
		if (!tree) return ""

		// Truncate to avoid inflating the prompt
		const truncated = tree.length > 2000 ? tree.slice(0, 2000) + "\n…（已截断）" : tree
		const result = `## 仓颉依赖树 (cjpm tree)\n\n\`\`\`\n${truncated}\n\`\`\``

		this.treeCache = { cwd, result, ts: now }
		return result
	}
}
