import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import * as fs from "fs"

// Hoist mocks
const {
	resolveCangjieToolPathMock,
	buildCangjieToolEnvMock,
	buildMatlabRunConfigMock,
	resolveMatlabRuntimeMock,
	resolveLatexmkExecutableMock,
	resolvePdflatexExecutableMock,
	evaluatePolicyOnlyMock,
	runSandboxMock,
	evaluateAndAuditExecutionMock,
	trackExternalTerminalExecutionMock,
	stopExternalTerminalTrackingMock,
	recordExecutionCompleteMock,
	getEffectiveTimeoutMock,
	disposeScopeMock,
	generateExecutionIdMock,
} = vi.hoisted(() => ({
	resolveCangjieToolPathMock: vi.fn(),
	buildCangjieToolEnvMock: vi.fn(),
	buildMatlabRunConfigMock: vi.fn(),
	resolveMatlabRuntimeMock: vi.fn(),
	resolveLatexmkExecutableMock: vi.fn(),
	resolvePdflatexExecutableMock: vi.fn(),
	evaluatePolicyOnlyMock: vi.fn(),
	runSandboxMock: vi.fn(),
	evaluateAndAuditExecutionMock: vi.fn(),
	trackExternalTerminalExecutionMock: vi.fn(),
	stopExternalTerminalTrackingMock: vi.fn(),
	recordExecutionCompleteMock: vi.fn(),
	getEffectiveTimeoutMock: vi.fn(),
	disposeScopeMock: vi.fn(),
	generateExecutionIdMock: vi.fn(),
}))

vi.mock("fs", () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	readdirSync: vi.fn(),
	statSync: vi.fn(() => ({ isFile: () => true })),
}))

// Force win32 path behavior so Windows-style paths in tests work on all platforms
vi.mock("path", async () => {
	const actual = await vi.importActual<typeof import("path")>("path")
	return {
		...actual,
		default: actual.win32,
		basename: actual.win32.basename,
		dirname: actual.win32.dirname,
		extname: actual.win32.extname,
		join: actual.win32.join,
		parse: actual.win32.parse,
		relative: actual.win32.relative,
		resolve: actual.win32.resolve,
		sep: "\\",
	}
})

vi.mock("vscode", () => {
	const mockWorkspaceFolders = [
		{
			uri: { fsPath: "D:\\repo" },
			name: "repo",
			index: 0,
		},
	]

	const mockGetConfiguration = vi.fn().mockReturnValue({
		get: vi.fn().mockImplementation((key) => {
			if (key === "latex.engine") return "latexmk"
			if (key === "latex.extraArgs") return ["-shell-escape"]
			return undefined
		}),
	})

	const mockTerminal = {
		show: vi.fn(),
		sendText: vi.fn(),
	}

	const mockWindow = {
		activeTextEditor: undefined as any,
		showWarningMessage: vi.fn(),
		showErrorMessage: vi.fn(),
		createTerminal: vi.fn().mockReturnValue(mockTerminal),
	}

	const mockWorkspace: any = {
		workspaceFolders: mockWorkspaceFolders,
		saveAll: vi.fn().mockResolvedValue(true),
		getConfiguration: mockGetConfiguration,
	}
	mockWorkspace.getWorkspaceFolder = vi.fn((uri: { fsPath: string }) =>
		mockWorkspace.workspaceFolders?.find((folder: any) =>
			uri.fsPath.toLowerCase().startsWith(folder.uri.fsPath.toLowerCase()),
		),
	)

	return {
		window: mockWindow,
		workspace: mockWorkspace,
	}
})

vi.mock("../../shared/package", () => ({
	Package: { name: "njust-ai" },
}))

// Correct relative mock paths following the vitest path trap rule:
vi.mock("../../cangjie-lsp/cangjieToolUtils", () => ({
	resolveCangjieToolPath: resolveCangjieToolPathMock,
	buildCangjieToolEnv: buildCangjieToolEnvMock,
	CJC_CONFIG_KEY: "cangjieLsp.cjcPath",
}))

vi.mock("../../matlab/matlabRunner", () => ({
	buildMatlabRunConfig: buildMatlabRunConfigMock,
}))

