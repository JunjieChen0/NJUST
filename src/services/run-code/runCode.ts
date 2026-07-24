import * as vscode from "vscode"
import * as path from "path"
import * as fs from "fs"
import * as shellQuote from "shell-quote"
import { resolveCangjieToolPath, buildCangjieToolEnv, CJC_CONFIG_KEY } from "../cangjie-lsp/cangjieToolUtils"
import { buildMatlabRunConfig } from "../matlab/matlabRunner"
import { resolveMatlabRuntime } from "../matlab/matlabToolUtils"
import { Package } from "../../shared/package"
import { resolveLatexmkExecutable, resolvePdflatexExecutable } from "../latex/latexResolve"
import { t } from "../../i18n"
import { SandboxExecutionService } from "../sandbox"
import { wrapAsError } from "../../shared/error-utils"
import { logger } from "../../shared/logger"

interface RunConfig {
	command: string
	cwd?: string
	env?: Record<string, string>
}

export type RunExecutionTarget = "host-windows" | "host-posix" | "docker-linux"

const hostExecutionTarget: RunExecutionTarget = process.platform === "win32" ? "host-windows" : "host-posix"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect shell metacharacters that could lead to command injection.
 * These characters can break out of quoted strings or execute arbitrary commands.
 */
function containsShellMetacharacters(p: string): boolean {
	return /[&|;<>()$`!"\n\r]/.test(p)
}

/**
 * Quote a file path for safe use in shell commands.
 * Uses double quotes with escaping for special characters.
 * This prevents shell injection while ensuring the command works on both platforms.
 * If the path contains shell metacharacters that cannot be safely escaped, an error is thrown.
 */
function quotePath(p: string): string {
	if (containsShellMetacharacters(p)) {
		throw new Error(
			`File path contains shell metacharacters and cannot be safely executed: ${p}. ` +
				`Please rename the file to remove special characters like &, |, ;, <, >, $, \`, !.`,
		)
	}
	// Escape double quotes and backticks to prevent breaking out of the quoted string.
	const escaped = p.replace(/"/g, '\\"').replace(/`/g, "\\`")
	return `"${escaped}"`
}

/**
 * Convert a host path to the path visible to the selected execution target.
 * Docker mounts the selected workspace at /workspace and cannot access files
 * outside that mount.
 */
export function toExecutionPath(hostPath: string, workspacePath: string, target: RunExecutionTarget): string {
	if (target !== "docker-linux") return hostPath

	const pathApi = /^[a-zA-Z]:[\\/]/.test(workspacePath) || workspacePath.startsWith("\\\\") ? path.win32 : path.posix
	if (!pathApi.isAbsolute(workspacePath) || !pathApi.isAbsolute(hostPath)) {
		throw new Error("Docker execution requires absolute workspace and file paths.")
	}

	const resolvedWorkspace = pathApi.resolve(workspacePath)
	const resolvedHostPath = pathApi.resolve(hostPath)
	const relative = pathApi.relative(resolvedWorkspace, resolvedHostPath)
	if (relative === ".." || relative.startsWith(`..${pathApi.sep}`) || pathApi.isAbsolute(relative)) {
		throw new Error(`Cannot run a file outside the active workspace in Docker: ${hostPath}`)
	}

	return relative ? `/workspace/${relative.replace(/\\/g, "/")}` : "/workspace"
}

function commandPath(hostPath: string, workspacePath: string, target: RunExecutionTarget): string {
	return toExecutionPath(hostPath, workspacePath, target)
}

/**
 * Chain multiple shell commands with short-circuit on failure.
 * On Windows (cmd.exe) uses `&&`; on POSIX uses `&&`.
 * The terminal is opened with cmd.exe on Windows so `&&` is always valid.
 */
function chain(...cmds: string[]): string {
	return cmds.join(" && ")
}

function findProjectRoot(startDir: string, markers: string[]): string | undefined {
	let dir = startDir
	const root = path.parse(dir).root
	while (true) {
		for (const marker of markers) {
			if (fs.existsSync(path.join(dir, marker))) {
				return dir
			}
		}
		const parent = path.dirname(dir)
		if (parent === dir || parent === root) {
			break
		}
		dir = parent
	}
	return undefined
}

function listSourceFiles(dir: string, extensions: string[]): string[] {
	try {
		return fs.readdirSync(dir).filter((f) => {
			const ext = path.extname(f).toLowerCase()
			return extensions.includes(ext) && fs.statSync(path.join(dir, f)).isFile()
		})
	} catch {
		return []
	}
}

