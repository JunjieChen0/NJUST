import { describe, it, expect, vi, beforeEach } from "vitest"

const {
	mockExistsSync,
	mockRegisterCommand,
	mockShowErrorMessage,
	mockShowInformationMessage,
	mockShowWarningMessage,
	mockShowQuickPick,
	mockShowInputBox,
	mockShowTextDocument,
	mockCreateTerminal,
	mockCreateOutputChannel,
	mockGetWorkspaceFolder,
	mockOpenTextDocument,
	mockOnDidSaveTextDocument,
	mockCreateTextEditorDecorationType,
	mockExecuteCommand,
	mockResolveCangjieToolPath,
	mockBuildCangjieToolEnv,
	mockFormatCangjieToolchainReport,
	mockProbeCangjieToolchain,
	mockWriteFileSync,
	mockMkdirSync,
	mockReadCangjieEvalTraceSummary,
	mockFormatCangjieEvalTraceSummaryMarkdown,
	mockGetCangjieGlobalEvalTracePath,
	mockGetCangjieWorkspaceEvalTracePath,
	mockParseCjpmToml,
	mockBuildCompactProjectOverviewSection,
	mockBuildProjectPackageValidationSection,
} = vi.hoisted(() => ({
	mockExistsSync: vi.fn(),
	mockRegisterCommand: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	mockShowErrorMessage: vi.fn(),
	mockShowInformationMessage: vi.fn(),
	mockShowWarningMessage: vi.fn(),
	mockShowQuickPick: vi.fn(),
	mockShowInputBox: vi.fn(),
	mockShowTextDocument: vi.fn(),
	mockCreateTerminal: vi.fn(),
	mockCreateOutputChannel: vi.fn(),
	mockGetWorkspaceFolder: vi.fn(),
	mockOpenTextDocument: vi.fn(),
	mockOnDidSaveTextDocument: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	mockCreateTextEditorDecorationType: vi.fn().mockReturnValue({ dispose: vi.fn() }),
	mockExecuteCommand: vi.fn(),
	mockResolveCangjieToolPath: vi.fn(),
	mockBuildCangjieToolEnv: vi.fn().mockReturnValue({}),
	mockFormatCangjieToolchainReport: vi.fn().mockReturnValue("report"),
	mockProbeCangjieToolchain: vi.fn().mockResolvedValue([]),
	mockWriteFileSync: vi.fn(),
	mockMkdirSync: vi.fn(),
	mockReadCangjieEvalTraceSummary: vi.fn(),
	mockFormatCangjieEvalTraceSummaryMarkdown: vi.fn().mockReturnValue("trace summary"),
	mockGetCangjieGlobalEvalTracePath: vi.fn().mockResolvedValue("/global/cangjie-eval-trace.jsonl"),
	mockGetCangjieWorkspaceEvalTracePath: vi.fn((cwd: string) => `${cwd}/.njust-ai/cangjie-eval-trace.jsonl`),
	mockParseCjpmToml: vi.fn(),
	mockBuildCompactProjectOverviewSection: vi.fn(),
	mockBuildProjectPackageValidationSection: vi.fn(),
}))

