import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"

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
	mockEvaluatePolicyOnly,
	mockSandboxRun,
	mockEvaluateAndAuditExecution,
	mockTrackExternalTerminalExecution,
	mockStopExternalTerminalTracking,
	mockRecordExecutionComplete,
	mockGetEffectiveTimeout,
	mockDisposeScope,
	mockGenerateExecutionId,
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
	mockEvaluatePolicyOnly: vi.fn(),
	mockSandboxRun: vi.fn(),
	mockEvaluateAndAuditExecution: vi.fn(),
	mockTrackExternalTerminalExecution: vi.fn(),
	mockStopExternalTerminalTracking: vi.fn(),
	mockRecordExecutionComplete: vi.fn(),
	mockGetEffectiveTimeout: vi.fn(),
	mockDisposeScope: vi.fn(),
	mockGenerateExecutionId: vi.fn(),
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
	scanGeneratedFilesForCleanup: vi.fn().mockReturnValue({ active: [], detached: [], legacy: [] }),
	deleteConfirmedCangjieTestFiles: vi.fn().mockResolvedValue({
		deleted: [],
		skippedModified: [],
		skippedOutsideWorkspace: [],
		skippedLegacyNotConfirmed: [],
		failed: [],
	}),
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
}))

vi.mock("../../../i18n", () => ({
	t: (key: string) => key,
}))

vi.mock("../../../shared/package", () => ({
	Package: { resolve: vi.fn().mockReturnValue(null), name: "njust-ai" },
}))

vi.mock("@njust-ai/types", () => ({
	NJUST_AI_CONFIG_DIR: ".njust-ai",
	TelemetryEventName: { CANGJIE_LSP_ERROR: "cangjie_lsp_error" },
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: { reportError: vi.fn() },
}))