function exeName(base: string, target: RunExecutionTarget): string {
	return target === "host-windows" ? `${base}.exe` : `./${base}`
}

// ---------------------------------------------------------------------------
// Per-language run config builders
// ---------------------------------------------------------------------------

function buildPythonConfig(filePath: string, workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)
	const executableFilePath = commandPath(filePath, workDir, target)

	const pyprojectRoot = findProjectRoot(fileDir, ["pyproject.toml"])
	if (pyprojectRoot) {
		if (fs.existsSync(path.join(pyprojectRoot, "poetry.lock"))) {
			return { command: `poetry run python ${quotePath(executableFilePath)}`, cwd: pyprojectRoot }
		}
		return { command: `python ${quotePath(executableFilePath)}`, cwd: pyprojectRoot }
	}

	if (fs.existsSync(path.join(fileDir, "__main__.py"))) {
		const pkgDir = path.dirname(fileDir)
		const pkgName = path.basename(fileDir)
		return { command: `python -m ${pkgName}`, cwd: pkgDir }
	}

	return { command: `python ${quotePath(executableFilePath)}` }
}

function buildJavaScriptConfig(filePath: string, workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)
	const pkgRoot = findProjectRoot(fileDir, ["package.json"])

	if (pkgRoot) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf-8"))
			if (pkg.scripts?.start) {
				return { command: "npm start", cwd: pkgRoot }
			}
			if (pkg.scripts?.dev) {
				return { command: "npm run dev", cwd: pkgRoot }
			}
		} catch {
			// intentionally ignored: package.json read failure
		}
	}

	return { command: `node ${quotePath(commandPath(filePath, workDir, target))}` }
}

function buildTypeScriptConfig(filePath: string, workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)
	const pkgRoot = findProjectRoot(fileDir, ["package.json"])

	if (pkgRoot) {
		try {
			const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf-8"))
			if (pkg.scripts?.start) {
				return { command: "npm start", cwd: pkgRoot }
			}
			if (pkg.scripts?.dev) {
				return { command: "npm run dev", cwd: pkgRoot }
			}
		} catch {
			// intentionally ignored: package.json read failure
		}
	}

	return { command: `npx tsx ${quotePath(commandPath(filePath, workDir, target))}` }
}

function buildCConfig(filePath: string, workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)

	const cmakeRoot = findProjectRoot(fileDir, ["CMakeLists.txt"])
	if (cmakeRoot) {
		const bd = path.join(cmakeRoot, "build")
		return {
			command: chain(
				`cmake -S ${quotePath(commandPath(cmakeRoot, workDir, target))} -B ${quotePath(commandPath(bd, workDir, target))}`,
				`cmake --build ${quotePath(commandPath(bd, workDir, target))}`,
				`cmake --build ${quotePath(commandPath(bd, workDir, target))} --target run`,
			),
			cwd: cmakeRoot,
		}
	}

	const makeRoot = findProjectRoot(fileDir, ["Makefile", "makefile", "GNUmakefile"])
	if (makeRoot) {
		return { command: chain("make", "make run"), cwd: makeRoot }
	}

	const base = path.basename(filePath, ".c")
	const cFiles = listSourceFiles(fileDir, [".c"])
	const cFilesQuoted = cFiles.map(quotePath)
	if (cFiles.length > 1) {
		const out = exeName(base, target)
		return { command: chain(`gcc ${cFilesQuoted.join(" ")} -o ${quotePath(out)}`, quotePath(out)), cwd: fileDir }
	}
	const out = exeName(base, target)
	return {
		command: chain(`gcc ${quotePath(path.basename(filePath))} -o ${quotePath(out)}`, quotePath(out)),
		cwd: fileDir,
	}
}

