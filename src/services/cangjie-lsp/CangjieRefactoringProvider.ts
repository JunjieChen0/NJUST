import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import type { CangjieSymbolIndex } from "./CangjieSymbolIndex"
import { parseCangjieDefinitions, type CangjieDef } from "../tree-sitter/cangjieParser"
import { t } from "../../i18n"

/**
 * Resolve the real path of a file or directory, handling non-existent paths
 * by walking up to the nearest existing parent and resolving its real path.
 * This prevents symlink-based path traversal attacks where a symlink inside
 * the workspace points to a location outside the workspace.
 */
function resolveRealPath(filePath: string): string {
	try {
		return fs.realpathSync(filePath)
	} catch {
		// Path doesn't exist — walk up to nearest existing parent.
		let current = filePath
		const missingParts: string[] = []

		while (true) {
			const parent = path.dirname(current)
			if (parent === current) {
				// Reached root without finding an existing parent.
				return filePath
			}

			try {
				const realParent = fs.realpathSync(parent)
				// Reconstruct with real parent + the first missing segment + remaining parts.
				return path.join(realParent, path.basename(current), ...missingParts)
			} catch {
				missingParts.unshift(path.basename(current))
				current = parent
			}
		}
	}
}

/**
 * Verify that a resolved absolute path is within the real workspace root.
 */
function isPathWithinWorkspace(realWorkspaceRoot: string, absolutePath: string): boolean {
	try {
		const realPath = fs.realpathSync(absolutePath)
		const rel = path.relative(realWorkspaceRoot, realPath)
		return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
	} catch {
		// If the path doesn't exist, check its nearest existing parent.
		const realParent = resolveRealPath(path.dirname(absolutePath))
		const rel = path.relative(realWorkspaceRoot, realParent)
		return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
	}
}

/**
 * Provides refactoring code actions for Cangjie files:
 *  - Extract Function: extract selected code into a new function
 *  - Move File: move a .cj file and update package declarations + imports
 */
export class CangjieRefactoringProvider implements vscode.CodeActionProvider {
	static readonly providedCodeActionKinds = [vscode.CodeActionKind.RefactorExtract, vscode.CodeActionKind.Refactor]

	constructor(private readonly index: CangjieSymbolIndex) {}

	provideCodeActions(
		document: vscode.TextDocument,
		range: vscode.Range | vscode.Selection,
		_context: vscode.CodeActionContext,
		_token: vscode.CancellationToken,
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = []

		if (!range.isEmpty) {
			const extractAction = new vscode.CodeAction(
				"Extract Function (Cangjie)",
				vscode.CodeActionKind.RefactorExtract,
			)
			extractAction.command = {
				command: "njust-ai.cangjieExtractFunction",
				title: "Extract Function",
				arguments: [document, range],
			}
			actions.push(extractAction)
		}

		return actions
	}

	/**
	 * Extract the selected code into a new function.
	 * Performs basic analysis of free variables in the selection to build the parameter list.
	 */
	async extractFunction(document: vscode.TextDocument, range: vscode.Range): Promise<void> {
		const selectedText = document.getText(range)
		if (!selectedText.trim()) return

		const funcName = await vscode.window.showInputBox({
			prompt: t("info.cangjie_lsp.new_function_name_prompt"),
			value: "extractedFunction",
			validateInput: (v) => (/^[a-z_]\w*$/i.test(v) ? null : t("errors.cangjie_lsp.invalid_identifier")),
		})
		if (!funcName) return

		const freeVars = this.detectFreeVariables(document, range, selectedText)
		const paramList = freeVars.length > 0 ? freeVars.map((v) => `${v.name}: ${v.inferredType}`).join(", ") : ""
		const argList = freeVars.map((v) => v.name).join(", ")

		const indent = document.lineAt(range.start.line).text.match(/^(\s*)/)?.[1] ?? ""
		const bodyIndent = indent + "\t"
		const indentedBody = selectedText
			.split("\n")
			.map((line) => bodyIndent + line.trimStart())
			.join("\n")

		const funcDef = `\n${indent}func ${funcName}(${paramList}): Unit {\n${indentedBody}\n${indent}}\n`
		const callSite = `${indent}${funcName}(${argList})`

		const content = document.getText()
		const defs = parseCangjieDefinitions(content)
		const enclosing = defs
			.filter(
				(d: CangjieDef) =>
					d.startLine <= range.start.line &&
					d.endLine >= range.end.line &&
					["class", "struct", "interface", "extend"].includes(d.kind),
			)
			.sort((a: CangjieDef, b: CangjieDef) => b.startLine - a.startLine)

		const edit = new vscode.WorkspaceEdit()
		edit.replace(document.uri, range, callSite)

		const insertionLine = enclosing.length > 0 ? enclosing[0]!.endLine : range.end.line + 2
		const insertPos = new vscode.Position(Math.min(insertionLine, document.lineCount), 0)
		edit.insert(document.uri, insertPos, funcDef)

		await vscode.workspace.applyEdit(edit)
	}