vi.mock("../../../shared/logger", () => ({
	logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

vi.mock("../../../shared/error-utils", () => ({
	getErrorMessage: (e: unknown) => String(e),
	wrapAsError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}))

vi.mock("child_process", () => ({
	execFile: vi.fn(),
}))

vi.mock("../../sandbox", () => ({
	SandboxExecutionService: {
		getInstance: () => ({
			evaluatePolicyOnly: mockEvaluatePolicyOnly,
			run: mockSandboxRun,
			evaluateAndAuditExecution: mockEvaluateAndAuditExecution,
			trackExternalTerminalExecution: mockTrackExternalTerminalExecution,
			recordExecutionComplete: mockRecordExecutionComplete,
			getEffectiveTimeout: mockGetEffectiveTimeout,
			disposeScope: mockDisposeScope,
		}),
		generateExecutionId: mockGenerateExecutionId,
	},
}))

import { registerCangjieCommands } from "../cangjieCommands"

describe("cangjieCommands", () => {
	let mockContext: any
	let mockLspClient: any

	beforeEach(() => {
		vi.clearAllMocks()
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/ws" } }]
		;(vscode.window as any).activeTextEditor = undefined
		mockGetWorkspaceFolder.mockImplementation((uri: { fsPath: string }) =>
			(vscode.workspace.workspaceFolders ?? []).find((folder: any) => uri.fsPath.startsWith(folder.uri.fsPath)),
		)
		mockExistsSync.mockReset().mockReturnValue(false)
		mockResolveCangjieToolPath.mockReset().mockReturnValue("/sdk/bin/cjpm")
		mockBuildCangjieToolEnv.mockReset().mockReturnValue({ CANGJIE_HOME: "/sdk" })
		mockEvaluatePolicyOnly.mockReset().mockResolvedValue("guarded-host")
		mockSandboxRun.mockReset().mockResolvedValue({ exitCode: 0 })
		mockEvaluateAndAuditExecution.mockReset().mockReturnValue({
			executionId: "cangjie-command-execution",
			backend: "guarded-host",
		})
		mockStopExternalTerminalTracking.mockReset()
		mockTrackExternalTerminalExecution.mockReset().mockReturnValue(mockStopExternalTerminalTracking)
		mockRecordExecutionComplete.mockReset()
		mockGetEffectiveTimeout.mockReset().mockReturnValue(120_000)
		mockDisposeScope.mockReset().mockResolvedValue(undefined)
		mockGenerateExecutionId.mockReset().mockReturnValue("cangjie-command-execution")

		const subscriptions: any[] = []
		mockContext = {
			subscriptions,
			globalState: {
				get: vi.fn(),
				update: vi.fn(),
			},
		}
		mockLspClient = {
			restart: vi.fn(),
		}
		mockCreateOutputChannel.mockReturnValue({
			append: vi.fn(),
			appendLine: vi.fn(),
			clear: vi.fn(),
			dispose: vi.fn(),
			show: vi.fn(),
		})
		mockCreateTerminal.mockReturnValue({
			show: vi.fn(),
			sendText: vi.fn(),
		})
	})

	function getRegisteredCommand(commandId: string): (...args: any[]) => unknown {
		registerCangjieCommands(mockContext, mockLspClient)
		const registration = mockRegisterCommand.mock.calls.find((call: any[]) => call[0] === commandId)
		expect(registration).toBeDefined()
		return registration![1]
	}

	it("registerCangjieCommands is a function", () => {
		expect(typeof registerCangjieCommands).toBe("function")
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

	it("runs Docker cjpm without resolving host SDK paths or environment", async () => {
		mockExistsSync.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/ws/cjpm.toml")
		mockEvaluatePolicyOnly.mockResolvedValue("docker")
		const runBuild = getRegisteredCommand("njust-ai.cangjieBuild")

		await runBuild()

		expect(mockSandboxRun).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "/usr/local/bin/cjpm build",
				workspacePath: "/ws",
				cwd: "/ws",
				resourceScopeId: "user:cangjie-command:cangjie-command-execution",
			}),
		)
		expect(mockEvaluatePolicyOnly).toHaveBeenCalledWith(
			"user",
			expect.objectContaining({ resourceScopeId: "user:cangjie-command:cangjie-command-execution" }),
		)
		expect(mockDisposeScope).toHaveBeenCalledOnce()
		expect(mockDisposeScope).toHaveBeenCalledWith("user:cangjie-command:cangjie-command-execution")
		expect(mockSandboxRun.mock.invocationCallOrder[0]).toBeLessThan(mockDisposeScope.mock.invocationCallOrder[0])
		expect(mockSandboxRun.mock.calls[0][0].environment).toBeUndefined()
		expect(mockResolveCangjieToolPath).not.toHaveBeenCalled()
		expect(mockBuildCangjieToolEnv).not.toHaveBeenCalled()
		expect(mockCreateTerminal).not.toHaveBeenCalled()
	})

	it("isolates and disposes concurrent Docker cjpm commands", async () => {
		mockExistsSync.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/ws/cjpm.toml")
		mockEvaluatePolicyOnly.mockResolvedValue("docker")
		mockGenerateExecutionId.mockReturnValueOnce("cangjie-command-one").mockReturnValueOnce("cangjie-command-two")
		const runBuild = getRegisteredCommand("njust-ai.cangjieBuild")

		await Promise.all([runBuild(), runBuild()])

		const scopes = mockSandboxRun.mock.calls.map(([request]) => request.resourceScopeId)
		expect(scopes).toEqual(["user:cangjie-command:cangjie-command-one", "user:cangjie-command:cangjie-command-two"])
		expect(new Set(scopes).size).toBe(2)
		expect(mockDisposeScope.mock.calls.map(([scope]) => scope)).toEqual(expect.arrayContaining(scopes))
		expect(mockDisposeScope).toHaveBeenCalledTimes(2)
		expect(Math.max(...mockSandboxRun.mock.invocationCallOrder)).toBeLessThan(
			Math.min(...mockDisposeScope.mock.invocationCallOrder),
		)
	})

	it("uses the active Cangjie project in a multi-root workspace", async () => {
		;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/one" } }, { uri: { fsPath: "/two" } }]
		;(vscode.window as any).activeTextEditor = { document: { uri: { fsPath: "/two/src/main.cj" } } }
		mockExistsSync.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/two/cjpm.toml")
		const runTest = getRegisteredCommand("njust-ai.cangjieTest")

		await runTest()

		expect(mockEvaluateAndAuditExecution).toHaveBeenCalledWith(
			expect.objectContaining({ workspacePath: "/two", cwd: "/two", command: expect.stringContaining("test") }),
		)
		expect(mockCreateTerminal).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: "/two", env: { CANGJIE_HOME: "/sdk" } }),
		)
		expect(mockTrackExternalTerminalExecution).toHaveBeenCalled()
		expect(mockDisposeScope).not.toHaveBeenCalled()
	})

	it("shows policy errors before probing the SDK or creating a terminal", async () => {
		mockExistsSync.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/ws/cjpm.toml")
		mockEvaluatePolicyOnly.mockRejectedValue(new Error("Docker daemon is unavailable"))
		const runBuild = getRegisteredCommand("njust-ai.cangjieBuild")

		await runBuild()

		expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Docker daemon is unavailable"))
		expect(mockResolveCangjieToolPath).not.toHaveBeenCalled()
		expect(mockCreateTerminal).not.toHaveBeenCalled()
		expect(mockSandboxRun).not.toHaveBeenCalled()
		expect(mockDisposeScope).not.toHaveBeenCalled()
	})

	it("does not create a terminal when external execution audit fails", async () => {
		mockExistsSync.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/ws/cjpm.toml")
		mockEvaluateAndAuditExecution.mockRejectedValue(new Error("Policy denied"))
		const runCheck = getRegisteredCommand("njust-ai.cangjieCheck")

		await runCheck()

		expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Policy denied"))
		expect(mockCreateTerminal).not.toHaveBeenCalled()
		expect(mockTrackExternalTerminalExecution).not.toHaveBeenCalled()
	})

	it("shows Docker execution errors without creating a terminal", async () => {
		mockExistsSync.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/ws/cjpm.toml")
		mockEvaluatePolicyOnly.mockResolvedValue("docker")
		mockSandboxRun.mockRejectedValue(new Error("Image is missing"))
		const runBuild = getRegisteredCommand("njust-ai.cangjieBuild")

		await runBuild()

		expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining("Image is missing"))
		expect(mockDisposeScope).toHaveBeenCalledWith("user:cangjie-command:cangjie-command-execution")
		expect(mockCreateTerminal).not.toHaveBeenCalled()
	})

	it("reports Docker cjpm scope cleanup failures", async () => {
		const cleanupError = new Error("Cangjie command cleanup failed")
		mockExistsSync.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/ws/cjpm.toml")
		mockEvaluatePolicyOnly.mockResolvedValue("docker")
		mockDisposeScope.mockRejectedValue(cleanupError)
		const runBuild = getRegisteredCommand("njust-ai.cangjieBuild")

		await runBuild()

		expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining(cleanupError.message))
	})

	it("aggregates Docker cjpm execution and scope cleanup failures", async () => {
		const executionError = new Error("Cangjie command execution failed")
		const cleanupError = new Error("Cangjie command cleanup failed")
		mockExistsSync.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/ws/cjpm.toml")
		mockEvaluatePolicyOnly.mockResolvedValue("docker")
		mockSandboxRun.mockRejectedValue(executionError)
		mockDisposeScope.mockRejectedValue(cleanupError)
		const runBuild = getRegisteredCommand("njust-ai.cangjieBuild")

		await runBuild()

		expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining(executionError.message))
		expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining(cleanupError.message))
	})

	it("records one failed audit when a host cjpm terminal cannot be created", async () => {
		const terminalError = new Error("terminal creation failed")
		mockExistsSync.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/ws/cjpm.toml")
		mockCreateTerminal.mockImplementationOnce(() => {
			throw terminalError
		})
		const runBuild = getRegisteredCommand("njust-ai.cangjieBuild")

		await runBuild()

		expect(mockRecordExecutionComplete).toHaveBeenCalledTimes(1)
		expect(mockRecordExecutionComplete).toHaveBeenCalledWith(
			"cangjie-command-execution",
			expect.objectContaining({
				executionId: "cangjie-command-execution",
				backend: "guarded-host",
				cancelled: false,
				timedOut: false,
			}),
			terminalError,
		)
		expect(mockTrackExternalTerminalExecution).not.toHaveBeenCalled()
		expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining(terminalError.message))
	})

	it("stops tracking and records one failed audit when host cjpm dispatch fails", async () => {
		const dispatchError = new Error("terminal dispatch failed")
		const sendText = vi.fn(() => {
			throw dispatchError
		})
		mockExistsSync.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/ws/cjpm.toml")
		mockCreateTerminal.mockReturnValueOnce({ show: vi.fn(), sendText })
		const runBuild = getRegisteredCommand("njust-ai.cangjieBuild")

		await runBuild()

		expect(mockStopExternalTerminalTracking).toHaveBeenCalledOnce()
		expect(mockRecordExecutionComplete).toHaveBeenCalledTimes(1)
		expect(mockRecordExecutionComplete).toHaveBeenCalledWith(
			"cangjie-command-execution",
			expect.objectContaining({ backend: "guarded-host" }),
			dispatchError,
		)
		expect(mockShowErrorMessage).toHaveBeenCalledWith(expect.stringContaining(dispatchError.message))
	})
})