function buildCppConfig(filePath: string, workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)

	const cmakeRoot = findProjectRoot(fileDir, ["CMakeLists.txt"])
	if (cmakeRoot) {
		const bd = path.join(cmakeRoot, "build")
		return {
			command: chain(
				`cmake -S ${quotePath(commandPath(cmakeRoot, workDir, target))} -B ${quotePath(commandPath(bd, workDir, target))}`,
				`cmake --build ${quotePath(commandPath(bd, workDir, target))}`,
				`cmake --build ${quotePath(commandPath(bd, workDir, target))} --target run`,
			),
			cwd: cmakeRoot,
		}
	}

	const makeRoot = findProjectRoot(fileDir, ["Makefile", "makefile", "GNUmakefile"])
	if (makeRoot) {
		return { command: chain("make", "make run"), cwd: makeRoot }
	}

	const base = path.basename(filePath, path.extname(filePath))
	const cppFiles = listSourceFiles(fileDir, [".cpp", ".cc", ".cxx"])
	const cppFilesQuoted = cppFiles.map(quotePath)
	if (cppFiles.length > 1) {
		const out = exeName(base, target)
		return {
			command: chain(`g++ ${cppFilesQuoted.join(" ")} -o ${quotePath(out)}`, quotePath(out)),
			cwd: fileDir,
		}
	}
	const out = exeName(base, target)
	return {
		command: chain(`g++ ${quotePath(path.basename(filePath))} -o ${quotePath(out)}`, quotePath(out)),
		cwd: fileDir,
	}
}

function buildJavaConfig(filePath: string, _workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)

	const mavenRoot = findProjectRoot(fileDir, ["pom.xml"])
	if (mavenRoot) {
		const mvn = target === "host-windows" ? "mvn.cmd" : "mvn"
		return { command: chain(`${mvn} compile`, `${mvn} exec:java`), cwd: mavenRoot }
	}

	const gradleRoot = findProjectRoot(fileDir, ["build.gradle", "build.gradle.kts"])
	if (gradleRoot) {
		const wrapper = target === "host-windows" ? "gradlew.bat" : "./gradlew"
		const cmd = fs.existsSync(path.join(gradleRoot, target === "host-windows" ? "gradlew.bat" : "gradlew"))
			? wrapper
			: "gradle"
		return { command: `${cmd} run`, cwd: gradleRoot }
	}

	const className = path.basename(filePath, ".java")
	const javaFiles = listSourceFiles(fileDir, [".java"])
	const javaFilesQuoted = javaFiles.map(quotePath)
	if (javaFiles.length > 1) {
		return { command: chain(`javac ${javaFilesQuoted.join(" ")}`, `java ${quotePath(className)}`), cwd: fileDir }
	}

	return {
		command: chain(`javac ${quotePath(path.basename(filePath))}`, `java ${quotePath(className)}`),
		cwd: fileDir,
	}
}

function buildGoConfig(filePath: string, workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)

	const goModRoot = findProjectRoot(fileDir, ["go.mod"])
	if (goModRoot) {
		const relDir = path.relative(goModRoot, fileDir) || "."
		return { command: `go run ./${relDir.replace(/\\/g, "/")}`, cwd: goModRoot }
	}

	const goFiles = listSourceFiles(fileDir, [".go"])
	if (goFiles.length > 1) {
		return { command: "go run .", cwd: fileDir }
	}

	return { command: `go run ${quotePath(commandPath(filePath, workDir, target))}` }
}

function buildRustConfig(filePath: string, workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)

	const cargoRoot = findProjectRoot(fileDir, ["Cargo.toml"])
	if (cargoRoot) {
		return { command: "cargo run", cwd: cargoRoot }
	}

	const base = path.basename(filePath, ".rs")
	const out = exeName(base, target)
	return {
		command: chain(
			`rustc ${quotePath(commandPath(filePath, workDir, target))} -o ${quotePath(out)}`,
			quotePath(out),
		),
		cwd: fileDir,
	}
}

function buildMatlabConfig(filePath: string, _workDir: string, target: RunExecutionTarget): RunConfig | undefined {
	if (target === "docker-linux") {
		throw new Error("MATLAB Run Code is not supported by the Docker sandbox.")
	}
	const ext = path.extname(filePath).toLowerCase()
	if (ext === ".mlx") {
		void vscode.window.showWarningMessage(t("errors.run_code.matlab_live_script_unsupported"))
		return undefined
	}
	// Reject file paths with shell metacharacters to prevent command injection
	// when the path is interpolated into an Octave/MATLAB shell command.
	if (containsShellMetacharacters(filePath)) {
		void vscode.window.showErrorMessage(
			`File path contains shell metacharacters and cannot be safely executed: ${filePath}. ` +
				`Please rename the file to remove special characters like &, |, ;, <, >, $, \`, !, ".`,
		)
		return undefined
	}
	const c = buildMatlabRunConfig(filePath)
	if (!c) {
		if (ext === ".m") {
			if (!resolveMatlabRuntime()) {
				void vscode.window.showErrorMessage(t("errors.run_code.matlab_not_detected"))
			} else {
				void vscode.window.showWarningMessage("Failed to generate run command for this file.")
			}
		}
		return undefined
	}
	return c
}

