import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import { NJUST_AI_CONFIG_DIR } from "@njust-ai/types"
import {
	buildCompactProjectOverviewSection,
	buildProjectPackageValidationSection,
	invalidateCangjieContextSectionCache,
	parseCjpmToml,
} from "../../core/prompts/sections/cangjie-context"
import {
	LEARNED_FIXES_FILE,
	ensureLearnedFixesFile,
	getLearnedFixesJsonPath,
	loadLearnedFixes,
	saveLearnedFixes,
} from "../../core/prompts/sections/learnedFixesStorage"
import { inferCangjiePackageFromSrcLayout } from "./cangjieSourceLayout"
import {
	registerGeneratedCangjieTestFile,
	scanGeneratedFilesForCleanup,
	deleteConfirmedCangjieTestFiles,
	reassociateLegacyFiles,
	type CleanupResult,
} from "./cangjieGeneratedTestCleanup"
import {
	resolveCangjieToolPath,
	buildCangjieToolEnv,
	formatCangjieToolchainReport,
	probeCangjieToolchain,
} from "./cangjieToolUtils"
import { Package } from "../../shared/package"
import { t } from "../../i18n"
import { wrapAsError } from "../../shared/error-utils"
import { logger } from "../../shared/logger"
import type { CangjieLspClient } from "./CangjieLspClient"
import { CangjieTemplateLibrary } from "./CangjieTemplateLibrary"
import { SandboxExecutionService } from "../sandbox"
import { CangjieProfiler } from "./CangjieProfiler"
import { CangjieRefactoringProvider } from "./CangjieRefactoringProvider"
import type { CangjieSymbolIndex } from "./CangjieSymbolIndex"
import {
	formatCangjieEvalTraceSummaryMarkdown,
	getCangjieGlobalEvalTracePath,
	getCangjieWorkspaceEvalTracePath,
	readCangjieEvalTraceSummary,
} from "../CangjieEvalTraceLogger"

let cangjieSandboxChannel: vscode.OutputChannel | undefined

/** Lazy singleton OutputChannel for Cangjie sandbox execution output. */
function getCangjieSandboxChannel(): vscode.OutputChannel {
	if (!cangjieSandboxChannel) {
		cangjieSandboxChannel = vscode.window.createOutputChannel("Cangjie Sandbox", { log: true })
	}
	cangjieSandboxChannel.clear()
	return cangjieSandboxChannel
}

interface CjpmCommandDef {
	id: string
	label: string
	cjpmArg: string
}

const CJPM_COMMANDS: CjpmCommandDef[] = [
	{ id: "njust-ai.cangjieBuild", label: "Cangjie: Build (cjpm build)", cjpmArg: "build" },
	{ id: "njust-ai.cangjieRun", label: "Cangjie: Run (cjpm run)", cjpmArg: "run" },
	{ id: "njust-ai.cangjieTest", label: "Cangjie: Test (cjpm test)", cjpmArg: "test" },
	{ id: "njust-ai.cangjieCheck", label: "Cangjie: Check (cjpm check)", cjpmArg: "check" },
	{ id: "njust-ai.cangjieClean", label: "Cangjie: Clean (cjpm clean)", cjpmArg: "clean" },
]

const CANGJIE_PROJECT_TYPES = ["executable", "static", "dynamic"] as const

type CangjieExecutionTarget = "host-windows" | "host-posix" | "docker-linux"

function findWorkspaceRoot(preferredUri?: vscode.Uri): string | undefined {
	const folders = vscode.workspace.workspaceFolders
	if (!folders) return undefined

	const activeUri = preferredUri ?? vscode.window.activeTextEditor?.document.uri
	const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined
	return activeFolder?.uri.fsPath ?? folders[0]?.uri.fsPath
}

function findCjpmRoot(preferredUri?: vscode.Uri): string | undefined {
	const folders = vscode.workspace.workspaceFolders
	if (!folders) return undefined

	const activeUri = preferredUri ?? vscode.window.activeTextEditor?.document.uri
	const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined
	if (activeFolder && fs.existsSync(path.join(activeFolder.uri.fsPath, "cjpm.toml"))) {
		return activeFolder.uri.fsPath
	}

	for (const folder of folders) {
		const tomlPath = path.join(folder.uri.fsPath, "cjpm.toml")
		if (fs.existsSync(tomlPath)) {
			return folder.uri.fsPath
		}
	}

	return undefined
}