vi.mock("../../matlab/matlabToolUtils", () => ({
	resolveMatlabRuntime: resolveMatlabRuntimeMock,
}))

vi.mock("../../latex/latexResolve", () => ({
	resolveLatexmkExecutable: resolveLatexmkExecutableMock,
	resolvePdflatexExecutable: resolvePdflatexExecutableMock,
}))

vi.mock("../../sandbox", () => ({
	SandboxExecutionService: {
		getInstance: () => ({
			evaluatePolicyOnly: evaluatePolicyOnlyMock,
			run: runSandboxMock,
			evaluateAndAuditExecution: evaluateAndAuditExecutionMock,
			trackExternalTerminalExecution: trackExternalTerminalExecutionMock,
			recordExecutionComplete: recordExecutionCompleteMock,
			getEffectiveTimeout: getEffectiveTimeoutMock,
			disposeScope: disposeScopeMock,
		}),
		generateExecutionId: generateExecutionIdMock,
	},
}))

import { runActiveEditorCode, toExecutionPath } from "../runCode"

describe("runCode", () => {
	let outputChannelMock: vscode.OutputChannel
	let terminalMock: any

	beforeEach(() => {
		vi.clearAllMocks()
		outputChannelMock = {
			append: vi.fn(),
			appendLine: vi.fn(),
		} as any
		terminalMock = (vscode.window as any).createTerminal()
		;(vscode.window.createTerminal as any).mockClear()

		evaluatePolicyOnlyMock.mockReset().mockResolvedValue("guarded-host")
		runSandboxMock.mockReset().mockResolvedValue({ exitCode: 0 })
		evaluateAndAuditExecutionMock.mockReset().mockReturnValue({
			executionId: "run-code-execution",
			backend: "guarded-host",
		})
		stopExternalTerminalTrackingMock.mockReset()
		trackExternalTerminalExecutionMock.mockReset().mockReturnValue(stopExternalTerminalTrackingMock)
		recordExecutionCompleteMock.mockReset()
		getEffectiveTimeoutMock.mockReset().mockReturnValue(120_000)
		disposeScopeMock.mockReset().mockResolvedValue(undefined)
		generateExecutionIdMock.mockReset().mockReturnValue("run-code-execution")

		resolveCangjieToolPathMock.mockImplementation((tool) => tool)
		buildCangjieToolEnvMock.mockReturnValue({})
		buildMatlabRunConfigMock.mockReturnValue(undefined)
		resolveMatlabRuntimeMock.mockReturnValue(false)
		resolveLatexmkExecutableMock.mockReturnValue("latexmk")
		resolvePdflatexExecutableMock.mockReturnValue("pdflatex")
		;(vscode.window as any).activeTextEditor = undefined
		;(vscode.workspace as any).workspaceFolders = [
			{
				uri: { fsPath: "D:\\repo" },
				name: "repo",
				index: 0,
			},
		]
	})

	function setEditor(fileName: string, languageId: string, isUntitled = false) {
		const doc = {
			fileName,
			languageId,
			isUntitled,
			uri: { fsPath: fileName },
		} as vscode.TextDocument
		;(vscode.window as any).activeTextEditor = {
			document: doc,
		}
	}

	it("shows warning if no active editor found", async () => {
		await runActiveEditorCode(outputChannelMock)
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("No active editor found"))
	})

	it("shows warning if file is untitled", async () => {
		setEditor("Untitled-1", "python", true)
		await runActiveEditorCode(outputChannelMock)
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("Please save the file"))
	})

	it("shows warning if language/file type is unsupported", async () => {
		setEditor("D:\\repo\\image.png", "plaintext")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		await runActiveEditorCode(outputChannelMock)
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining("Unsupported file type"))
	})

	it("builds Python poetry run command if pyproject.toml and poetry.lock exist", async () => {
		setEditor("D:\\repo\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("pyproject.toml")) return true
			if (p.toString().endsWith("poetry.lock")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(
			expect.stringContaining('poetry run python "D:\\repo\\src\\script.py"'),
		)
	})

	it("builds Python run command if pyproject.toml exists but poetry.lock is missing", async () => {
		setEditor("D:\\repo\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("pyproject.toml")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining('python "D:\\repo\\src\\script.py"'))
	})

	it("builds Python package command if running __main__.py in package", async () => {
		setEditor("D:\\repo\\mypackage\\__main__.py", "python")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("__main__.py")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("python -m mypackage")
	})

	it("builds JS command with npm start if package.json has start script", async () => {
		setEditor("D:\\repo\\src\\index.js", "javascript")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("package.json")) return true
			return false
		})
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ scripts: { start: "node index.js" } }))

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("npm start")
	})

	it("builds JS command with npm dev if package.json has dev script", async () => {
		setEditor("D:\\repo\\src\\index.js", "javascript")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("package.json")) return true
			return false
		})
		vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ scripts: { dev: "node index.js" } }))

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("npm run dev")
	})

	it("builds JS command fallback node script", async () => {
		setEditor("D:\\repo\\src\\index.js", "javascript")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith('node "D:\\repo\\src\\index.js"')
	})

	it("builds TS command fallback npx tsx", async () => {
		setEditor("D:\\repo\\src\\index.ts", "typescript")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith('npx tsx "D:\\repo\\src\\index.ts"')
	})

	it("builds C CMake build and run commands if CMakeLists.txt is found", async () => {
		setEditor("D:\\repo\\src\\main.c", "c")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("CMakeLists.txt")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining("cmake --build"))
	})

	it("builds C Makefile build command if Makefile is found", async () => {
		setEditor("D:\\repo\\src\\main.c", "c")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("Makefile")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("make && make run")
	})

	it("builds C compile multi-file command if multiple .c files exist in folder", async () => {
		setEditor("D:\\repo\\src\\main.c", "c")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["main.c", "utils.c"] as any)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining('gcc "main.c" "utils.c"'))
	})

	it("builds C compile single-file command if single .c file exists in folder", async () => {
		setEditor("D:\\repo\\src\\main.c", "c")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["main.c"] as any)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining('gcc "main.c"'))
	})

	it("builds CPP CMake command if CMakeLists.txt exists", async () => {
		setEditor("D:\\repo\\src\\main.cpp", "cpp")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("CMakeLists.txt")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining("cmake --build"))
	})

	it("builds CPP Makefile command if Makefile exists", async () => {
		setEditor("D:\\repo\\src\\main.cpp", "cpp")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("Makefile")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("make && make run")
	})

	it("builds CPP compile multi-file command", async () => {
		setEditor("D:\\repo\\src\\main.cpp", "cpp")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["main.cpp", "helper.cpp"] as any)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining('g++ "main.cpp" "helper.cpp"'))
	})

	it("builds Java Maven build command if pom.xml exists", async () => {
		setEditor("D:\\repo\\src\\Main.java", "java")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("pom.xml")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(
			expect.stringMatching(/mvn(\.cmd)? compile && mvn(\.cmd)? exec:java/),
		)
	})

	it("builds Java Gradle run command if build.gradle exists", async () => {
		setEditor("D:\\repo\\src\\Main.java", "java")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("build.gradle")) return true
			if (p.toString().endsWith("gradlew") || p.toString().endsWith("gradlew.bat")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		// On Windows uses gradlew.bat, on Linux uses ./gradlew, without wrapper uses gradle
		expect(terminalMock.sendText).toHaveBeenCalledWith(
			expect.stringMatching(/(?:gradlew\.bat|\.\/gradlew|gradle) run/),
		)
	})

	it("builds Java multi-file compile command", async () => {
		setEditor("D:\\repo\\src\\Main.java", "java")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["Main.java", "Helper.java"] as any)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(
			expect.stringContaining('javac "Main.java" "Helper.java" && java "Main"'),
		)
	})

	it("builds Go run pkg command if go.mod exists", async () => {
		setEditor("D:\\repo\\src\\main.go", "go")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString() === "D:\\repo\\go.mod") return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("go run ./src")
	})

	it("builds Go run pkg folder command if multiple .go files in folder", async () => {
		setEditor("D:\\repo\\src\\main.go", "go")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["main.go", "helper.go"] as any)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("go run .")
	})

	it("builds Rust Cargo run command if Cargo.toml exists", async () => {
		setEditor("D:\\repo\\src\\main.rs", "rust")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("Cargo.toml")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("cargo run")
	})

	it("builds Rust rustc compile and execution if no Cargo.toml", async () => {
		setEditor("D:\\repo\\src\\main.rs", "rust")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining('rustc "D:\\repo\\src\\main.rs"'))
	})

	it("builds Cangjie cjpm run command if cjpm.toml exists", async () => {
		setEditor("D:\\repo\\src\\main.cj", "cangjie")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("cjpm.toml")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringMatching(/cjpm"?\s+run/))
	})

	it("builds Cangjie compilation with multiple cj files", async () => {
		setEditor("D:\\repo\\src\\main.cj", "cangjie")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["main.cj", "helper.cj"] as any)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining('"cjc" "main.cj" "helper.cj"'))
	})

	it("builds Kotlin gradle command if build.gradle exists", async () => {
		setEditor("D:\\repo\\src\\main.kt", "kotlin")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("build.gradle")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("gradle run")
	})

	it("builds Kotlin kotlinc compile with multiple files", async () => {
		setEditor("D:\\repo\\src\\main.kt", "kotlin")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["main.kt", "helper.kt"] as any)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining('kotlinc "main.kt" "helper.kt"'))
	})

	it("builds Kotlin kotlinc compile with single file", async () => {
		setEditor("D:\\repo\\src\\main.kt", "kotlin")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["main.kt"] as any)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining('kotlinc "main.kt"'))
	})

	it("builds Dart command", async () => {
		setEditor("D:\\repo\\src\\main.dart", "dart")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith('dart run "D:\\repo\\src\\main.dart"')
	})

	it("builds Swift spm run command if Package.swift exists", async () => {
		setEditor("D:\\repo\\src\\main.swift", "swift")
		vi.mocked(fs.existsSync).mockImplementation((p) => {
			if (p.toString().endsWith("Package.swift")) return true
			return false
		})

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("swift run")
	})

	it("builds Swift compile command with multiple swift files", async () => {
		setEditor("D:\\repo\\src\\main.swift", "swift")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["main.swift", "helper.swift"] as any)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(
			expect.stringContaining('swiftc "main.swift" "helper.swift"'),
		)
	})

	it("builds Swift fallback run script", async () => {
		setEditor("D:\\repo\\src\\main.swift", "swift")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["main.swift"] as any)

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith('swift "D:\\repo\\src\\main.swift"')
	})

	it("builds MATLAB warning for mlx files", async () => {
		setEditor("D:\\repo\\src\\main.mlx", "matlab")
		await runActiveEditorCode(outputChannelMock)
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			expect.stringContaining("errors.run_code.matlab_live_script_unsupported"),
		)
	})

	it("builds MATLAB run config from buildMatlabRunConfig", async () => {
		setEditor("D:\\repo\\src\\main.m", "matlab")
		buildMatlabRunConfigMock.mockReturnValueOnce({ command: "matlab -r main" })

		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith("matlab -r main")
	})

	it("shows warning if buildMatlabRunConfig fails and MATLAB runtime resolved is false", async () => {
		setEditor("D:\\repo\\src\\main.m", "matlab")
		buildMatlabRunConfigMock.mockReturnValueOnce(undefined)
		resolveMatlabRuntimeMock.mockReturnValueOnce(false)

		await runActiveEditorCode(outputChannelMock)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("errors.run_code.matlab_not_detected"),
		)
	})

	it("shows warning if buildMatlabRunConfig fails and MATLAB runtime is resolved", async () => {
		setEditor("D:\\repo\\src\\main.m", "matlab")
		buildMatlabRunConfigMock.mockReturnValueOnce(undefined)
		resolveMatlabRuntimeMock.mockReturnValueOnce(true)

		await runActiveEditorCode(outputChannelMock)
		expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
			expect.stringContaining("Failed to generate run command"),
		)
	})

	it("rejects file paths with shell injection characters", async () => {
		// Test that malicious filenames are rejected before execution
		const maliciousPaths = [
			'D:\\repo\\src\\script"; rm -rf /; "#.py',
			"D:\\repo\\src\\script&&whoami#.js",
			"D:\\repo\\src\\script`whoami`.ts",
			"D:\\repo\\src\\script$(whoami).rb",
		]

		for (const maliciousPath of maliciousPaths) {
			vi.clearAllMocks()
			setEditor(maliciousPath, "python")
			vi.mocked(fs.existsSync).mockReturnValue(false)

			await runActiveEditorCode(outputChannelMock)
			// Should show error message instead of executing
			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("shell metacharacters"))
			// Terminal should NOT be created/used for malicious paths
			expect(terminalMock.sendText).not.toHaveBeenCalled()
		}
	})

	it("rejects file paths with double quotes to prevent injection", async () => {
		const quotedPath = 'D:\\repo\\src\\script"with"quotes.py'
		setEditor(quotedPath, "python")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)
		// Double quotes are now treated as shell metacharacters and rejected outright,
		// rather than escaped. This is a defense-in-depth measure.
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("shell metacharacters"))
		// Terminal should NOT be created/used for paths with double quotes
		expect(terminalMock.sendText).not.toHaveBeenCalled()
	})

	it("builds LaTeX command using latexmk", async () => {
		setEditor("D:\\repo\\src\\main.tex", "latex")
		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining("latexmk -pdf"))
	})

	it("builds LaTeX command using pdflatex", async () => {
		setEditor("D:\\repo\\src\\main.tex", "latex")
		;(vscode.workspace.getConfiguration() as any).get.mockImplementation((key: string) => {
			if (key === "latex.engine") return "pdflatex"
			if (key === "latex.extraArgs") return ["-shell-escape"]
			return undefined
		})
		await runActiveEditorCode(outputChannelMock)
		expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining("pdflatex -interaction=nonstopmode"))
	})

	it("builds simple shell/script command mappings", async () => {
		const mapping = [
			{ file: "main.rb", lang: "ruby", expected: 'ruby "D:\\repo\\src\\main.rb"' },
			{ file: "main.php", lang: "php", expected: 'php "D:\\repo\\src\\main.php"' },
			{ file: "main.sh", lang: "shellscript", expected: 'bash "D:\\repo\\src\\main.sh"' },
			{
				file: "main.ps1",
				lang: "powershell",
				expected: 'powershell -ExecutionPolicy Bypass -File "D:\\repo\\src\\main.ps1"',
			},
			{ file: "main.lua", lang: "lua", expected: 'lua "D:\\repo\\src\\main.lua"' },
			{ file: "main.pl", lang: "perl", expected: 'perl "D:\\repo\\src\\main.pl"' },
			{ file: "main.r", lang: "r", expected: 'Rscript "D:\\repo\\src\\main.r"' },
		]

		for (const item of mapping) {
			vi.clearAllMocks()
			setEditor(`D:\\repo\\src\\${item.file}`, item.lang)
			await runActiveEditorCode(outputChannelMock)
			expect(terminalMock.sendText).toHaveBeenCalledWith(expect.stringContaining(item.expected))
		}
	})

	it("maps Windows and POSIX workspace paths to Docker paths", () => {
		expect(toExecutionPath("D:\\repo\\src\\main.py", "D:\\repo", "docker-linux")).toBe("/workspace/src/main.py")
		expect(toExecutionPath("/home/user/repo/src/main.py", "/home/user/repo", "docker-linux")).toBe(
			"/workspace/src/main.py",
		)
		expect(toExecutionPath("D:\\repo\\src\\main.py", "D:\\repo", "host-windows")).toBe("D:\\repo\\src\\main.py")
	})

	it("rejects Docker paths outside the active workspace", () => {
		expect(() => toExecutionPath("D:\\other\\main.py", "D:\\repo", "docker-linux")).toThrow(
			"outside the active workspace",
		)
	})

	it("rejects a Docker project root found above the active workspace", async () => {
		;(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: "D:\\repo\\nested" }, name: "nested", index: 0 },
		]
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		setEditor("D:\\repo\\nested\\src\\Main.java", "java")
		vi.mocked(fs.existsSync).mockImplementation((value) => value.toString() === "D:\\repo\\pom.xml")

		await runActiveEditorCode(outputChannelMock)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("outside the active workspace"),
		)
		expect(runSandboxMock).not.toHaveBeenCalled()
	})

	it("uses the active editor workspace in a multi-root workspace", async () => {
		;(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: "D:\\one" }, name: "one", index: 0 },
			{ uri: { fsPath: "D:\\two" }, name: "two", index: 1 },
		]
		setEditor("D:\\two\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)

		expect(evaluateAndAuditExecutionMock).toHaveBeenCalledWith(
			expect.objectContaining({ workspacePath: "D:\\two", cwd: "D:\\two" }),
		)
		expect(vscode.window.createTerminal).toHaveBeenCalledWith(expect.objectContaining({ cwd: "D:\\two" }))
		expect(disposeScopeMock).not.toHaveBeenCalled()
	})

	it("builds Docker commands with container paths only", async () => {
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		setEditor("D:\\repo\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)

		const request = runSandboxMock.mock.calls[0][0]
		expect(request.command).toBe('python "/workspace/src/script.py"')
		expect(request.command).not.toContain("D:\\repo")
		expect(request.resourceScopeId).toBe("user:run-code:run-code-execution")
		expect(evaluatePolicyOnlyMock).toHaveBeenCalledWith(
			"user",
			expect.objectContaining({ resourceScopeId: request.resourceScopeId }),
		)
		expect(disposeScopeMock).toHaveBeenCalledOnce()
		expect(disposeScopeMock).toHaveBeenCalledWith(request.resourceScopeId)
		expect(runSandboxMock.mock.invocationCallOrder[0]).toBeLessThan(disposeScopeMock.mock.invocationCallOrder[0])
		expect(terminalMock.sendText).not.toHaveBeenCalled()
	})

	it("isolates and disposes concurrent Docker Run Code invocations", async () => {
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		generateExecutionIdMock.mockReturnValueOnce("run-code-one").mockReturnValueOnce("run-code-two")
		setEditor("D:\\repo\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await Promise.all([runActiveEditorCode(outputChannelMock), runActiveEditorCode(outputChannelMock)])

		const scopes = runSandboxMock.mock.calls.map(([request]) => request.resourceScopeId)
		expect(scopes).toEqual(["user:run-code:run-code-one", "user:run-code:run-code-two"])
		expect(new Set(scopes).size).toBe(2)
		expect(disposeScopeMock.mock.calls.map(([scope]) => scope)).toEqual(expect.arrayContaining(scopes))
		expect(disposeScopeMock).toHaveBeenCalledTimes(2)
		expect(Math.max(...runSandboxMock.mock.invocationCallOrder)).toBeLessThan(
			Math.min(...disposeScopeMock.mock.invocationCallOrder),
		)
	})

	it("uses container Cangjie tools without probing the host SDK", async () => {
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		setEditor("D:\\repo\\src\\main.cj", "cangjie")
		vi.mocked(fs.existsSync).mockImplementation((p) => p.toString() === "D:\\repo\\cjpm.toml")

		await runActiveEditorCode(outputChannelMock)

		const request = runSandboxMock.mock.calls[0][0]
		expect(request.command).toBe("/usr/local/bin/cjpm run")
		expect(request.environment).toBeUndefined()
		expect(resolveCangjieToolPathMock).not.toHaveBeenCalled()
		expect(buildCangjieToolEnvMock).not.toHaveBeenCalled()
	})

	it("uses the container compiler for standalone Cangjie files", async () => {
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		setEditor("D:\\repo\\src\\main.cj", "cangjie")
		vi.mocked(fs.existsSync).mockReturnValue(false)
		vi.mocked(fs.readdirSync).mockReturnValue(["main.cj"] as any)

		await runActiveEditorCode(outputChannelMock)

		const request = runSandboxMock.mock.calls[0][0]
		expect(request.command).toContain('"/usr/local/bin/cjc" "main.cj"')
		expect(request.command).not.toContain("D:\\repo")
		expect(request.environment).toBeUndefined()
		expect(resolveCangjieToolPathMock).not.toHaveBeenCalled()
		expect(buildCangjieToolEnvMock).not.toHaveBeenCalled()
	})

	it("rejects PowerShell explicitly in Docker", async () => {
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		setEditor("D:\\repo\\script.ps1", "powershell")

		await runActiveEditorCode(outputChannelMock)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("not supported"))
		expect(runSandboxMock).not.toHaveBeenCalled()
		expect(terminalMock.sendText).not.toHaveBeenCalled()
	})

	it("shows policy errors without creating a terminal", async () => {
		evaluatePolicyOnlyMock.mockRejectedValue(new Error("Docker is unavailable"))
		setEditor("D:\\repo\\src\\main.cj", "cangjie")

		await runActiveEditorCode(outputChannelMock)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Docker is unavailable"))
		expect(resolveCangjieToolPathMock).not.toHaveBeenCalled()
		expect(vscode.window.createTerminal).not.toHaveBeenCalled()
		expect(runSandboxMock).not.toHaveBeenCalled()
		expect(disposeScopeMock).not.toHaveBeenCalled()
	})

	it("disposes the Docker scope when execution fails", async () => {
		const executionError = new Error("Image is missing")
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		runSandboxMock.mockRejectedValue(executionError)
		setEditor("D:\\repo\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)

		expect(disposeScopeMock).toHaveBeenCalledWith("user:run-code:run-code-execution")
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(executionError.message))
		expect(vscode.window.createTerminal).not.toHaveBeenCalled()
	})

	it("reports Docker scope cleanup failures", async () => {
		const cleanupError = new Error("Run Code cleanup failed")
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		disposeScopeMock.mockRejectedValue(cleanupError)
		setEditor("D:\\repo\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(cleanupError.message))
	})

	it("aggregates Docker execution and scope cleanup failures", async () => {
		const executionError = new Error("Run Code execution failed")
		const cleanupError = new Error("Run Code cleanup failed")
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		runSandboxMock.mockRejectedValue(executionError)
		disposeScopeMock.mockRejectedValue(cleanupError)
		setEditor("D:\\repo\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(executionError.message))
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(cleanupError.message))
	})

	it("does not create a terminal when external execution audit fails", async () => {
		evaluateAndAuditExecutionMock.mockRejectedValue(new Error("Policy denied"))
		setEditor("D:\\repo\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Policy denied"))
		expect(vscode.window.createTerminal).not.toHaveBeenCalled()
		expect(terminalMock.sendText).not.toHaveBeenCalled()
	})

	it("records one failed audit when the host terminal cannot be created", async () => {
		const terminalError = new Error("terminal creation failed")
		;(vscode.window.createTerminal as any).mockImplementationOnce(() => {
			throw terminalError
		})
		setEditor("D:\\repo\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)

		expect(recordExecutionCompleteMock).toHaveBeenCalledTimes(1)
		expect(recordExecutionCompleteMock).toHaveBeenCalledWith(
			"run-code-execution",
			expect.objectContaining({
				executionId: "run-code-execution",
				backend: "guarded-host",
				cancelled: false,
				timedOut: false,
			}),
			terminalError,
		)
		expect(trackExternalTerminalExecutionMock).not.toHaveBeenCalled()
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(terminalError.message))
	})

	it("stops tracking and records one failed audit when host terminal dispatch fails", async () => {
		const dispatchError = new Error("terminal dispatch failed")
		terminalMock.sendText.mockImplementationOnce(() => {
			throw dispatchError
		})
		setEditor("D:\\repo\\src\\script.py", "python")
		vi.mocked(fs.existsSync).mockReturnValue(false)

		await runActiveEditorCode(outputChannelMock)

		expect(stopExternalTerminalTrackingMock).toHaveBeenCalledOnce()
		expect(recordExecutionCompleteMock).toHaveBeenCalledTimes(1)
		expect(recordExecutionCompleteMock).toHaveBeenCalledWith(
			"run-code-execution",
			expect.objectContaining({ backend: "guarded-host" }),
			dispatchError,
		)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(dispatchError.message))
	})
})