function buildCangjieConfig(filePath: string, _workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)

	const cjpmRoot = findProjectRoot(fileDir, ["cjpm.toml"])
	if (cjpmRoot) {
		if (target === "docker-linux") {
			return { command: "/usr/local/bin/cjpm run", cwd: cjpmRoot }
		}

		const env = buildCangjieToolEnv()
		const cjpm = resolveCangjieToolPath("cjpm", "cangjieTools.cjpmPath") || "cjpm"
		const cmd = target === "host-windows" ? `& ${quotePath(cjpm)} run` : `${quotePath(cjpm)} run`
		return { command: cmd, cwd: cjpmRoot, env }
	}

	const cjc =
		target === "docker-linux" ? "/usr/local/bin/cjc" : resolveCangjieToolPath("cjc", CJC_CONFIG_KEY) || "cjc"
	const env = target === "docker-linux" ? undefined : buildCangjieToolEnv()
	const base = path.basename(filePath, ".cj")
	const cjFiles = listSourceFiles(fileDir, [".cj"])
	const cjFilesQuoted = cjFiles.map(quotePath)
	if (cjFiles.length > 1) {
		const out = exeName(base, target)
		return {
			command: chain(`${quotePath(cjc)} ${cjFilesQuoted.join(" ")} -o ${quotePath(out)}`, quotePath(out)),
			cwd: fileDir,
			env,
		}
	}
	const out = exeName(base, target)
	return {
		command: chain(`${quotePath(cjc)} ${quotePath(path.basename(filePath))} -o ${quotePath(out)}`, quotePath(out)),
		cwd: fileDir,
		env,
	}
}

function buildKotlinConfig(filePath: string, _workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)

	const gradleRoot = findProjectRoot(fileDir, ["build.gradle", "build.gradle.kts"])
	if (gradleRoot) {
		const wrapper = target === "host-windows" ? "gradlew.bat" : "./gradlew"
		const cmd = fs.existsSync(path.join(gradleRoot, target === "host-windows" ? "gradlew.bat" : "gradlew"))
			? wrapper
			: "gradle"
		return { command: `${cmd} run`, cwd: gradleRoot }
	}

	const base = path.basename(filePath, ".kt")
	const ktFiles = listSourceFiles(fileDir, [".kt"])
	const ktFilesQuoted = ktFiles.map(quotePath)
	if (ktFiles.length > 1) {
		return {
			command: chain(
				`kotlinc ${ktFilesQuoted.join(" ")} -include-runtime -d ${quotePath(base + ".jar")}`,
				`java -jar ${quotePath(base + ".jar")}`,
			),
			cwd: fileDir,
		}
	}

	return {
		command: chain(
			`kotlinc ${quotePath(path.basename(filePath))} -include-runtime -d ${quotePath(base + ".jar")}`,
			`java -jar ${quotePath(base + ".jar")}`,
		),
		cwd: fileDir,
	}
}

function buildDartConfig(filePath: string, workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)
	const pubRoot = findProjectRoot(fileDir, ["pubspec.yaml"])
	return { command: `dart run ${quotePath(commandPath(filePath, workDir, target))}`, cwd: pubRoot || fileDir }
}

function buildSwiftConfig(filePath: string, workDir: string, target: RunExecutionTarget): RunConfig {
	const fileDir = path.dirname(filePath)

	const spmRoot = findProjectRoot(fileDir, ["Package.swift"])
	if (spmRoot) {
		return { command: "swift run", cwd: spmRoot }
	}

	const swiftFiles = listSourceFiles(fileDir, [".swift"])
	const swiftFilesQuoted = swiftFiles.map(quotePath)
	if (swiftFiles.length > 1) {
		const base = path.basename(filePath, ".swift")
		const out = exeName(base, target)
		return {
			command: chain(`swiftc ${swiftFilesQuoted.join(" ")} -o ${quotePath(out)}`, quotePath(out)),
			cwd: fileDir,
		}
	}

	return { command: `swift ${quotePath(commandPath(filePath, workDir, target))}` }
}

/**
 * LaTeX: compile to PDF in the same directory as the .tex file (default tool output location).
 * Uses `njust-ai.latex.*` settings (same as command LaTeX: Compile local).
 */