async function reportCleanupResult(result: CleanupResult): Promise<void> {
	const parts: string[] = []
	if (result.deleted.length > 0) {
		parts.push(t("info.cangjie_lsp.cleanup_deleted", { count: result.deleted.length }))
	}
	if (result.skippedModified.length > 0) {
		parts.push(t("info.cangjie_lsp.cleanup_skipped_modified", { count: result.skippedModified.length }))
	}
	if (result.skippedOutsideWorkspace.length > 0) {
		parts.push(t("info.cangjie_lsp.cleanup_skipped_outside", { count: result.skippedOutsideWorkspace.length }))
	}
	if (result.skippedLegacyNotConfirmed.length > 0) {
		parts.push(t("info.cangjie_lsp.cleanup_skipped_legacy", { count: result.skippedLegacyNotConfirmed.length }))
	}
	if (result.failed.length > 0) {
		parts.push(t("info.cangjie_lsp.cleanup_failed", { count: result.failed.length }))
	}
	if (parts.length > 0) {
		void vscode.window.showInformationMessage(parts.join("  |  "))
	}
}

function sanitizeCangjieTestSymbolBase(base: string): string {
	const s = base.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^_+|_+$/g, "")
	return s.length > 0 ? s : "module"
}

function resolveTestFilePath(sourceUri: vscode.Uri, base: string, folder: vscode.WorkspaceFolder | undefined): string {
	const sourceDir = path.dirname(sourceUri.fsPath)
	if (!folder) return path.join(sourceDir, `${base}_test.cj`)

	const testRoot = path.join(folder.uri.fsPath, "test")
	const srcDir = path.join(folder.uri.fsPath, "src")
	if (fs.existsSync(testRoot) && fs.statSync(testRoot).isDirectory()) {
		const normSrc = srcDir.replace(/\\/g, "/").toLowerCase()
		const normSourceDir = sourceDir.replace(/\\/g, "/").toLowerCase()
		if (normSourceDir.startsWith(normSrc + "/") || normSourceDir === normSrc) {
			const rel = path.relative(srcDir, sourceDir)
			if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
				const testSubDir = rel && rel !== "." ? path.join(testRoot, rel) : testRoot
				if (!fs.existsSync(testSubDir)) {
					fs.mkdirSync(testSubDir, { recursive: true })
				}
				return path.join(testSubDir, `${base}_test.cj`)
			}
		}
	}
	return path.join(sourceDir, `${base}_test.cj`)
}

/** If primary path is co-located, return mirror path under test/ when it differs; else undefined. */
function mirroredTestPathUnderTestDir(
	sourceUri: vscode.Uri,
	base: string,
	folder: vscode.WorkspaceFolder,
	primaryResolved: string,
): string | undefined {
	const testRoot = path.join(folder.uri.fsPath, "test")
	const srcDir = path.join(folder.uri.fsPath, "src")
	const sourceDir = path.dirname(sourceUri.fsPath)
	if (!fs.existsSync(testRoot) || !fs.statSync(testRoot).isDirectory()) return undefined

	const normSrc = srcDir.replace(/\\/g, "/").toLowerCase()
	const normSourceDir = sourceDir.replace(/\\/g, "/").toLowerCase()
	if (!normSourceDir.startsWith(normSrc + "/") && normSourceDir !== normSrc) return undefined

	const rel = path.relative(srcDir, sourceDir)
	if (rel.startsWith("..") || path.isAbsolute(rel)) return undefined

	const testSub = rel && rel !== "." ? path.join(testRoot, rel) : testRoot
	const mirrored = path.join(testSub, `${base}_test.cj`)
	if (path.normalize(mirrored) === path.normalize(primaryResolved)) return undefined
	return mirrored
}

function parseCangjiePackageDecl(content: string): string | undefined {
	const m = content.match(/^\s*package\s+([\w.]+)\s*$/m)
	return m?.[1]
}

const MAX_EXTRACT_SYMBOLS = 5