	/**
	 * Move a .cj file to a new directory and update package declarations
	 * and import references across the workspace.
	 */
	async moveFile(sourceUri: vscode.Uri): Promise<void> {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(sourceUri)
		if (!workspaceFolder) return

		const relSource = path.relative(workspaceFolder.uri.fsPath, sourceUri.fsPath).replace(/\\/g, "/")

		const targetPath = await vscode.window.showInputBox({
			prompt: t("info.cangjie_lsp.target_path_prompt"),
			value: relSource,
		})
		if (!targetPath || targetPath === relSource) return

		// Security: prevent symlink-based path traversal.
		// Resolve the REAL path of the workspace root and the nearest existing
		// parent of the target to detect symlinks that point outside the workspace.
		const workspaceRoot = path.resolve(workspaceFolder.uri.fsPath)
		const realWorkspaceRoot = resolveRealPath(workspaceRoot)

		const absTarget = path.resolve(workspaceFolder.uri.fsPath, targetPath)
		const targetDir = path.dirname(absTarget)
		const realTargetParent = resolveRealPath(targetDir)

		// Use path.relative to detect escapes: if the relative path starts with
		// ".." then the real target parent is outside the real workspace root.
		const relFromRoot = path.relative(realWorkspaceRoot, realTargetParent)
		if (relFromRoot.startsWith("..") && relFromRoot !== "") {
			void vscode.window.showErrorMessage(t("errors.cangjie_lsp.invalid_target_path", { path: targetPath }))
			return
		}

		if (!fs.existsSync(targetDir)) {
			fs.mkdirSync(targetDir, { recursive: true })
		}

		const content = fs.readFileSync(sourceUri.fsPath, "utf-8")

		const oldPackage = this.inferPackageName(sourceUri.fsPath, workspaceFolder.uri.fsPath)
		const newPackage = this.inferPackageName(absTarget, workspaceFolder.uri.fsPath)

		let updatedContent = content
		if (oldPackage && newPackage && oldPackage !== newPackage) {
			updatedContent = content.replace(
				new RegExp(`^(\\s*package\\s+)${oldPackage.replace(/\./g, "\\.")}`, "m"),
				`$1${newPackage}`,
			)
		}

		// Write using O_EXCL to avoid following symlinks on the final path
		// component. O_EXCL fails if the file already exists (including symlinks).
		try {
			const fd = fs.openSync(absTarget, "wx")
			try {
				fs.writeSync(fd, updatedContent, 0, "utf-8")
			} finally {
				fs.closeSync(fd)
			}
		} catch (writeErr: unknown) {
			const code = (writeErr as NodeJS.ErrnoException).code
			if (code === "EEXIST") {
				void vscode.window.showErrorMessage(t("errors.cangjie_lsp.target_file_exists", { path: targetPath }))
			} else {
				void vscode.window.showErrorMessage(
					t("errors.cangjie_lsp.write_failed", { path: targetPath, error: String(writeErr) }),
				)
			}
			return
		}

		// Re-verify the written target is still within workspace before deleting source.
		if (!isPathWithinWorkspace(realWorkspaceRoot, absTarget)) {
			// Target escaped the workspace after write — clean up and abort.
			try {
				fs.unlinkSync(absTarget)
			} catch {
				// Best-effort cleanup.
			}
			void vscode.window.showErrorMessage(t("errors.cangjie_lsp.invalid_target_path", { path: targetPath }))
			return
		}

		fs.unlinkSync(sourceUri.fsPath)

		if (oldPackage && newPackage && oldPackage !== newPackage) {
			await this.updateImportReferences(workspaceFolder.uri.fsPath, oldPackage, newPackage)
		}

		const doc = await vscode.workspace.openTextDocument(absTarget)
		await vscode.window.showTextDocument(doc)
	}