function buildLatexConfig(filePath: string, _workDir: string, target: RunExecutionTarget): RunConfig {
	if (target === "docker-linux") {
		throw new Error("LaTeX Run Code is not supported by the Docker sandbox.")
	}

	const cwd = path.dirname(filePath)
	const base = path.basename(filePath)
	const cfg = vscode.workspace.getConfiguration(Package.name)
	const engine = (cfg.get<string>("latex.engine") ?? "latexmk").toLowerCase()
	const extra = cfg.get<string[]>("latex.extraArgs") ?? []

	const quoteArg = (a: string) => shellQuote.quote([a])

	if (engine === "latexmk") {
		const bin = quoteArg(resolveLatexmkExecutable(cfg.get<string>("latex.latexmkPath")))
		const args = [
			"-pdf",
			"-interaction=nonstopmode",
			"-file-line-error",
			"-synctex=1",
			...extra.map(quoteArg),
			quoteArg(base),
		]
		return { command: `${bin} ${args.join(" ")}`, cwd }
	}

	const bin = quoteArg(resolvePdflatexExecutable(cfg.get<string>("latex.pdflatexPath")))
	const args = ["-interaction=nonstopmode", "-file-line-error", "-synctex=1", ...extra.map(quoteArg), quoteArg(base)]
	return { command: `${bin} ${args.join(" ")}`, cwd }
}

// ---------------------------------------------------------------------------
// Language → builder mapping
// ---------------------------------------------------------------------------

type RunConfigBuilder = (filePath: string, workDir: string, target: RunExecutionTarget) => RunConfig | undefined

function buildPowerShellConfig(filePath: string, workDir: string, target: RunExecutionTarget): RunConfig {
	if (target === "docker-linux") {
		throw new Error("PowerShell Run Code is not supported by the Docker sandbox.")
	}
	return {
		command: `powershell -ExecutionPolicy Bypass -File ${quotePath(commandPath(filePath, workDir, target))}`,
	}
}

const LANGUAGE_RUN_MAP: Record<string, RunConfigBuilder> = {
	python: buildPythonConfig,
	javascript: buildJavaScriptConfig,
	typescript: buildTypeScriptConfig,
	c: buildCConfig,
	cpp: buildCppConfig,
	java: buildJavaConfig,
	go: buildGoConfig,
	rust: buildRustConfig,
	cangjie: buildCangjieConfig,
	kotlin: buildKotlinConfig,
	dart: buildDartConfig,
	swift: buildSwiftConfig,
	ruby: (fp, workDir, target) => ({ command: `ruby ${quotePath(commandPath(fp, workDir, target))}` }),
	php: (fp, workDir, target) => ({ command: `php ${quotePath(commandPath(fp, workDir, target))}` }),
	shellscript: (fp, workDir, target) => ({ command: `bash ${quotePath(commandPath(fp, workDir, target))}` }),
	powershell: buildPowerShellConfig,
	lua: (fp, workDir, target) => ({ command: `lua ${quotePath(commandPath(fp, workDir, target))}` }),
	perl: (fp, workDir, target) => ({ command: `perl ${quotePath(commandPath(fp, workDir, target))}` }),
	r: (fp, workDir, target) => ({ command: `Rscript ${quotePath(commandPath(fp, workDir, target))}` }),
	matlab: buildMatlabConfig,
	latex: buildLatexConfig,
	tex: buildLatexConfig,
}

// ---------------------------------------------------------------------------
// Extension → language
// ---------------------------------------------------------------------------

const EXT_TO_LANGUAGE: Record<string, string> = {
	".py": "python",
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".ts": "typescript",
	".mts": "typescript",
	".tsx": "typescript",
	".c": "c",
	".cpp": "cpp",
	".cc": "cpp",
	".cxx": "cpp",
	".java": "java",
	".go": "go",
	".rs": "rust",
	".cj": "cangjie",
	".rb": "ruby",
	".php": "php",
	".sh": "shellscript",
	".bash": "shellscript",
	".ps1": "powershell",
	".lua": "lua",
	".pl": "perl",
	".r": "r",
	".R": "r",
	".swift": "swift",
	".kt": "kotlin",
	".kts": "kotlin",
	".dart": "dart",
	".tex": "latex",
	".ltx": "latex",
}