function extractPublicSymbols(source: string): string[] {
	const names: string[] = []
	const seen = new Set<string>()
	const add = (n: string) => {
		if (!n || n === "main" || n.startsWith("test_") || seen.has(n)) return
		seen.add(n)
		names.push(n)
	}

	let match: RegExpExecArray | null
	const funcDecl = /(?:^|\n)\s*(?:public|open|protected|internal)\s+func\s+(\w+)\s*\(/g
	while ((match = funcDecl.exec(source)) !== null) add(match[1]!)

	const classDecl = /(?:^|\n)\s*(?:public|open)\s+class\s+(\w+)/g
	while ((match = classDecl.exec(source)) !== null) add(match[1]!)

	const structDecl = /(?:^|\n)\s*(?:public|open)\s+struct\s+(\w+)/g
	while ((match = structDecl.exec(source)) !== null) add(match[1]!)

	const ifaceDecl = /(?:^|\n)\s*(?:public|open)\s+interface\s+(\w+)/g
	while ((match = ifaceDecl.exec(source)) !== null) add(match[1]!)

	const topFunc = /(?:^|\n)func\s+(\w+)\s*\(/g
	while ((match = topFunc.exec(source)) !== null) add(match[1]!)

	return names.slice(0, MAX_EXTRACT_SYMBOLS)
}

function hasTestableCangjieExports(source: string): boolean {
	if (/\b(public|open)\s+(func|class|struct|interface)\b/.test(source)) return true
	if (/^func\s+\w+/m.test(source)) return true
	const substantive = source.split(/\r?\n/).filter((l) => {
		const t = l.trim()
		return t.length > 0 && !t.startsWith("//") && !t.startsWith("package ") && !t.startsWith("import ")
	})
	return substantive.length >= 2
}

function testClassNameFromBase(safe: string): string {
	if (!safe) return "GeneratedTest"
	return safe.charAt(0).toUpperCase() + safe.slice(1) + "Test"
}

function buildCangjieTestFileBody(safe: string, symbols: string[]): string {
	if (symbols.length === 0) {
		return `\t@TestCase\n` + `\tfunc test_${safe}_smoke() {\n` + `\t\t@Assert(1 + 1 == 2)\n` + `\t}\n`
	}
	return symbols
		.map(
			(sym) =>
				`\t@TestCase\n` +
				`\tfunc test_${sym}() {\n` +
				`\t\t// TODO: exercise ${sym}\n` +
				`\t\t@Assert(1 + 1 == 2)\n` +
				`\t}\n`,
		)
		.join("\n")
}

async function runCangjieGenerateTestFile(
	getCurrentTaskId: (() => string | undefined) | undefined,
	uri?: vscode.Uri,
): Promise<void> {
	let targetUri = uri
	if (!targetUri && vscode.window.activeTextEditor?.document.languageId === "cangjie") {
		targetUri = vscode.window.activeTextEditor.document.uri
	}
	if (!targetUri?.fsPath.endsWith(".cj")) {
		vscode.window.showWarningMessage(t("warnings.cangjie_lsp.execute_on_cj_file"))
		return
	}
	const base = path.basename(targetUri.fsPath, ".cj")
	if (base.endsWith("_test")) {
		vscode.window.showInformationMessage(t("info.cangjie_lsp.already_test_file"))
		return
	}

	const folder = vscode.workspace.getWorkspaceFolder(targetUri)
	let srcContent = ""
	try {
		const srcDoc = await vscode.workspace.openTextDocument(targetUri)
		srcContent = srcDoc.getText()
	} catch {
		vscode.window.showErrorMessage(t("errors.cangjie_lsp.cannot_read_source"))
		return
	}

	if (!hasTestableCangjieExports(srcContent)) {
		vscode.window.showInformationMessage(t("info.cangjie_lsp.no_testable_exports"))
		return
	}

	const testPath = resolveTestFilePath(targetUri, base, folder)

	if (folder) {
		const mirrored = mirroredTestPathUnderTestDir(targetUri, base, folder, testPath)
		if (mirrored && fs.existsSync(mirrored) && path.normalize(mirrored) !== path.normalize(testPath)) {
			const choice = await vscode.window.showWarningMessage(
				t("warnings.cangjie_lsp.test_file_exists_in_test_dir", {
					path: path.relative(folder.uri.fsPath, mirrored),
				}),
				t("buttons.cangjie_lsp.open"),
				t("buttons.cangjie_lsp.still_generate"),
				t("buttons.cangjie_lsp.cancel"),
			)
			if (choice === t("buttons.cangjie_lsp.open")) {
				const doc = await vscode.workspace.openTextDocument(mirrored)
				await vscode.window.showTextDocument(doc)
				return
			}
			if (choice !== t("buttons.cangjie_lsp.still_generate")) return
		}
	}

	if (fs.existsSync(testPath)) {
		const choice = await vscode.window.showWarningMessage(
			t("warnings.cangjie_lsp.test_file_exists", { name: path.basename(testPath) }),
			t("buttons.cangjie_lsp.open"),
			t("buttons.cangjie_lsp.cancel"),
		)
		if (choice === t("buttons.cangjie_lsp.open")) {
			const doc = await vscode.workspace.openTextDocument(testPath)
			await vscode.window.showTextDocument(doc)
		}
		return
	}

	const testUri = vscode.Uri.file(testPath)
	const srcPkg = parseCangjiePackageDecl(srcContent) ?? inferCangjiePackageFromSrcLayout(targetUri)
	const testPkg = inferCangjiePackageFromSrcLayout(testUri)

	let pkgPrefix = ""
	if (testPkg) {
		pkgPrefix = `package ${testPkg}\n\n`
	} else {
		const first = srcContent.split(/\r?\n/).find((l) => l.trim().startsWith("package "))
		if (first?.trim().startsWith("package ")) {
			pkgPrefix = `${first.trim()}\n\n`
		}
	}

	let sourceImport = ""
	if (srcPkg && testPkg && srcPkg !== testPkg) {
		sourceImport = `import ${srcPkg}.*\n`
	}

	const safe = sanitizeCangjieTestSymbolBase(base)
	const symbols = extractPublicSymbols(srcContent)
	const className = testClassNameFromBase(safe)
	const body = buildCangjieTestFileBody(safe, symbols)

	const content =
		pkgPrefix +
		sourceImport +
		"import std.unittest.*\n" +
		"import std.unittest.testmacro.*\n\n" +
		"@Test\n" +
		`class ${className} {\n` +
		body +
		"}\n"

	fs.writeFileSync(testPath, content, "utf-8")
	await registerGeneratedCangjieTestFile(getCurrentTaskId?.(), testPath, folder?.uri.fsPath)
	const doc = await vscode.workspace.openTextDocument(testPath)
	await vscode.window.showTextDocument(doc)
}

async function runCjpmCommand(cjpmArg: string): Promise<void> {
	const cwd = findCjpmRoot()
	if (!cwd) {
		vscode.window.showErrorMessage("No Cangjie project with cjpm.toml is open.")
		return
	}

	// ── Route through SandboxExecutionService (policy evaluation only) ───────
	// Docker branch uses run() which handles full audit internally.
	// Guarded-host branch uses terminal pipeline, so we audit separately.
	const sandboxService = SandboxExecutionService.getInstance()
	const sandboxExecId = SandboxExecutionService.generateExecutionId()
	const resourceScopeId = `user:cangjie-command:${sandboxExecId}`
	let outputChannel: vscode.OutputChannel | undefined

	try {
		const preflightRequest = {
			executionId: sandboxExecId,
			taskId: "cangjie-command",
			resourceScopeId,
			command: `cjpm ${cjpmArg}`,
			workspacePath: cwd,
			cwd,
			timeoutMs: 120_000,
			source: "user" as const,
			onOutput: () => {},
		}
		const sandboxBackend = await sandboxService.evaluatePolicyOnly("user", preflightRequest)
		const target: CangjieExecutionTarget =
			sandboxBackend === "docker" ? "docker-linux" : process.platform === "win32" ? "host-windows" : "host-posix"

		if (target === "docker-linux") {
			let executionFailed = false
			let executionError: unknown
			let cleanupFailed = false
			let cleanupError: unknown
			try {
				outputChannel = getCangjieSandboxChannel()
				outputChannel.show()
				const handle = await sandboxService.run({
					...preflightRequest,
					command: `/usr/local/bin/cjpm ${cjpmArg}`,
					onOutput: (chunk: { text: string }) => outputChannel?.append(chunk.text),
				})
				outputChannel.appendLine(`\n[Exit code: ${handle.exitCode ?? 0}]`)
			} catch (error) {
				executionFailed = true
				executionError = error
			} finally {
				try {
					await sandboxService.disposeScope(resourceScopeId)
				} catch (error) {
					cleanupFailed = true
					cleanupError = error
				}
			}
			if (executionFailed && cleanupFailed) {
				throw new AggregateError(
					[executionError, cleanupError],
					`Sandbox execution failed: ${wrapAsError(executionError).message}; scope cleanup failed: ${wrapAsError(cleanupError).message}`,
				)
			}
			if (executionFailed) throw executionError
			if (cleanupFailed) throw cleanupError
			return
		}

		const cjpmPath = resolveCangjieToolPath("cjpm", "cangjieTools.cjpmPath")
		if (!cjpmPath) {
			void vscode.window
				.showErrorMessage(t("errors.cangjie_lsp.cjpm_not_found"), t("buttons.cangjie_lsp.open_settings"))
				.then((choice) => {
					if (choice === t("buttons.cangjie_lsp.open_settings")) {
						void vscode.commands.executeCommand(
							"workbench.action.openSettings",
							`${Package.name}.cangjieTools.cjpmPath`,
						)
					}
				})
			return
		}

		const cmd = target === "host-windows" ? `& "${cjpmPath}" ${cjpmArg}` : `"${cjpmPath}" ${cjpmArg}`
		const request = { ...preflightRequest, command: cmd, timeoutMs: 0 }
		await sandboxService.evaluateAndAuditExecution(request)
		let stopTracking: (() => void) | undefined
		try {
			const terminal = vscode.window.createTerminal({
				name: `cjpm ${cjpmArg}`,
				cwd,
				env: buildCangjieToolEnv() as Record<string, string>,
			})
			terminal.show()
			stopTracking = sandboxService.trackExternalTerminalExecution(
				sandboxExecId,
				terminal,
				sandboxService.getEffectiveTimeout(0, "user"),
			)
			terminal.sendText(cmd)
		} catch (error) {
			try {
				stopTracking?.()
			} catch (cleanupError) {
				logger.debug("CangjieCommands", "Failed to stop terminal tracking after startup error", cleanupError)
			}
			try {
				sandboxService.recordExecutionComplete(
					sandboxExecId,
					{
						executionId: sandboxExecId,
						backend: "guarded-host",
						exitCode: undefined,
						output: "",
						cancelled: false,
						timedOut: false,
					},
					wrapAsError(error),
				)
			} catch (auditError) {
				logger.warn("CangjieCommands", "Failed to record terminal startup failure", auditError)
			}
			throw error
		}
	} catch (error) {
		logger.debug("CangjieCommands", "Command execution failed", error)
		const message = error instanceof Error ? error.message : String(error)
		outputChannel?.appendLine(`\n[Sandbox execution failed: ${message}]`)
		vscode.window.showErrorMessage(`Cangjie command failed: ${message}`)
	}
}

async function runCangjieInitializeProject(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0]
	if (!folder) {
		vscode.window.showErrorMessage("No workspace folder open.")
		return
	}

	const cwd = folder.uri.fsPath
	if (fs.existsSync(path.join(cwd, "cjpm.toml"))) {
		vscode.window.showInformationMessage("This workspace already contains cjpm.toml; initialization was skipped.")
		return
	}

	const name = await vscode.window.showInputBox({
		prompt: "Cangjie package name",
		placeHolder: "my_project",
		validateInput: (value) =>
			/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())
				? undefined
				: "Use letters, digits, and underscores; the first character cannot be a digit.",
	})
	if (!name) return
	const normalizedName = name.trim()
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedName)) {
		vscode.window.showErrorMessage("Invalid Cangjie package name.")
		return
	}

	type ProjectTypePick = vscode.QuickPickItem & { projectType: (typeof CANGJIE_PROJECT_TYPES)[number] }
	const typePick = await vscode.window.showQuickPick<ProjectTypePick>(
		CANGJIE_PROJECT_TYPES.map((projectType) => ({
			label: projectType,
			description:
				projectType === "executable"
					? "Runnable application"
					: projectType === "static"
						? "Static library"
						: "Dynamic library",
			projectType,
		})),
		{ placeHolder: "Select the Cangjie project output type" },
	)
	if (!typePick) return
	const confirmation = await vscode.window.showWarningMessage(
		`Initialize Cangjie project "${normalizedName}" as ${typePick.projectType} in ${cwd}?`,
		"Initialize",
		"Cancel",
	)
	if (confirmation !== "Initialize") return

	const cjpmPath = resolveCangjieToolPath("cjpm", "cangjieTools.cjpmPath")
	if (!cjpmPath) {
		void vscode.window
			.showErrorMessage(t("errors.cangjie_lsp.cjpm_not_found"), t("buttons.cangjie_lsp.open_settings"))
			.then((choice) => {
				if (choice === t("buttons.cangjie_lsp.open_settings")) {
					void vscode.commands.executeCommand(
						"workbench.action.openSettings",
						`${Package.name}.cangjieTools.cjpmPath`,
					)
				}
			})
		return
	}

	const terminal = vscode.window.createTerminal({
		name: "cjpm init",
		cwd,
		env: buildCangjieToolEnv() as Record<string, string>,
	})
	terminal.show()
	const command =
		process.platform === "win32"
			? `& "${cjpmPath}" init --name "${normalizedName}" --type=${typePick.projectType}`
			: `"${cjpmPath}" init --name "${normalizedName}" --type=${typePick.projectType}`
	terminal.sendText(command)
}