	private inferPackageName(filePath: string, workspaceRoot: string): string | undefined {
		const rel = path.relative(workspaceRoot, filePath).replace(/\\/g, "/")
		const srcIdx = rel.indexOf("src/")
		if (srcIdx < 0) return undefined
		const afterSrc = rel.slice(srcIdx + 4)
		const dir = path.dirname(afterSrc)
		if (dir === ".") return undefined
		return dir.replace(/\//g, ".")
	}

	private async updateImportReferences(workspaceRoot: string, oldPackage: string, newPackage: string): Promise<void> {
		const files = await vscode.workspace.findFiles("**/*.cj", "**/target/**", 500)
		const edit = new vscode.WorkspaceEdit()

		const oldImportPattern = new RegExp(`(import\\s+)${oldPackage.replace(/\./g, "\\.")}(\\.\\*?)`, "g")

		for (const uri of files) {
			try {
				const doc = await vscode.workspace.openTextDocument(uri)
				const text = doc.getText()
				if (!text.includes(oldPackage)) continue

				const lines = text.split("\n")
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i]
					oldImportPattern.lastIndex = 0
					if (line! && oldImportPattern.test(line)) {
						const newLine = line!.replace(oldImportPattern, `$1${newPackage}$2`)
						const lineRange = new vscode.Range(i, 0, i, line!.length)
						edit.replace(uri, lineRange, newLine)
					}
				}
			} catch {
				// intentionally ignored: skip unreadable files
			}
		}

		if (edit.size > 0) {
			await vscode.workspace.applyEdit(edit)
		}
	}

	/**
	 * Simple free-variable detection: find identifiers in the selection
	 * that are defined outside it (variable declarations above).
	 */
	private detectFreeVariables(
		document: vscode.TextDocument,
		range: vscode.Range,
		selectedText: string,
	): Array<{ name: string; inferredType: string }> {
		const identRe = /\b([A-Za-z_]\w*)\b/g
		const usedInSelection = new Set<string>()
		let m: RegExpExecArray | null
		while ((m = identRe.exec(selectedText)) !== null) {
			usedInSelection.add(m[1]!)
		}

		const keywords = new Set([
			"let",
			"var",
			"if",
			"else",
			"for",
			"while",
			"match",
			"case",
			"return",
			"import",
			"package",
			"func",
			"class",
			"struct",
			"interface",
			"enum",
			"in",
			"true",
			"false",
			"this",
			"super",
			"public",
			"private",
			"protected",
			"static",
			"open",
			"override",
			"abstract",
			"sealed",
			"spawn",
			"try",
			"catch",
			"finally",
			"throw",
			"break",
			"continue",
			"mut",
			"init",
			"extend",
		])

		const declRe = /(?:let|var)\s+([a-z_]\w*)\s*(?::\s*(\w[\w<>?,\s]*))?/g
		const contextStart = Math.max(0, range.start.line - 30)
		const contextText = document.getText(new vscode.Range(contextStart, 0, range.start.line, 0))

		const declared = new Map<string, string>()
		while ((m = declRe.exec(contextText)) !== null) {
			declared.set(m[1]!, m[2] ?? "/* infer */")
		}

		const result: Array<{ name: string; inferredType: string }> = []
		for (const name of usedInSelection) {
			if (keywords.has(name)) continue
			if (declared.has(name)) {
				result.push({ name, inferredType: declared.get(name)! })
			}
		}
		return result
	}

	dispose(): void {
		// No resources to dispose
	}
}
