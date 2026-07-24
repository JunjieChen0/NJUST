import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

const {
	existsSyncMock,
	resolveCangjieToolPathMock,
	buildCangjieToolEnvMock,
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
	existsSyncMock: vi.fn(),
	resolveCangjieToolPathMock: vi.fn(),
	buildCangjieToolEnvMock: vi.fn(),
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

vi.mock("vscode", async () => {
	const actual = await vi.importActual<typeof import("vscode")>("vscode")
	return {
		...actual,
		SymbolKind: {
			File: 0,
			Module: 1,
			Namespace: 2,
			Package: 3,
			Class: 4,
			Method: 5,
			Property: 6,
			Field: 7,
			Constructor: 8,
			Enum: 9,
			Interface: 10,
			Function: 11,
			Variable: 12,
			Constant: 13,
			String: 14,
			Struct: 22,
		},
		CodeActionKind: {
			QuickFix: { value: "quickfix" },
			Refactor: { value: "refactor" },
			RefactorExtract: { value: "refactor.extract" },
			RefactorRewrite: { value: "refactor.rewrite" },
		},
		FoldingRangeKind: { Comment: "comment", Imports: "imports", Region: "region" },
		InlayHintKind: { Type: 1, Parameter: 2 },
		ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
		TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
		ViewColumn: { Active: -1, Beside: -2, One: 1 },
		SemanticTokensLegend: class {
			constructor(
				public tokenTypes: string[],
				public tokenModifiers: string[],
			) {}
		},
		SemanticTokensBuilder: class {
			push() {}
			build() {
				return {}
			}
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
	}
})

vi.mock("fs", async () => {
	const actual = await vi.importActual<typeof import("fs")>("fs")
	return { ...actual, existsSync: existsSyncMock }
})

vi.mock("../../services/cangjie-lsp/cangjieToolUtils", async () => {
	const actual = await vi.importActual<typeof import("../../services/cangjie-lsp/cangjieToolUtils")>(
		"../../services/cangjie-lsp/cangjieToolUtils",
	)
	return {
		...actual,
		resolveCangjieToolPath: resolveCangjieToolPathMock,
		buildCangjieToolEnv: buildCangjieToolEnvMock,
	}
})

vi.mock("../../services/sandbox", () => ({
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

vi.mock("vscode-languageclient/node", () => ({
	LanguageClient: class {},
	TransportKind: { stdio: 0 },
}))

import { registerCangjieTestCommands } from "../cangjieLanguage"

describe("registerCangjieTestCommands sandbox execution", () => {
	let registeredCommands: Map<string, (...args: any[]) => unknown>
	let terminal: { show: ReturnType<typeof vi.fn>; sendText: ReturnType<typeof vi.fn> }
	let outputChannel: {
		append: ReturnType<typeof vi.fn>
		appendLine: ReturnType<typeof vi.fn>
		show: ReturnType<typeof vi.fn>
	}
	let createTerminalSpy: ReturnType<typeof vi.spyOn>
	let showErrorMessageSpy: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		vi.restoreAllMocks()
		registeredCommands = new Map()
		terminal = { show: vi.fn(), sendText: vi.fn() }
		outputChannel = { append: vi.fn(), appendLine: vi.fn(), clear: vi.fn(), show: vi.fn() }

		existsSyncMock.mockReset().mockReturnValue(false)
		resolveCangjieToolPathMock.mockReset().mockReturnValue("/sdk/bin/cjpm")
		buildCangjieToolEnvMock.mockReset().mockReturnValue({ CANGJIE_HOME: "/sdk" })
		evaluatePolicyOnlyMock.mockReset().mockResolvedValue("guarded-host")
		runSandboxMock.mockReset().mockResolvedValue({ exitCode: 0 })
		evaluateAndAuditExecutionMock.mockReset().mockReturnValue({
			executionId: "cangjie-test-execution",
			backend: "guarded-host",
		})
		stopExternalTerminalTrackingMock.mockReset()
		trackExternalTerminalExecutionMock.mockReset().mockReturnValue(stopExternalTerminalTrackingMock)
		recordExecutionCompleteMock.mockReset()
		getEffectiveTimeoutMock.mockReset().mockReturnValue(120_000)
		disposeScopeMock.mockReset().mockResolvedValue(undefined)
		generateExecutionIdMock.mockReset().mockReturnValue("cangjie-test-execution")
		;(vscode.workspace as any).workspaceFolders = [
			{ uri: { fsPath: "/one" }, name: "one", index: 0 },
			{ uri: { fsPath: "/two" }, name: "two", index: 1 },
		]
		;(vscode.window as any).activeTextEditor = undefined
		vi.spyOn(vscode.workspace, "getWorkspaceFolder").mockImplementation((uri: vscode.Uri) =>
			(vscode.workspace.workspaceFolders ?? []).find((folder) => uri.fsPath.startsWith(folder.uri.fsPath)),
		)
		vi.spyOn(vscode.commands, "registerCommand").mockImplementation((command, callback) => {
			registeredCommands.set(command, callback)
			return { dispose: vi.fn() }
		})
		createTerminalSpy = vi.spyOn(vscode.window, "createTerminal").mockReturnValue(terminal as any)
		vi.spyOn(vscode.window, "createOutputChannel").mockReturnValue(outputChannel as any)
		showErrorMessageSpy = vi.spyOn(vscode.window, "showErrorMessage").mockResolvedValue(undefined)
	})

	function getRunTestCommand(): (testName: string, fileUri?: vscode.Uri) => Promise<void> {
		const context = { subscriptions: [] } as unknown as vscode.ExtensionContext
		registerCangjieTestCommands(context)
		return registeredCommands.get("njust-ai.cangjieRunTest") as (
			testName: string,
			fileUri?: vscode.Uri,
		) => Promise<void>
	}

	it("runs tests in the preferred Docker workspace without host SDK state", async () => {
		existsSyncMock.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/two/cjpm.toml")
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		const runTest = getRunTestCommand()

		await runTest("math.add", { fsPath: "/two/src/math_test.cj" } as vscode.Uri)

		expect(runSandboxMock).toHaveBeenCalledWith(
			expect.objectContaining({
				command: "/usr/local/bin/cjpm test --filter math.add",
				workspacePath: "/two",
				cwd: "/two",
				resourceScopeId: "user:cangjie-test:cangjie-test-execution",
			}),
		)
		expect(evaluatePolicyOnlyMock).toHaveBeenCalledWith(
			"user",
			expect.objectContaining({ resourceScopeId: "user:cangjie-test:cangjie-test-execution" }),
		)
		expect(disposeScopeMock).toHaveBeenCalledOnce()
		expect(disposeScopeMock).toHaveBeenCalledWith("user:cangjie-test:cangjie-test-execution")
		expect(runSandboxMock.mock.invocationCallOrder[0]).toBeLessThan(disposeScopeMock.mock.invocationCallOrder[0])
		expect(resolveCangjieToolPathMock).not.toHaveBeenCalled()
		expect(buildCangjieToolEnvMock).not.toHaveBeenCalled()
		expect(createTerminalSpy).not.toHaveBeenCalled()
	})

	it("isolates and disposes concurrent Docker Cangjie test invocations", async () => {
		existsSyncMock.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/two/cjpm.toml")
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		generateExecutionIdMock.mockReturnValueOnce("cangjie-test-one").mockReturnValueOnce("cangjie-test-two")
		const runTest = getRunTestCommand()
		const fileUri = { fsPath: "/two/src/math_test.cj" } as vscode.Uri

		await Promise.all([runTest("math.add", fileUri), runTest("math.subtract", fileUri)])

		const scopes = runSandboxMock.mock.calls.map(([request]) => request.resourceScopeId)
		expect(scopes).toEqual(["user:cangjie-test:cangjie-test-one", "user:cangjie-test:cangjie-test-two"])
		expect(new Set(scopes).size).toBe(2)
		expect(disposeScopeMock.mock.calls.map(([scope]) => scope)).toEqual(expect.arrayContaining(scopes))
		expect(disposeScopeMock).toHaveBeenCalledTimes(2)
		expect(Math.max(...runSandboxMock.mock.invocationCallOrder)).toBeLessThan(
			Math.min(...disposeScopeMock.mock.invocationCallOrder),
		)
	})

	it("audits the host command before creating its dedicated terminal", async () => {
		existsSyncMock.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/two/cjpm.toml")
		const runTest = getRunTestCommand()

		await runTest("math.add", { fsPath: "/two/src/math_test.cj" } as vscode.Uri)

		expect(evaluateAndAuditExecutionMock).toHaveBeenCalledWith(
			expect.objectContaining({ command: expect.stringContaining("/sdk/bin/cjpm"), workspacePath: "/two" }),
		)
		expect(createTerminalSpy).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: "/two", env: { CANGJIE_HOME: "/sdk" } }),
		)
		expect(evaluateAndAuditExecutionMock.mock.invocationCallOrder[0]).toBeLessThan(
			createTerminalSpy.mock.invocationCallOrder[0],
		)
		expect(trackExternalTerminalExecutionMock).toHaveBeenCalled()
		expect(terminal.sendText).toHaveBeenCalledWith(expect.stringContaining("math.add"))
		expect(disposeScopeMock).not.toHaveBeenCalled()
	})

	it("shows policy errors without probing the host or creating a terminal", async () => {
		existsSyncMock.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/two/cjpm.toml")
		evaluatePolicyOnlyMock.mockRejectedValue(new Error("Docker is unavailable"))
		const runTest = getRunTestCommand()

		await runTest("math.add", { fsPath: "/two/src/math_test.cj" } as vscode.Uri)

		expect(showErrorMessageSpy).toHaveBeenCalledWith(expect.stringContaining("Docker is unavailable"))
		expect(resolveCangjieToolPathMock).not.toHaveBeenCalled()
		expect(createTerminalSpy).not.toHaveBeenCalled()
		expect(runSandboxMock).not.toHaveBeenCalled()
		expect(disposeScopeMock).not.toHaveBeenCalled()
	})

	it("does not run an explicit test URI in a different Cangjie workspace", async () => {
		existsSyncMock.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/one/cjpm.toml")
		const runTest = getRunTestCommand()

		await runTest("math.add", { fsPath: "/two/src/math_test.cj" } as vscode.Uri)

		expect(showErrorMessageSpy).toHaveBeenCalledWith(expect.stringContaining("No Cangjie project"))
		expect(evaluatePolicyOnlyMock).not.toHaveBeenCalled()
		expect(runSandboxMock).not.toHaveBeenCalled()
		expect(createTerminalSpy).not.toHaveBeenCalled()
	})

	it("shows Docker execution errors without creating a terminal", async () => {
		existsSyncMock.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/two/cjpm.toml")
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		runSandboxMock.mockRejectedValue(new Error("Image is missing"))
		const runTest = getRunTestCommand()

		await runTest("math.add", { fsPath: "/two/src/math_test.cj" } as vscode.Uri)

		expect(showErrorMessageSpy).toHaveBeenCalledWith(expect.stringContaining("Image is missing"))
		expect(disposeScopeMock).toHaveBeenCalledWith("user:cangjie-test:cangjie-test-execution")
		expect(createTerminalSpy).not.toHaveBeenCalled()
	})

	it("reports Docker Cangjie test scope cleanup failures", async () => {
		const cleanupError = new Error("Cangjie test cleanup failed")
		existsSyncMock.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/two/cjpm.toml")
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		disposeScopeMock.mockRejectedValue(cleanupError)
		const runTest = getRunTestCommand()

		await runTest("math.add", { fsPath: "/two/src/math_test.cj" } as vscode.Uri)

		expect(showErrorMessageSpy).toHaveBeenCalledWith(expect.stringContaining(cleanupError.message))
	})

	it("aggregates Docker Cangjie test execution and scope cleanup failures", async () => {
		const executionError = new Error("Cangjie test execution failed")
		const cleanupError = new Error("Cangjie test cleanup failed")
		existsSyncMock.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/two/cjpm.toml")
		evaluatePolicyOnlyMock.mockResolvedValue("docker")
		runSandboxMock.mockRejectedValue(executionError)
		disposeScopeMock.mockRejectedValue(cleanupError)
		const runTest = getRunTestCommand()

		await runTest("math.add", { fsPath: "/two/src/math_test.cj" } as vscode.Uri)

		expect(showErrorMessageSpy).toHaveBeenCalledWith(expect.stringContaining(executionError.message))
		expect(showErrorMessageSpy).toHaveBeenCalledWith(expect.stringContaining(cleanupError.message))
	})

	it("records one failed audit when a host Cangjie test terminal cannot be created", async () => {
		const terminalError = new Error("terminal creation failed")
		existsSyncMock.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/two/cjpm.toml")
		createTerminalSpy.mockImplementationOnce(() => {
			throw terminalError
		})
		const runTest = getRunTestCommand()

		await runTest("math.add", { fsPath: "/two/src/math_test.cj" } as vscode.Uri)

		expect(recordExecutionCompleteMock).toHaveBeenCalledTimes(1)
		expect(recordExecutionCompleteMock).toHaveBeenCalledWith(
			"cangjie-test-execution",
			expect.objectContaining({
				executionId: "cangjie-test-execution",
				backend: "guarded-host",
				cancelled: false,
				timedOut: false,
			}),
			terminalError,
		)
		expect(trackExternalTerminalExecutionMock).not.toHaveBeenCalled()
		expect(showErrorMessageSpy).toHaveBeenCalledWith(expect.stringContaining(terminalError.message))
	})

	it("stops tracking and records one failed audit when host Cangjie test dispatch fails", async () => {
		const dispatchError = new Error("terminal dispatch failed")
		terminal.sendText.mockImplementationOnce(() => {
			throw dispatchError
		})
		existsSyncMock.mockImplementation((value) => value.toString().replace(/\\/g, "/") === "/two/cjpm.toml")
		const runTest = getRunTestCommand()

		await runTest("math.add", { fsPath: "/two/src/math_test.cj" } as vscode.Uri)

		expect(stopExternalTerminalTrackingMock).toHaveBeenCalledOnce()
		expect(recordExecutionCompleteMock).toHaveBeenCalledTimes(1)
		expect(recordExecutionCompleteMock).toHaveBeenCalledWith(
			"cangjie-test-execution",
			expect.objectContaining({ backend: "guarded-host" }),
			dispatchError,
		)
		expect(showErrorMessageSpy).toHaveBeenCalledWith(expect.stringContaining(dispatchError.message))
	})
})