vi.mock("vscode", () => ({
	window: {
		createOutputChannel: mockCreateOutputChannel,
		showQuickPick: mockShowQuickPick,
		showInputBox: mockShowInputBox,
		showInformationMessage: mockShowInformationMessage,
		showWarningMessage: mockShowWarningMessage,
		showErrorMessage: mockShowErrorMessage,
		showOpenDialog: vi.fn(),
		showTextDocument: mockShowTextDocument,
		activeTextEditor: undefined,
		createTextEditorDecorationType: mockCreateTextEditorDecorationType,
		createTerminal: mockCreateTerminal,
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/ws" } }],
		openTextDocument: mockOpenTextDocument,
		onDidSaveTextDocument: mockOnDidSaveTextDocument,
		getConfiguration: vi.fn().mockReturnValue({ get: vi.fn() }),
		getWorkspaceFolder: mockGetWorkspaceFolder,
	},
	commands: {
		registerCommand: mockRegisterCommand,
		executeCommand: mockExecuteCommand,
	},
	languages: {
		registerCodeActionsProvider: vi.fn(),
	},
	Uri: {
		file: (p: string) => ({ fsPath: p, toString: () => p }),
		parse: (s: string) => ({ fsPath: s, toString: () => s }),
	},
	Range: class {
		constructor(
			public start: unknown,
			public end: unknown,
		) {}
	},
	Position: class {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
	Selection: class {
		constructor(
			public anchor: unknown,
			public active: unknown,
		) {}
	},
	WorkspaceEdit: class {
		set() {}
		replace() {}
		insert() {}
		delete() {}
	},
	Location: class {
		constructor(
			public uri: unknown,
			public range: unknown,
		) {}
	},
	CodeAction: class {
		constructor(
			public title: string,
			public kind: unknown,
		) {}
	},
	CodeActionKind: {
		RefactorExtract: { value: "refactor.extract" },
		Refactor: { value: "refactor" },
	},
	OverviewRulerLane: { Right: 4 },
	SnippetString: class {
		constructor(public value: string) {}
	},
	StatusBarAlignment: { Left: 1, Right: 2 },
	ThemeColor: class {
		constructor(public id: string) {}
	},
	TaskGroup: { Build: "build", Test: "test", Clean: "clean" },
	TaskRevealKind: { Always: 2 },
	TaskPanelKind: { Shared: 2 },
	ShellExecution: class {
		constructor(
			public command: string,
			public args: string[],
			public options: unknown,
		) {}
	},
}))

vi.mock("fs", async () => {
	const actual = await vi.importActual<typeof import("fs")>("fs")
	return {
		...actual,
		default: { ...actual, existsSync: mockExistsSync, writeFileSync: mockWriteFileSync, mkdirSync: mockMkdirSync },
		existsSync: mockExistsSync,
		writeFileSync: mockWriteFileSync,
		mkdirSync: mockMkdirSync,
	}
})

vi.mock("../cangjieToolUtils", () => ({
	resolveCangjieToolPath: mockResolveCangjieToolPath,
	buildCangjieToolEnv: mockBuildCangjieToolEnv,
	formatCangjieToolchainReport: mockFormatCangjieToolchainReport,
	probeCangjieToolchain: mockProbeCangjieToolchain,
	CJC_CONFIG_KEY: "cangjieTools.cjcPath",
}))

vi.mock("../cangjieSourceLayout", () => ({
	inferCangjiePackageFromSrcLayout: vi.fn().mockReturnValue(undefined),
}))

vi.mock("../cangjieGeneratedTestCleanup", () => ({
	registerGeneratedCangjieTestFile: vi.fn(),
	purgeAllTrackedCangjieTestFiles: vi.fn().mockReturnValue({ filesRemoved: 0, taskEntriesRemoved: 0 }),
}))

vi.mock("../../../core/prompts/sections/learnedFixesStorage", () => ({
	LEARNED_FIXES_FILE: "learned-fixes.json",
	ensureLearnedFixesFile: vi.fn(),
	getLearnedFixesJsonPath: vi.fn().mockReturnValue("/mock/learned-fixes.json"),
	loadLearnedFixes: vi.fn().mockReturnValue({ patterns: [] }),
	saveLearnedFixes: vi.fn(),
}))

vi.mock("../../../core/prompts/sections/cangjie-context", () => ({
	invalidateCangjieContextSectionCache: vi.fn(),
	parseCjpmToml: mockParseCjpmToml,
	buildCompactProjectOverviewSection: mockBuildCompactProjectOverviewSection,
	buildProjectPackageValidationSection: mockBuildProjectPackageValidationSection,
}))

vi.mock("../../../i18n", () => ({
	t: (key: string) => key,
}))

vi.mock("../../../shared/package", () => ({
	Package: { resolve: vi.fn().mockReturnValue(null), name: "njust-ai" },
}))

vi.mock("@njust-ai/types", () => ({
	NJUST_AI_CONFIG_DIR: ".njust_ai",
	TelemetryEventName: { CANGJIE_LSP_ERROR: "cangjie_lsp_error" },
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: { reportError: vi.fn() },
}))

vi.mock("../../../shared/logger", () => ({
	logger: { warn: vi.fn(), info: vi.fn() },
}))

vi.mock("../../../shared/error-utils", () => ({
	getErrorMessage: (e: unknown) => String(e),
}))

vi.mock("../../CangjieEvalTraceLogger", () => ({
	readCangjieEvalTraceSummary: mockReadCangjieEvalTraceSummary,
	formatCangjieEvalTraceSummaryMarkdown: mockFormatCangjieEvalTraceSummaryMarkdown,
	getCangjieGlobalEvalTracePath: mockGetCangjieGlobalEvalTracePath,
	getCangjieWorkspaceEvalTracePath: mockGetCangjieWorkspaceEvalTracePath,
}))

vi.mock("child_process", () => ({
	execFile: vi.fn(),
}))

import { registerCangjieCommands } from "../cangjieCommands"

describe("cangjieCommands", () => {
	let mockContext: any
	let mockLspClient: any

	beforeEach(() => {
		vi.clearAllMocks()

		const subscriptions: any[] = []
		mockContext = {
			subscriptions,
			globalStorageUri: { fsPath: "/global-storage" },
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
		}
		mockLspClient = {
			restart: vi.fn(),
		}
		mockCreateOutputChannel.mockReturnValue({
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
			show: vi.fn(),
		})
		mockReadCangjieEvalTraceSummary.mockResolvedValue({
			totalEntries: 1,
			validEntries: 1,
			corruptEntries: 0,
			verdictCounts: { passed: 1, blocked: 0, failed: 0, inconclusive: 0, unknown: 0 },
			latestVerdict: "passed",
			latestVerdictStreak: 1,
			recentBlockReasonCodes: [],
			latestInjectedContextLabels: [],
		})
		mockParseCjpmToml.mockResolvedValue({
			name: "web",
			version: "1.0.0",
			outputType: "dynamic",
			isWorkspace: false,
			srcDir: "src",
		})
		mockBuildCompactProjectOverviewSection.mockResolvedValue(
			"## 当前项目概览（紧凑）\n项目: web (dynamic) v1.0.0\n目录: src/",
		)
		mockBuildProjectPackageValidationSection.mockResolvedValue("Package declaration validation: OK")
		mockCreateTerminal.mockReturnValue({
			show: vi.fn(),
			sendText: vi.fn(),
		})
	})

	it("registerCangjieCommands is a function", () => {
		expect(typeof registerCangjieCommands).toBe("function")
	})

	it("registers the Cangjie project initialization wizard", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieInitializeProject")
	})

	it("initializes a new Cangjie project with validated wizard inputs", async () => {
		mockExistsSync.mockReturnValue(false)
		mockShowInputBox.mockResolvedValue("demo_app")
		mockShowQuickPick.mockResolvedValue({ label: "executable", projectType: "executable" })
		mockShowWarningMessage.mockResolvedValue("Initialize")
		mockResolveCangjieToolPath.mockReturnValue("C:\\sdk\\cjpm.exe")
		registerCangjieCommands(mockContext, mockLspClient)
		const command = mockRegisterCommand.mock.calls.find((c: any) => c[0] === "njust-ai.cangjieInitializeProject")

		await command[1]()
		const terminal = mockCreateTerminal.mock.results.at(-1)?.value

		expect(mockShowInputBox).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Cangjie package name" }))
		expect(mockShowQuickPick).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ projectType: "executable" }),
				expect.objectContaining({ projectType: "static" }),
				expect.objectContaining({ projectType: "dynamic" }),
			]),
			expect.any(Object),
		)
		expect(mockCreateTerminal).toHaveBeenLastCalledWith(expect.objectContaining({ name: "cjpm init", cwd: "/ws" }))
		expect(terminal.sendText).toHaveBeenCalledWith(
			expect.stringContaining('init --name "demo_app" --type=executable'),
		)
	})

	it("cancels project initialization before resolving the toolchain", async () => {
		mockExistsSync.mockReturnValue(false)
		mockShowInputBox.mockResolvedValue("demo_app")
		mockShowQuickPick.mockResolvedValue({ label: "dynamic", projectType: "dynamic" })
		mockShowWarningMessage.mockResolvedValue("Cancel")
		registerCangjieCommands(mockContext, mockLspClient)
		const command = mockRegisterCommand.mock.calls.find((c: any) => c[0] === "njust-ai.cangjieInitializeProject")

		await command[1]()

		expect(mockShowWarningMessage).toHaveBeenCalledWith(
			'Initialize Cangjie project "demo_app" as dynamic in /ws?',
			"Initialize",
			"Cancel",
		)
		expect(mockResolveCangjieToolPath).not.toHaveBeenCalled()
		expect(mockCreateTerminal).not.toHaveBeenCalled()
	})

	it("opens the cjpm path setting when initialization cannot find the toolchain", async () => {
		mockExistsSync.mockReturnValue(false)
		mockShowInputBox.mockResolvedValue("demo_app")
		mockShowQuickPick.mockResolvedValue({ label: "static", projectType: "static" })
		mockShowWarningMessage.mockResolvedValue("Initialize")
		mockResolveCangjieToolPath.mockReturnValue(undefined)
		mockShowErrorMessage.mockResolvedValue("buttons.cangjie_lsp.open_settings")
		registerCangjieCommands(mockContext, mockLspClient)
		const command = mockRegisterCommand.mock.calls.find((c: any) => c[0] === "njust-ai.cangjieInitializeProject")

		await command[1]()
		await Promise.resolve()

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"errors.cangjie_lsp.cjpm_not_found",
			"buttons.cangjie_lsp.open_settings",
		)
		expect(mockExecuteCommand).toHaveBeenCalledWith(
			"workbench.action.openSettings",
			"njust-ai.cangjieTools.cjpmPath",
		)
		expect(mockCreateTerminal).not.toHaveBeenCalled()
	})

	it("does not initialize an existing Cangjie project", async () => {
		mockExistsSync.mockReturnValue(true)
		registerCangjieCommands(mockContext, mockLspClient)
		const command = mockRegisterCommand.mock.calls.find((c: any) => c[0] === "njust-ai.cangjieInitializeProject")

		await command[1]()

		expect(mockShowInformationMessage).toHaveBeenCalledWith(
			"This workspace already contains cjpm.toml; initialization was skipped.",
		)
		expect(mockShowInputBox).not.toHaveBeenCalled()
		expect(mockCreateTerminal).not.toHaveBeenCalled()
	})

	it("rejects an invalid Cangjie package name before opening a terminal", async () => {
		mockExistsSync.mockReturnValue(false)
		mockShowInputBox.mockResolvedValue("bad-name")
		registerCangjieCommands(mockContext, mockLspClient)
		const command = mockRegisterCommand.mock.calls.find((c: any) => c[0] === "njust-ai.cangjieInitializeProject")

		await command[1]()

		expect(mockShowErrorMessage).toHaveBeenCalledWith("Invalid Cangjie package name.")
		expect(mockShowQuickPick).not.toHaveBeenCalled()
		expect(mockCreateTerminal).not.toHaveBeenCalled()
	})

	it("registers CJPM commands (build, run, test, check, clean)", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieBuild")
		expect(registeredIds).toContain("njust-ai.cangjieRun")
		expect(registeredIds).toContain("njust-ai.cangjieTest")
		expect(registeredIds).toContain("njust-ai.cangjieCheck")
		expect(registeredIds).toContain("njust-ai.cangjieClean")
	})

	it("registers verify SDK command", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieVerifySdk")
	})

	it("registers eval trace summary command", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieViewEvalTrace")
	})

	it("registers project structure summary command", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieViewProjectStructure")
	})

	it("shows the parsed Cangjie project structure", async () => {
		registerCangjieCommands(mockContext, mockLspClient)
		const command = mockRegisterCommand.mock.calls.find((c: any) => c[0] === "njust-ai.cangjieViewProjectStructure")

		await command[1]()
		const channel = mockCreateOutputChannel.mock.results.at(-1)?.value

		expect(mockParseCjpmToml).toHaveBeenCalledWith("/ws")
		expect(mockBuildCompactProjectOverviewSection).toHaveBeenCalledWith(
			"/ws",
			expect.objectContaining({ name: "web", srcDir: "src" }),
			null,
			null,
		)
		expect(mockCreateOutputChannel).toHaveBeenLastCalledWith("Cangjie Project Structure")
		expect(mockBuildProjectPackageValidationSection).toHaveBeenCalledWith(
			"/ws",
			expect.objectContaining({ name: "web", srcDir: "src" }),
		)
		expect(channel.appendLine).toHaveBeenCalledWith("Cangjie project structure:")
		expect(channel.appendLine).toHaveBeenCalledWith("Root: /ws")
		expect(channel.appendLine).toHaveBeenCalledWith(expect.stringContaining("项目: web"))
		expect(channel.appendLine).toHaveBeenCalledWith("Package declaration validation: OK")
		expect(channel.show).toHaveBeenCalledWith(true)
	})

	it("reports an invalid Cangjie project structure", async () => {
		mockParseCjpmToml.mockResolvedValue(null)
		registerCangjieCommands(mockContext, mockLspClient)
		const command = mockRegisterCommand.mock.calls.find((c: any) => c[0] === "njust-ai.cangjieViewProjectStructure")

		await command[1]()

		expect(mockShowErrorMessage).toHaveBeenCalledWith("No valid cjpm.toml found in the current workspace.")
		expect(mockBuildCompactProjectOverviewSection).not.toHaveBeenCalled()
		expect(mockBuildProjectPackageValidationSection).not.toHaveBeenCalled()
	})

	it("shows the workspace eval trace summary", async () => {
		registerCangjieCommands(mockContext, mockLspClient)
		const command = mockRegisterCommand.mock.calls.find((c: any) => c[0] === "njust-ai.cangjieViewEvalTrace")

		await command[1]()
		const channel = mockCreateOutputChannel.mock.results.at(-1)?.value

		expect(mockCreateOutputChannel).toHaveBeenLastCalledWith("Cangjie Eval Trace")
		expect(mockGetCangjieWorkspaceEvalTracePath).toHaveBeenCalledWith("/ws")
		expect(mockGetCangjieGlobalEvalTracePath).toHaveBeenCalledWith("/global-storage")
		expect(mockReadCangjieEvalTraceSummary).toHaveBeenNthCalledWith(
			1,
			expect.stringMatching(/[\\/]\.njust-ai[\\/]cangjie-eval-trace\.jsonl$/),
		)
		expect(mockReadCangjieEvalTraceSummary).toHaveBeenNthCalledWith(2, "/global/cangjie-eval-trace.jsonl")
		expect(mockFormatCangjieEvalTraceSummaryMarkdown).toHaveBeenCalledTimes(2)
		expect(channel.appendLine).toHaveBeenCalledWith("Workspace eval summary:")
		expect(channel.appendLine).toHaveBeenCalledWith("Global roadmap eval summary:")
		expect(channel.show).toHaveBeenCalledWith(true)
	})

	it("reports when the workspace eval trace is empty", async () => {
		mockReadCangjieEvalTraceSummary.mockResolvedValue({
			totalEntries: 0,
			validEntries: 0,
			corruptEntries: 0,
			verdictCounts: { passed: 0, blocked: 0, failed: 0, inconclusive: 0, unknown: 0 },
			latestVerdictStreak: 0,
			recentBlockReasonCodes: [],
			latestInjectedContextLabels: [],
		})
		registerCangjieCommands(mockContext, mockLspClient)
		const command = mockRegisterCommand.mock.calls.find((c: any) => c[0] === "njust-ai.cangjieViewEvalTrace")

		await command[1]()

		expect(mockShowInformationMessage).toHaveBeenCalledWith(
			"No Cangjie eval trace entries found in this workspace.",
		)
	})

	it("registers generate test file command", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieGenerateTestFile")
	})

	it("registers clean generated tests command", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieCleanGeneratedTests")
	})

	it("registers restart LSP command", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieRestartLsp")
	})

	it("registers profile command", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieProfile")
	})

	it("registers template command", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieInsertTemplate")
	})

	it("registers learned fixes commands", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieViewLearnedFixes")
		expect(registeredIds).toContain("njust-ai.cangjieManageLearnedFixes")
	})

	it("registers refactoring commands when symbolIndex provided", () => {
		const mockSymbolIndex = {}
		registerCangjieCommands(mockContext, mockLspClient, mockSymbolIndex)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).toContain("njust-ai.cangjieExtractFunction")
		expect(registeredIds).toContain("njust-ai.cangjieMoveFile")
	})

	it("does not register refactoring commands when no symbolIndex", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		const registeredIds = mockRegisterCommand.mock.calls.map((c: any) => c[0])
		expect(registeredIds).not.toContain("njust-ai.cangjieExtractFunction")
		expect(registeredIds).not.toContain("njust-ai.cangjieMoveFile")
	})

	it("adds all disposables to context subscriptions", () => {
		registerCangjieCommands(mockContext, mockLspClient)

		// Should have many subscriptions (commands + event listeners + profiler)
		expect(mockContext.subscriptions.length).toBeGreaterThan(10)
	})
})