function detectLanguage(document: vscode.TextDocument): string | undefined {
	const vscodeLang = document.languageId
	if (vscodeLang === "objective-c" && path.extname(document.fileName).toLowerCase() === ".m") {
		return undefined
	}
	if (LANGUAGE_RUN_MAP[vscodeLang]) {
		return vscodeLang
	}
	const ext = path.extname(document.fileName).toLowerCase()
	if (ext === ".m" || ext === ".mlx") {
		return "matlab"
	}
	return EXT_TO_LANGUAGE[ext]
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runActiveEditorCode(outputChannel: vscode.OutputChannel): Promise<void> {
	const editor = vscode.window.activeTextEditor
	if (!editor) {
		vscode.window.showWarningMessage("No active editor found. Please open a code file first.")
		return
	}

	const document = editor.document

	if (document.isUntitled) {
		vscode.window.showWarningMessage("Please save the file before running.")
		return
	}

	await vscode.workspace.saveAll(false)

	const language = detectLanguage(document)
	if (!language) {
		vscode.window.showWarningMessage(
			`Unsupported file type: ${path.extname(document.fileName) || document.languageId}`,
		)
		return
	}

	const builder = LANGUAGE_RUN_MAP[language]
	if (!builder) {
		vscode.window.showWarningMessage(`Unsupported language: ${language}`)
		return
	}

	const filePath = document.fileName
	const activeFolder = document.uri ? vscode.workspace.getWorkspaceFolder(document.uri) : undefined
	const workDir = activeFolder?.uri.fsPath || path.dirname(filePath)
	const sandboxService = SandboxExecutionService.getInstance()
	const sandboxExecId = SandboxExecutionService.generateExecutionId()
	const resourceScopeId = `user:run-code:${sandboxExecId}`

	try {
		const sandboxBackend = await sandboxService.evaluatePolicyOnly("user", {
			executionId: sandboxExecId,
			taskId: "run-code",
			resourceScopeId,
			command: `Run Code (${language}): ${path.basename(filePath)}`,
			workspacePath: workDir,
			cwd: path.dirname(filePath),
			timeoutMs: 120_000,
			source: "user",
			onOutput: () => {},
		})
		const target: RunExecutionTarget = sandboxBackend === "docker" ? "docker-linux" : hostExecutionTarget
		const config = builder(filePath, workDir, target)
		if (!config) {
			if (language !== "matlab") {
				vscode.window.showWarningMessage("Failed to generate run command for this file.")
			}
			return
		}

		const hostCwd = config.cwd || workDir
		// For Docker targets, convert host path to container path explicitly.
		// toExecutionPath validates the path is within workspace AND returns the mapped path.
		const cwd = target === "docker-linux" ? toExecutionPath(hostCwd, workDir, target) : hostCwd

		const request = {
			executionId: sandboxExecId,
			taskId: "run-code",
			resourceScopeId,
			command: config.command,
			workspacePath: workDir,
			cwd,
			timeoutMs: sandboxBackend === "docker" ? 120_000 : 0,
			source: "user" as const,
			environment: config.env,
			onOutput: (chunk: { text: string }) => {
				outputChannel.append(chunk.text)
			},
		}

		outputChannel.appendLine(`[Run Code] Language: ${language}, CWD: ${cwd}, Command: ${config.command}`)

		// ── Route through SandboxExecutionService ────────────────────────────────
		if (sandboxBackend === "docker") {
			let executionFailed = false
			let executionError: unknown
			let cleanupFailed = false
			let cleanupError: unknown
			try {
				const handle = await sandboxService.run(request)
				outputChannel.appendLine(`\n[Run Code] Exit code: ${handle.exitCode ?? "unknown"}`)
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

		await sandboxService.evaluateAndAuditExecution(request)
		let stopTracking: (() => void) | undefined
		try {
			const terminal = vscode.window.createTerminal({
				name: `Run: ${path.basename(filePath)}`,
				cwd,
				env: config.env,
				shellPath: target === "host-windows" && config.command.includes("&&") ? "cmd.exe" : undefined,
			})
			terminal.show()
			stopTracking = sandboxService.trackExternalTerminalExecution(
				sandboxExecId,
				terminal,
				sandboxService.getEffectiveTimeout(0, "user"),
			)
			terminal.sendText(config.command)
		} catch (error) {
			try {
				stopTracking?.()
			} catch (cleanupError) {
				logger.debug("RunCode", "Failed to stop terminal tracking after startup error", cleanupError)
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
				logger.warn("RunCode", "Failed to record terminal startup failure", auditError)
			}
			throw error
		}
	} catch (error) {
		logger.debug("RunCode", "Execution failed", error)
		const message = error instanceof Error ? error.message : String(error)
		outputChannel.appendLine(`[Run Code] Error: ${message}`)
		vscode.window.showErrorMessage(`Run Code failed: ${message}`)
	}
}