export function registerCangjieCommands(
	context: vscode.ExtensionContext,
	lspClient: CangjieLspClient,
	symbolIndex?: CangjieSymbolIndex,
	getCurrentTaskId?: () => string | undefined,
): void {
	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieInitializeProject", runCangjieInitializeProject),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieVerifySdk", async () => {
			const ch = vscode.window.createOutputChannel("Cangjie SDK Verify")
			ch.show(true)
			ch.appendLine(t("info.cangjie_lsp.detecting_toolchain"))
			const probes = await probeCangjieToolchain()
			ch.appendLine(formatCangjieToolchainReport(probes))
			ch.appendLine(t("info.cangjie_lsp.detection_complete"))
			if (!probes.every((p) => p.ok)) {
				void vscode.window.showWarningMessage(t("warnings.cangjie_lsp.tools_unavailable"))
			} else {
				void vscode.window.showInformationMessage(t("info.cangjie_lsp.toolchain_ok"))
			}
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieViewEvalTrace", async () => {
			const cwd = findWorkspaceRoot()
			if (!cwd) {
				vscode.window.showErrorMessage("No workspace folder open.")
				return
			}

			const tracePath = getCangjieWorkspaceEvalTracePath(cwd)
			const globalTracePath = await getCangjieGlobalEvalTracePath(context.globalStorageUri.fsPath)
			const [summary, globalSummary] = await Promise.all([
				readCangjieEvalTraceSummary(tracePath),
				readCangjieEvalTraceSummary(globalTracePath),
			])
			const channel = vscode.window.createOutputChannel("Cangjie Eval Trace")
			channel.clear()
			channel.appendLine("Workspace eval summary:")
			channel.appendLine(formatCangjieEvalTraceSummaryMarkdown(summary))
			channel.appendLine(`- trace file: ${tracePath}`)
			channel.appendLine("")
			channel.appendLine("Global roadmap eval summary:")
			channel.appendLine(formatCangjieEvalTraceSummaryMarkdown(globalSummary))
			channel.appendLine(`- trace file: ${globalTracePath}`)
			channel.show(true)

			if (summary.totalEntries === 0) {
				void vscode.window.showInformationMessage("No Cangjie eval trace entries found in this workspace.")
			}
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieViewProjectStructure", async () => {
			const cwd = findWorkspaceRoot()
			if (!cwd) {
				vscode.window.showErrorMessage("No workspace folder open.")
				return
			}

			const projectInfo = await parseCjpmToml(cwd)
			if (!projectInfo) {
				vscode.window.showErrorMessage("No valid cjpm.toml found in the current workspace.")
				return
			}

			const activeDocument = vscode.window.activeTextEditor?.document
			const activePackage =
				activeDocument?.languageId === "cangjie"
					? (parseCangjiePackageDecl(activeDocument.getText()) ?? null)
					: null
			const activeFilePath = activeDocument?.languageId === "cangjie" ? activeDocument.uri.fsPath : null
			const overview = await buildCompactProjectOverviewSection(cwd, projectInfo, activePackage, activeFilePath)
			const packageValidation = await buildProjectPackageValidationSection(cwd, projectInfo)

			const channel = vscode.window.createOutputChannel("Cangjie Project Structure")
			channel.clear()
			channel.appendLine("Cangjie project structure:")
			channel.appendLine(`Root: ${cwd}`)
			channel.appendLine(overview)
			channel.appendLine(packageValidation)
			channel.show(true)
		}),
	)

	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((doc) => {
			if (!doc.uri.fsPath.endsWith(LEARNED_FIXES_FILE)) return
			const norm = doc.uri.fsPath.replace(/\\/g, "/")
			if (!norm.includes(`/${NJUST_AI_CONFIG_DIR}/`)) return
			invalidateCangjieContextSectionCache()
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieViewLearnedFixes", async () => {
			const cwd = findCjpmRoot()
			if (!cwd) {
				vscode.window.showErrorMessage(t("errors.cangjie_lsp.no_cjpm_workspace"))
				return
			}
			ensureLearnedFixesFile(cwd)
			const fileUri = vscode.Uri.file(getLearnedFixesJsonPath(cwd))
			const textDoc = await vscode.workspace.openTextDocument(fileUri)
			await vscode.window.showTextDocument(textDoc)
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieManageLearnedFixes", async () => {
			const cwd = findCjpmRoot()
			if (!cwd) {
				vscode.window.showErrorMessage(t("errors.cangjie_lsp.no_cjpm_workspace"))
				return
			}
			const data = loadLearnedFixes(cwd)
			if (data.patterns.length === 0) {
				vscode.window.showInformationMessage(t("info.cangjie_lsp.no_learned_fixes"))
				return
			}

			type Pick = vscode.QuickPickItem & { index: number }
			const items: Pick[] = data.patterns.map((p, i) => ({
				label: p.errorPattern.length > 72 ? p.errorPattern.slice(0, 72) + "…" : p.errorPattern,
				description:
					p.fix.length > 0
						? p.fix.length > 48
							? p.fix.slice(0, 48) + "…"
							: p.fix
						: t("info.cangjie_lsp.no_fix_yet"),
				index: i,
			}))
			const sel = await vscode.window.showQuickPick(items, {
				placeHolder: t("info.cangjie_lsp.select_learned_fix"),
			})
			if (!sel) return

			const op = await vscode.window.showQuickPick(
				[t("buttons.cangjie_lsp.edit_fix"), t("buttons.cangjie_lsp.delete_entry")],
				{
					placeHolder: t("info.cangjie_lsp.select_action"),
				},
			)
			if (!op) return

			const idx = sel.index
			if (op === t("buttons.cangjie_lsp.delete_entry")) {
				data.patterns.splice(idx, 1)
				saveLearnedFixes(cwd, data)
				invalidateCangjieContextSectionCache()
				vscode.window.showInformationMessage(t("info.cangjie_lsp.entry_deleted"))
				return
			}

			const cur = data.patterns[idx]!
			const next = await vscode.window.showInputBox({
				title: t("buttons.cangjie_lsp.edit_fix"),
				value: cur.fix,
				prompt: t("info.cangjie_lsp.edit_fix_prompt"),
			})
			if (next === undefined) return
			cur.fix = next.slice(0, 1000)
			saveLearnedFixes(cwd, data)
			invalidateCangjieContextSectionCache()
			vscode.window.showInformationMessage(t("info.cangjie_lsp.learned_fixes_updated"))
		}),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieGenerateTestFile", (resource?: vscode.Uri) =>
			runCangjieGenerateTestFile(getCurrentTaskId, resource),
		),
	)

	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieCleanGeneratedTests", async () => {
			const scan = scanGeneratedFilesForCleanup()
			const detachedFiles = scan.detached
			const legacyFiles = scan.legacy

			if (detachedFiles.length === 0 && legacyFiles.length === 0) {
				void vscode.window.showInformationMessage(t("info.cangjie_lsp.no_tests_to_clean"))
				return
			}

			if (detachedFiles.length > 0) {
				const fileList = detachedFiles.map((f) => f.absolutePath).join("\n")
				const confirm = await vscode.window.showInformationMessage(
					t("info.cangjie_lsp.confirm_cleanup", { count: detachedFiles.length }),
					{ modal: true, detail: fileList },
					t("buttons.cangjie_lsp.confirm_delete"),
				)
				if (confirm !== t("buttons.cangjie_lsp.confirm_delete")) {
					return
				}
				const result = await deleteConfirmedCangjieTestFiles(detachedFiles)
				await reportCleanupResult(result)
			}

			if (legacyFiles.length > 0) {
				// Re-associate legacy files with current workspace roots
				const workspaceRoots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)
				const _reassociateResult = reassociateLegacyFiles(workspaceRoots)

				// Only include legacy files that were successfully re-associated
				const deletableLegacy = legacyFiles.filter((f) => f.workspaceRoot.length > 0)
				const nonWorkspaceLegacy = legacyFiles.length - deletableLegacy.length

				if (deletableLegacy.length === 0) {
					// All legacy files are outside workspace — cannot be deleted
					const msg =
						nonWorkspaceLegacy > 0
							? t("info.cangjie_lsp.legacy_all_outside_workspace", { count: nonWorkspaceLegacy })
							: t("info.cangjie_lsp.no_tests_to_clean")
					void vscode.window.showInformationMessage(msg)
					return
				}

				const legacyList = deletableLegacy.map((f) => f.absolutePath).join("\n")
				const detailParts = [legacyList]
				if (nonWorkspaceLegacy > 0) {
					detailParts.push(t("info.cangjie_lsp.legacy_outside_workspace_note", { count: nonWorkspaceLegacy }))
				}

				const legacyConfirm = await vscode.window.showWarningMessage(
					t("info.cangjie_lsp.confirm_legacy_cleanup", { count: deletableLegacy.length }),
					{ modal: true, detail: detailParts.join("\n\n") },
					t("buttons.cangjie_lsp.confirm_delete"),
				)
				if (legacyConfirm !== t("buttons.cangjie_lsp.confirm_delete")) {
					return
				}
				const legacyResult = await deleteConfirmedCangjieTestFiles(deletableLegacy, { allowLegacy: true })
				await reportCleanupResult(legacyResult)
			}
		}),
	)

	for (const cmd of CJPM_COMMANDS) {
		context.subscriptions.push(vscode.commands.registerCommand(cmd.id, () => runCjpmCommand(cmd.cjpmArg)))
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieRestartLsp", async () => {
			vscode.window.showInformationMessage("Restarting Cangjie Language Server…")
			await lspClient.restart()
			vscode.window.showInformationMessage("Cangjie Language Server restarted.")
		}),
	)

	// ── Template Library ──
	const templateLibrary = new CangjieTemplateLibrary()
	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieInsertTemplate", () => templateLibrary.showTemplatePicker()),
	)

	// ── Profiler ──
	const outputChannel = vscode.window.createOutputChannel("Cangjie Profiler")
	const profiler = new CangjieProfiler(outputChannel)
	context.subscriptions.push(profiler)
	context.subscriptions.push(
		vscode.commands.registerCommand("njust-ai.cangjieProfile", async () => {
			const cwd = findCjpmRoot()
			if (!cwd) {
				vscode.window.showErrorMessage("No cjpm project found.")
				return
			}
			const result = await profiler.profile(cwd)
			if (result.success) {
				profiler.applyHeatMap(result)
				await profiler.showProfileSummary(result)
			} else {
				vscode.window.showErrorMessage(`Profiling failed: ${result.output.slice(0, 200)}`)
			}
		}),
	)

	// ── Refactoring ──
	if (symbolIndex) {
		const refactoring = new CangjieRefactoringProvider(symbolIndex)
		context.subscriptions.push(
			vscode.languages.registerCodeActionsProvider({ language: "cangjie", scheme: "file" }, refactoring, {
				providedCodeActionKinds: CangjieRefactoringProvider.providedCodeActionKinds,
			}),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand(
				"njust-ai.cangjieExtractFunction",
				(doc: vscode.TextDocument, range: vscode.Range) => refactoring.extractFunction(doc, range),
			),
		)
		context.subscriptions.push(
			vscode.commands.registerCommand("njust-ai.cangjieMoveFile", async () => {
				const editor = vscode.window.activeTextEditor
				if (editor?.document.fileName.endsWith(".cj")) {
					await refactoring.moveFile(editor.document.uri)
				} else {
					vscode.window.showWarningMessage(t("warnings.cangjie_lsp.open_cj_file_first"))
				}
			}),
		)
	}
}
