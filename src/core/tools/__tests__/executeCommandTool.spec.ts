// npx vitest run src/core/tools/__tests__/executeCommandTool.spec.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest"

import type { ToolUsage } from "@njust-ai/types"
import fs from "fs/promises"
import path from "path"
import * as vscode from "vscode"

import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult } from "../../../shared/tools"
import { unescapeHtmlEntities } from "../../../utils/text-normalization"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { CommandTimeoutError, SandboxExecutionService } from "../../../services/sandbox"

vitest.mock("@njust-ai/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vitest.fn(),
			startSpan: vitest.fn(function () {
				return {
					traceId: "t",
					spanId: "s",
				}
			}),
			endSpan: vitest.fn(),
			captureTaskCompleted: vitest.fn(),
		},
	},
}))

vitest.mock("../../security/metrics", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>
	return {
		...actual,
		recordSecurityMetric: vitest.fn(),
		startTraceSpan: vitest.fn(function () {
			return {
				traceId: "test-trace",
				spanId: "test-span",
				end: vitest.fn(),
			}
		}),
	}
})

// Mock dependencies
vitest.mock("execa", () => ({
	execa: vitest.fn(),
}))

vitest.mock("fs/promises", () => ({
	default: {
		access: vitest.fn().mockResolvedValue(undefined),
	},
}))

vitest.mock("vscode", () => ({
	workspace: {
		getConfiguration: vitest.fn(),
		saveAll: vitest.fn().mockResolvedValue(undefined),
		workspaceFolders: undefined,
	},
	window: {
		activeTextEditor: undefined,
		visibleTextEditors: [],
	},
}))

vitest.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		getOrCreateTerminal: vitest.fn().mockResolvedValue({
			runCommand: vitest.fn().mockResolvedValue(undefined),
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/workspace"),
		}),
	},
}))

vitest.mock("../../task/Task")
vitest.mock("../../prompts/responses")

// Import the module
import * as executeCommandModule from "../ExecuteCommandTool"
const { executeCommandTool, isSuccessfulCommandResult, validateCangjieImplementCommand } = executeCommandModule

function asTestType<T>(value: unknown): T {
	return value as T
}

describe("validateCangjieImplementCommand", () => {
	it("allows only a direct cjpm init command for CangjieImplement", () => {
		expect(
			validateCangjieImplementCommand("CangjieImplement", "cjpm init --name demo_app --type=executable"),
		).toBeNull()
		expect(validateCangjieImplementCommand("CangjieImplement", "cjpm build")).toContain("only one direct cjpm init")
		expect(
			validateCangjieImplementCommand(
				"CangjieImplement",
				"cd demo && cjpm init --name demo_app --type=executable",
			),
		).toContain("only one direct cjpm init")
		expect(validateCangjieImplementCommand("CangjieVerify", "cjpm build")).toBeNull()
	})
})

describe("isSuccessfulCommandResult", () => {
	it("uses the terminal exit code as the authoritative result", () => {
		expect(isSuccessfulCommandResult("Exit code: 0\nOutput:\ncjpm build success", false)).toBe(true)
		expect(
			isSuccessfulCommandResult(
				"Command execution was not successful, inspect the cause and adjust as needed.\nExit code: 1\nOutput:\nError: cjpm build failed",
				false,
			),
		).toBe(false)
	})

	it("recognizes a cjpm failure when an exit code is unavailable", () => {
		expect(isSuccessfulCommandResult("Error: cjpm build failed", false)).toBe(false)
		expect(isSuccessfulCommandResult("cjpm build success", true)).toBe(false)
	})
})

describe("executeCommandTool", () => {
	// Setup common test variables
	let mockCline: any & { consecutiveMistakeCount: number; didRejectTool: boolean }
	let mockAskApproval: any
	let mockHandleError: any
	let mockPushToolResult: any
	let mockToolUse: ToolUse<"execute_command">
	const originalCliRuntime = process.env.NJUST_AI_CLI_RUNTIME

	beforeEach(() => {
		// Reset mocks
		vitest.clearAllMocks()
		;(fs.access as any).mockResolvedValue(undefined)

		// executeCommandInTerminal is a local reference in ExecuteCommandTool.ts
		// and cannot be mocked via spyOn. Tests that need it mocked should call
		// executeCommandTool.execute() directly and let the real function run
		// with mocked dependencies (TerminalRegistry, fs, etc.).

		// Create mock implementations with eslint directives to handle the type issues
		mockCline = {
			taskId: "test-task-id",
			instanceId: "test-instance-id",
			ask: vitest.fn().mockResolvedValue(undefined),
			say: vitest.fn().mockResolvedValue(undefined),
			sayAndCreateMissingParamError: vitest.fn().mockResolvedValue("Missing parameter error"),
			consecutiveMistakeCount: 0,
			didRejectTool: false,
			rooIgnoreController: {
				validateCommand: vitest.fn().mockReturnValue(null),
			},
			recordToolUsage: vitest.fn().mockReturnValue({} as ToolUsage),
			recordToolError: vitest.fn(),
			providerRef: {
				// Sync deref (matches WeakRef); async deref breaks `deref()?.getState()` in ExecuteCommandTool.
				deref: vitest.fn().mockReturnValue({
					getState: vitest.fn().mockResolvedValue({
						terminalOutputLineLimit: 500,
						terminalOutputCharacterLimit: 100000,
						terminalShellIntegrationDisabled: true,
					}),
					postMessageToWebview: vitest.fn(),
					context: {
						extensionPath: "/mock/extension",
					},
				}),
			},
			lastMessageTs: Date.now(),
			cwd: "/test/workspace",
			taskMode: "default",
			cangjieRuntimePolicy: {
				hasCjpmProject: vitest.fn().mockResolvedValue(false),
				validateCommandSurface: vitest.fn().mockReturnValue(null),
				noteBuildResult: vitest.fn(),
			},
			supersedePendingAsk: vitest.fn(),
		}

		mockAskApproval = vitest.fn().mockResolvedValue(true)
		mockHandleError = vitest.fn().mockResolvedValue(undefined)
		mockPushToolResult = vitest.fn()

		// Setup vscode config mock
		const mockConfig = {
			get: vitest.fn().mockImplementation((key: string, defaultValue: any) => defaultValue),
		}
		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)
		;(vscode.workspace as any).workspaceFolders = undefined
		;(vscode.window as any).activeTextEditor = undefined
		;(vscode.window as any).visibleTextEditors = []

		// Create a mock tool use object
		mockToolUse = {
			type: "tool_use",
			name: "execute_command",
			params: {
				command: "echo test",
			},
			nativeArgs: {
				command: "echo test",
			},
			partial: false,
		}
	})

	afterEach(() => {
		vitest.useRealTimers()
		process.env.NJUST_AI_CLI_RUNTIME = originalCliRuntime
	})

	/**
	 * Tests for HTML entity unescaping in commands
	 * This verifies that HTML entities are properly converted to their actual characters
	 */
	describe("HTML entity unescaping", () => {
		it("unescapes &lt; and &gt; to angle brackets", () => {
			const input = "echo &lt;test&gt;"
			expect(unescapeHtmlEntities(input)).toBe("echo <test>")
		})

		it("unescapes &gt; in output redirection form", () => {
			const input = "echo test &gt; output.txt"
			expect(unescapeHtmlEntities(input)).toBe("echo test > output.txt")
		})

		it("unescapes &amp; to ampersand", () => {
			const input = "echo foo &amp;&amp; echo bar"
			expect(unescapeHtmlEntities(input)).toBe("echo foo && echo bar")
		})

		it("unescapes mixed entities", () => {
			const input = "grep -E 'pattern' &lt;file.txt &gt;output.txt 2&gt;&amp;1"
			expect(unescapeHtmlEntities(input)).toBe("grep -E 'pattern' <file.txt >output.txt 2>&1")
		})
	})

	describe("Cangjie toolchain command detection", () => {
		it("detects toolchain commands with directory-switch prefixes", () => {
			expect(executeCommandModule.isCangjieToolchainCommand("cjpm build")).toBe(true)
			expect(
				executeCommandModule.isCangjieToolchainCommand(
					"cd /d D:\\cangjie\\Cangjie-Examples\\HTTP && cjpm build",
				),
			).toBe(true)
			expect(
				executeCommandModule.isCangjieToolchainCommand(
					"d: && cd d:\\cangjie\\Cangjie-Examples\\HTTP && cjpm build 2>&1",
				),
			).toBe(true)
			expect(executeCommandModule.isCangjieToolchainCommand("where.exe cjpm")).toBe(true)
			expect(executeCommandModule.isCangjieToolchainCommand("echo cjpm build")).toBe(true)
			expect(executeCommandModule.isCangjieToolchainCommand("npm test")).toBe(false)
		})
	})

	// Now we can run these tests
	describe("Basic functionality", () => {
		it("should execute a command normally", async () => {
			// Setup
			mockToolUse.params.command = "echo test"
			mockToolUse.nativeArgs = { command: "echo test" }

			// Execute directly via execute() to isolate tool logic from BaseTool.handle()
			await executeCommandTool.execute({ command: "echo test" }, mockCline as unknown as Task, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
			})

			// Verify
			expect(mockPushToolResult).toHaveBeenCalled()
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("Command")
		})

		it("should pass along custom working directory if provided", async () => {
			// Setup
			mockToolUse.params.command = "echo test"
			mockToolUse.params.cwd = "/custom/path"
			mockToolUse.nativeArgs = { command: "echo test", cwd: "/custom/path" }

			// Execute directly via execute() to isolate tool logic from BaseTool.handle()
			await executeCommandTool.execute(
				{ command: "echo test", cwd: "/custom/path" },
				mockCline as unknown as Task,
				{
					askApproval: mockAskApproval as unknown as AskApproval,
					handleError: mockHandleError as unknown as HandleError,
					pushToolResult: mockPushToolResult as unknown as PushToolResult,
				},
			)

			// Verify - confirm the command was approved and result was pushed
			// The custom path handling is tested in integration tests
			expect(mockPushToolResult).toHaveBeenCalled()
			const result = mockPushToolResult.mock.calls[0][0]
			expect(result).toContain("/custom/path")
		})

		it("should run Cangjie toolchain commands from the workspace folder containing cjpm.toml", async () => {
			mockCline.cwd = "/home/user/Desktop"
			mockCline.taskMode = "cangjie"
			mockCline.cangjieRuntimePolicy = {
				validateCommandSurface: vitest.fn().mockReturnValue(null),
				noteBuildResult: vitest.fn(),
			}
			;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]
			;(fs.access as any).mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.endsWith("/home/user/Desktop/cjpm.toml")) {
					return Promise.reject(new Error("missing"))
				}
				return Promise.resolve(undefined)
			})

			await executeCommandTool.execute({ command: "cjpm build 2>&1" }, asTestType<Task>(mockCline), {
				askApproval: asTestType<AskApproval>(mockAskApproval),
				handleError: asTestType<HandleError>(mockHandleError),
				pushToolResult: asTestType<PushToolResult>(mockPushToolResult),
			})

			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(
				"/test/workspace",
				"test-task-id",
				"execa",
				{ exactCwd: true },
			)
			expect(mockCline.cangjieRuntimePolicy.noteBuildResult).toHaveBeenCalled()
		})

		it("should resolve Cangjie toolchain cwd from the active editor even outside Cangjie task mode", async () => {
			const projectRoot = path.join(path.parse(process.cwd()).root, "cangjie", "Cangjie-Examples", "HTTP")
			mockCline.cwd = path.join(path.parse(process.cwd()).root, "Users", "Administrator", "Desktop")
			;(vscode.window as any).activeTextEditor = {
				document: { uri: { fsPath: path.join(projectRoot, "src", "main.cj") } },
			}
			;(fs.access as any).mockImplementation((filePath: string) => {
				const normalizedPath = filePath.replace(/\\/g, "/")
				if (normalizedPath.endsWith("/Desktop/cjpm.toml")) {
					return Promise.reject(new Error("missing"))
				}
				if (normalizedPath.endsWith("/Cangjie-Examples/HTTP/cjpm.toml")) {
					return Promise.resolve(undefined)
				}
				if (normalizedPath.endsWith("/Cangjie-Examples/HTTP")) {
					return Promise.resolve(undefined)
				}
				return Promise.reject(new Error("missing"))
			})

			await executeCommandTool.execute({ command: "cjpm build 2>&1" }, asTestType<Task>(mockCline), {
				askApproval: asTestType<AskApproval>(mockAskApproval),
				handleError: asTestType<HandleError>(mockHandleError),
				pushToolResult: asTestType<PushToolResult>(mockPushToolResult),
			})

			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(projectRoot, "test-task-id", "execa", {
				exactCwd: true,
			})
		})

		it("should force execa for Cangjie toolchain commands even when shell integration is enabled", async () => {
			mockCline.providerRef.deref.mockReturnValue({
				getState: vitest.fn().mockResolvedValue({
					terminalOutputLineLimit: 500,
					terminalOutputCharacterLimit: 100000,
					terminalShellIntegrationDisabled: false,
				}),
				postMessageToWebview: vitest.fn(),
				context: {
					extensionPath: "/mock/extension",
				},
			})

			await executeCommandTool.execute({ command: "cjpm check" }, asTestType<Task>(mockCline), {
				askApproval: asTestType<AskApproval>(mockAskApproval),
				handleError: asTestType<HandleError>(mockHandleError),
				pushToolResult: asTestType<PushToolResult>(mockPushToolResult),
			})

			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(
				"/test/workspace",
				"test-task-id",
				"execa",
				{ exactCwd: true },
			)
		})

		it("should reject PowerShell wrappers around Cangjie toolchain commands outside Cangjie task mode", async () => {
			mockCline.taskMode = "default"
			mockCline.cangjieRuntimePolicy.validateCommandSurface.mockReturnValue(
				'Command rejected in Cangjie mode: "powershell -Command \\"cd d:\\cangjie\\Cangjie-Examples\\HTTP; cjpm build\\"". Allowed command categories: build/check: cjpm build, cjpm check, cjc.',
			)

			await executeCommandTool.execute(
				{ command: 'powershell -Command "cd d:\\cangjie\\Cangjie-Examples\\HTTP; cjpm build"' },
				asTestType<Task>(mockCline),
				{
					askApproval: asTestType<AskApproval>(mockAskApproval),
					handleError: asTestType<HandleError>(mockHandleError),
					pushToolResult: asTestType<PushToolResult>(mockPushToolResult),
				},
			)

			expect(mockCline.cangjieRuntimePolicy.validateCommandSurface).toHaveBeenCalledWith(
				'powershell -Command "cd d:\\cangjie\\Cangjie-Examples\\HTTP; cjpm build"',
			)
			expect(mockCline.recordToolError).toHaveBeenCalledWith(
				"execute_command",
				expect.stringContaining("Command rejected in Cangjie mode"),
			)
			expect(formatResponse.toolError).toHaveBeenCalledWith(
				expect.stringContaining("Command rejected in Cangjie mode"),
			)
			expect(mockPushToolResult).toHaveBeenCalled()
			expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		})

		it("should reject Cangjie toolchain commands preceded by a directory switch", async () => {
			mockCline.cwd = "C:\\Users\\Administrator\\Desktop"
			mockCline.cangjieRuntimePolicy.validateCommandSurface.mockReturnValue(
				'Command rejected in Cangjie mode: "cd /d D:\\cangjie\\Cangjie-Examples\\HTTP && cjpm build". Allowed command categories: build/check: cjpm build, cjpm check, cjc.',
			)

			await executeCommandTool.execute(
				{ command: "cd /d D:\\cangjie\\Cangjie-Examples\\HTTP && cjpm build" },
				asTestType<Task>(mockCline),
				{
					askApproval: asTestType<AskApproval>(mockAskApproval),
					handleError: asTestType<HandleError>(mockHandleError),
					pushToolResult: asTestType<PushToolResult>(mockPushToolResult),
				},
			)

			expect(mockCline.cangjieRuntimePolicy.validateCommandSurface).toHaveBeenCalledWith(
				"cd /d D:\\cangjie\\Cangjie-Examples\\HTTP && cjpm build",
			)
			expect(formatResponse.toolError).toHaveBeenCalledWith(
				expect.stringContaining("Command rejected in Cangjie mode"),
			)
			expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		})

		it("should preserve explicit cwd for Cangjie toolchain commands", async () => {
			mockCline.taskMode = "cangjie"
			mockCline.cangjieRuntimePolicy = {
				validateCommandSurface: vitest.fn().mockReturnValue(null),
				noteBuildResult: vitest.fn(),
			}
			;(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: "/test/workspace" } }]

			await executeCommandTool.execute(
				{ command: "cjpm build 2>&1", cwd: "packages/http" },
				asTestType<Task>(mockCline),
				{
					askApproval: asTestType<AskApproval>(mockAskApproval),
					handleError: asTestType<HandleError>(mockHandleError),
					pushToolResult: asTestType<PushToolResult>(mockPushToolResult),
				},
			)

			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(
				expect.stringContaining("packages"),
				"test-task-id",
				"execa",
			)
		})
	})

	describe("Error handling", () => {
		it("should handle command rejection", async () => {
			// Setup
			mockToolUse.params.command = "echo test"
			mockAskApproval.mockResolvedValue(false)
			mockToolUse.nativeArgs = { command: "echo test" }

			// Execute
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
			})

			// Verify
			expect(mockAskApproval).toHaveBeenCalledWith("command", "echo test")
			// executeCommandInTerminal should not be called since approval was denied
			expect(mockPushToolResult).not.toHaveBeenCalled()
		})

		it("should handle rooignore validation failures", async () => {
			// Setup
			mockToolUse.params.command = "cat .env"
			mockToolUse.nativeArgs = { command: "cat .env" }
			// Override the validateCommand mock to return a filename
			const validateCommandMock = vitest.fn().mockReturnValue(".env")
			mockCline.rooIgnoreController = {
				validateCommand: validateCommandMock,
			}

			const mockRooIgnoreError = "RooIgnore error"
			;(formatResponse.rooIgnoreError as any).mockReturnValue(mockRooIgnoreError)

			// Execute
			await executeCommandTool.handle(mockCline as unknown as Task, mockToolUse, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
			})

			// Verify
			expect(validateCommandMock).toHaveBeenCalledWith("cat .env")
			expect(mockCline.say).toHaveBeenCalledWith("rooignore_error", ".env")
			expect(formatResponse.rooIgnoreError).toHaveBeenCalledWith(".env")
			expect(mockPushToolResult).toHaveBeenCalledWith(mockRooIgnoreError, undefined)
			expect(mockAskApproval).not.toHaveBeenCalled()
			// executeCommandInTerminal should not be called since rooignore blocked it
		})
	})

	describe("Command execution timeout configuration", () => {
		it("should include timeout parameter in ExecuteCommandOptions", () => {
			// This test verifies that the timeout configuration is properly typed
			// The actual timeout logic is tested in integration tests
			// Note: timeout is stored internally in milliseconds but configured in seconds
			const timeoutSeconds = 15
			const options = {
				executionId: "test-id",
				command: "echo test",
				commandExecutionTimeout: timeoutSeconds * 1000, // Convert to milliseconds
			}

			// Verify the options object has the expected structure
			expect(options.commandExecutionTimeout).toBe(15000)
			expect(typeof options.commandExecutionTimeout).toBe("number")
		})

		it("should handle timeout parameter in function signature", () => {
			// Test that the executeCommandInTerminal function accepts timeout parameter
			// This is a compile-time check that the types are correct
			const mockOptions = {
				executionId: "test-id",
				command: "echo test",
				customCwd: undefined,
				terminalShellIntegrationDisabled: false,
				terminalOutputLineLimit: 500,
				commandExecutionTimeout: 0,
			}

			// Verify all required properties exist
			expect(mockOptions.executionId).toBeDefined()
			expect(mockOptions.command).toBeDefined()
			expect(mockOptions.commandExecutionTimeout).toBeDefined()
		})

		it("should enforce minimum CLI timeout when model timeout is set", () => {
			process.env.NJUST_AI_CLI_RUNTIME = "1"
			expect(executeCommandModule.resolveAgentTimeoutMs(30)).toBe(300_000)
		})

		it("should honor model timeout outside CLI runtime", () => {
			delete process.env.NJUST_AI_CLI_RUNTIME
			expect(executeCommandModule.resolveAgentTimeoutMs(30)).toBe(30_000)
		})

		it("does not impose a sandbox cap when commandExecutionTimeout is 0 (user disabled timeout)", async () => {
			vitest.useFakeTimers()
			const abort = vitest.fn()
			const continueProcess = vitest.fn()
			const processPromise = new Promise<void>(() => {}) as Promise<void> & {
				abort: () => void
				continue: () => void
			}
			processPromise.abort = abort
			processPromise.continue = continueProcess
			const terminal = {
				runCommand: vitest.fn().mockReturnValue(processPromise),
				getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/workspace"),
			}
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValueOnce(terminal)
			mockCline.supersedePendingAsk = vitest.fn()

			const execution = executeCommandModule.executeCommandInTerminal(mockCline as unknown as Task, {
				executionId: "background-timeout",
				command: "long-running-command",
				agentTimeout: 10,
				commandExecutionTimeout: 0,
			})

			await vitest.advanceTimersByTimeAsync(10)
			await vitest.advanceTimersByTimeAsync(50)
			await execution
			expect(continueProcess).toHaveBeenCalledOnce()
			expect(abort).not.toHaveBeenCalled()

			// With timeout=0, no sandbox cap applies — command runs indefinitely
			await vitest.advanceTimersByTimeAsync(120_000)
			expect(abort).not.toHaveBeenCalled()
		})

		it("keeps the user-configured hard timeout active after agent backgrounding", async () => {
			vitest.useFakeTimers()
			const abort = vitest.fn()
			const continueProcess = vitest.fn()
			const processPromise = new Promise<void>(() => {}) as Promise<void> & {
				abort: () => void
				continue: () => void
			}
			processPromise.abort = abort
			processPromise.continue = continueProcess
			const terminal = {
				runCommand: vitest.fn().mockReturnValue(processPromise),
				getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/workspace"),
			}
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValueOnce(terminal)

			const execution = executeCommandModule.executeCommandInTerminal(mockCline as unknown as Task, {
				executionId: "background-user-timeout",
				command: "long-running-command",
				agentTimeout: 10,
				commandExecutionTimeout: 50,
			})

			await vitest.advanceTimersByTimeAsync(10)
			expect(continueProcess).toHaveBeenCalledOnce()
			expect(abort).not.toHaveBeenCalled()

			await vitest.advanceTimersByTimeAsync(50)
			await execution
			expect(abort).toHaveBeenCalledOnce()
			expect(mockCline.didToolFailInCurrentTurn).toBe(true)
		})

		it("does not pass agentTimeout to the Docker runner as a hard timeout", async () => {
			vitest.useFakeTimers()
			let finish: ((value: any) => void) | undefined
			const run = vitest.fn(
				() =>
					new Promise((resolve) => {
						finish = resolve
					}),
			)
			const cancel = vitest.fn().mockResolvedValue(undefined)
			const service = {
				evaluatePolicyOnly: vitest.fn().mockResolvedValue("docker"),
				run,
				cancel,
				getEffectiveTimeout: vitest.fn().mockReturnValue(120_000),
			}
			const getInstance = vitest
				.spyOn(SandboxExecutionService, "getInstance")
				.mockReturnValue(service as unknown as SandboxExecutionService)

			const execution = executeCommandModule.executeCommandInTerminal(mockCline as unknown as Task, {
				executionId: "docker-background",
				command: "long-running-command",
				agentTimeout: 10,
				commandExecutionTimeout: 0,
			})
			await vitest.advanceTimersByTimeAsync(10)
			const [, response] = await execution

			expect(String(response)).toContain("still running in the Docker sandbox")
			expect(run).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 0 }))
			expect(cancel).not.toHaveBeenCalled()

			finish?.({
				executionId: "sandbox-exec",
				backend: "docker",
				exitCode: 0,
				output: "done",
				cancelled: false,
				timedOut: false,
			})
			await vitest.runAllTimersAsync()
			await vitest.waitFor(() => expect(mockCline.terminalProcess).toBeUndefined())
			getInstance.mockRestore()
		})

		it("surfaces a Docker hard timeout before the agent background timeout", async () => {
			vitest.useFakeTimers()
			const service = {
				evaluatePolicyOnly: vitest.fn().mockResolvedValue("docker"),
				run: vitest.fn(
					() =>
						new Promise((_resolve, reject) => {
							setTimeout(() => reject(new CommandTimeoutError(5_000)), 5_000)
						}),
				),
				cancel: vitest.fn().mockResolvedValue(undefined),
				getEffectiveTimeout: vitest.fn().mockReturnValue(5_000),
			}
			const getInstance = vitest
				.spyOn(SandboxExecutionService, "getInstance")
				.mockReturnValue(service as unknown as SandboxExecutionService)

			const execution = executeCommandModule.executeCommandInTerminal(mockCline as unknown as Task, {
				executionId: "docker-hard-timeout",
				command: "long-running-command",
				agentTimeout: 10_000,
				commandExecutionTimeout: 5_000,
			})
			await vitest.advanceTimersByTimeAsync(5_000)
			const [, response] = await execution

			expect(String(response)).toContain("sandbox hard timeout")
			expect(service.run).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 5_000 }))
			expect(mockCline.didToolFailInCurrentTurn).toBe(true)
			getInstance.mockRestore()
		})

		it("passes approval, safety, interactivity, and bypass metadata into sandbox audit", async () => {
			mockCline.permissionRuleEngine = { getMode: vitest.fn().mockReturnValue("bypass") }
			const unregister = vitest.fn()
			const service = {
				evaluatePolicyOnly: vitest.fn().mockResolvedValue("guarded-host"),
				evaluateAndAuditExecution: vitest.fn(),
				getEffectiveTimeout: vitest.fn().mockImplementation((requestedMs: number) => requestedMs || 120_000),
				recordExecutionComplete: vitest.fn(),
				registerExternalProcess: vitest.fn().mockReturnValue(unregister),
			}
			const getInstance = vitest
				.spyOn(SandboxExecutionService, "getInstance")
				.mockReturnValue(service as unknown as SandboxExecutionService)

			await executeCommandTool.execute({ command: "export FOO=bar" }, mockCline as unknown as Task, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
			})

			const audit = {
				approvalResult: "bypass",
				commandSafety: "unsafe",
				interactive: false,
				bypass: true,
			}
			expect(mockAskApproval).not.toHaveBeenCalled()
			expect(service.evaluatePolicyOnly).toHaveBeenCalledWith("local", expect.objectContaining({ audit }))
			expect(service.evaluateAndAuditExecution).toHaveBeenCalledWith(expect.objectContaining({ audit }))
			expect(service.registerExternalProcess).toHaveBeenCalledWith(
				"task:test-task-id:test-instance-id",
				expect.anything(),
			)
			getInstance.mockRestore()
		})

		it("aborts a registered guarded-host process when its task instance scope is disposed", async () => {
			const service = new SandboxExecutionService()
			vitest.spyOn(service, "evaluatePolicyOnly").mockResolvedValue("guarded-host")
			vitest.spyOn(service, "evaluateAndAuditExecution").mockReturnValue({
				executionId: "scoped-host-process",
				backend: "guarded-host",
			})
			vitest
				.spyOn(service, "getEffectiveTimeout")
				.mockImplementation((requestedMs: number) => requestedMs || 120_000)
			vitest.spyOn(service, "recordExecutionComplete").mockImplementation(() => {})
			const registerSpy = vitest.spyOn(service, "registerExternalProcess")
			const getInstance = vitest.spyOn(SandboxExecutionService, "getInstance").mockReturnValue(service)

			let resolveProcess!: () => void
			let terminalCallbacks: any
			const processPromise = new Promise<void>((resolve) => {
				resolveProcess = resolve
			}) as any
			processPromise.command = "long-running-command"
			processPromise.isHot = true
			processPromise.run = vitest.fn()
			processPromise.continue = vitest.fn()
			processPromise.hasUnretrievedOutput = vitest.fn().mockReturnValue(false)
			processPromise.getUnretrievedOutput = vitest.fn().mockReturnValue("")
			processPromise.trimRetrievedOutput = vitest.fn()
			processPromise.abort = vitest.fn(() => {
				void Promise.resolve(terminalCallbacks.onCompleted("", processPromise)).finally(resolveProcess)
			})
			const terminal = {
				runCommand: vitest.fn((_command, callbacks) => {
					terminalCallbacks = callbacks
					return processPromise
				}),
				getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/workspace"),
			}
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValueOnce(terminal)

			try {
				const execution = executeCommandModule.executeCommandInTerminal(mockCline as unknown as Task, {
					executionId: "scoped-host-process",
					command: "long-running-command",
				})
				await vitest.waitFor(() => expect(registerSpy).toHaveBeenCalled())

				await service.disposeScope("task:test-task-id:test-instance-id")
				await execution

				expect(registerSpy).toHaveBeenCalledWith("task:test-task-id:test-instance-id", processPromise)
				expect(processPromise.abort).toHaveBeenCalledOnce()
			} finally {
				getInstance.mockRestore()
			}
		})

		it("records a failed audit when terminal acquisition rejects", async () => {
			const terminalError = new Error("terminal unavailable")
			const service = {
				evaluatePolicyOnly: vitest.fn().mockResolvedValue("guarded-host"),
				evaluateAndAuditExecution: vitest.fn(),
				getEffectiveTimeout: vitest.fn().mockImplementation((requestedMs: number) => requestedMs || 120_000),
				recordExecutionComplete: vitest.fn(),
				registerExternalProcess: vitest.fn().mockReturnValue(vitest.fn()),
			}
			const getInstance = vitest
				.spyOn(SandboxExecutionService, "getInstance")
				.mockReturnValue(service as unknown as SandboxExecutionService)
			;(TerminalRegistry.getOrCreateTerminal as any).mockRejectedValueOnce(terminalError)

			const execution = executeCommandModule.executeCommandInTerminal(mockCline as unknown as Task, {
				executionId: "terminal-acquisition-error",
				command: "echo test",
			})

			await expect(execution).rejects.toBe(terminalError)
			const auditedRequest = service.evaluateAndAuditExecution.mock.calls[0][0]
			expect(service.recordExecutionComplete).toHaveBeenCalledWith(
				auditedRequest.executionId,
				expect.objectContaining({
					executionId: auditedRequest.executionId,
					backend: "guarded-host",
					cancelled: false,
					timedOut: false,
				}),
				terminalError,
			)
			expect(service.recordExecutionComplete).toHaveBeenCalledTimes(1)
			getInstance.mockRestore()
		})

		it("records one failed audit and rethrows when a VS Code terminal cannot be shown", async () => {
			const showError = new Error("terminal show failed")
			const service = {
				evaluatePolicyOnly: vitest.fn().mockResolvedValue("guarded-host"),
				evaluateAndAuditExecution: vitest.fn(),
				getEffectiveTimeout: vitest.fn().mockImplementation((requestedMs: number) => requestedMs || 120_000),
				recordExecutionComplete: vitest.fn(),
				registerExternalProcess: vitest.fn().mockReturnValue(vitest.fn()),
			}
			const terminal = Object.assign(Object.create(Terminal.prototype), {
				terminal: {
					show: vitest.fn(() => {
						throw showError
					}),
				},
				runCommand: vitest.fn(),
				getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/workspace"),
			})
			const getInstance = vitest
				.spyOn(SandboxExecutionService, "getInstance")
				.mockReturnValue(service as unknown as SandboxExecutionService)
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValueOnce(terminal)

			const execution = executeCommandModule.executeCommandInTerminal(mockCline as unknown as Task, {
				executionId: "terminal-show-error",
				command: "echo test",
			})

			await expect(execution).rejects.toBe(showError)
			expect(service.recordExecutionComplete).toHaveBeenCalledTimes(1)
			expect(service.recordExecutionComplete).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ backend: "guarded-host" }),
				showError,
			)
			expect(terminal.runCommand).not.toHaveBeenCalled()
			getInstance.mockRestore()
		})

		it("records one failed audit and rethrows when terminal cwd lookup fails", async () => {
			const cwdError = new Error("terminal cwd failed")
			const service = {
				evaluatePolicyOnly: vitest.fn().mockResolvedValue("guarded-host"),
				evaluateAndAuditExecution: vitest.fn(),
				getEffectiveTimeout: vitest.fn().mockImplementation((requestedMs: number) => requestedMs || 120_000),
				recordExecutionComplete: vitest.fn(),
				registerExternalProcess: vitest.fn().mockReturnValue(vitest.fn()),
			}
			const terminal = Object.assign(Object.create(Terminal.prototype), {
				terminal: { show: vitest.fn() },
				runCommand: vitest.fn(),
				getCurrentWorkingDirectory: vitest.fn(() => {
					throw cwdError
				}),
			})
			const getInstance = vitest
				.spyOn(SandboxExecutionService, "getInstance")
				.mockReturnValue(service as unknown as SandboxExecutionService)
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValueOnce(terminal)

			const execution = executeCommandModule.executeCommandInTerminal(mockCline as unknown as Task, {
				executionId: "terminal-cwd-error",
				command: "echo test",
			})

			await expect(execution).rejects.toBe(cwdError)
			expect(service.recordExecutionComplete).toHaveBeenCalledTimes(1)
			expect(service.recordExecutionComplete).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ backend: "guarded-host" }),
				cwdError,
			)
			expect(terminal.runCommand).not.toHaveBeenCalled()
			getInstance.mockRestore()
		})

		it("records a failed audit when runCommand throws synchronously", async () => {
			const runError = new Error("terminal launch failed")
			const service = {
				evaluatePolicyOnly: vitest.fn().mockResolvedValue("guarded-host"),
				evaluateAndAuditExecution: vitest.fn(),
				getEffectiveTimeout: vitest.fn().mockImplementation((requestedMs: number) => requestedMs || 120_000),
				recordExecutionComplete: vitest.fn(),
				registerExternalProcess: vitest.fn().mockReturnValue(vitest.fn()),
			}
			const terminal = {
				runCommand: vitest.fn(() => {
					throw runError
				}),
				getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/workspace"),
			}
			const getInstance = vitest
				.spyOn(SandboxExecutionService, "getInstance")
				.mockReturnValue(service as unknown as SandboxExecutionService)
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValueOnce(terminal)

			const execution = executeCommandModule.executeCommandInTerminal(mockCline as unknown as Task, {
				executionId: "terminal-run-error",
				command: "echo test",
			})

			await expect(execution).rejects.toBe(runError)
			const auditedRequest = service.evaluateAndAuditExecution.mock.calls[0][0]
			expect(service.recordExecutionComplete).toHaveBeenCalledWith(
				auditedRequest.executionId,
				expect.objectContaining({
					executionId: auditedRequest.executionId,
					backend: "guarded-host",
					cancelled: false,
					timedOut: false,
				}),
				runError,
			)
			expect(service.recordExecutionComplete).toHaveBeenCalledTimes(1)
			getInstance.mockRestore()
		})

		it("aborts the process and records one failed audit when scope registration fails", async () => {
			const registrationError = new Error("scope registration failed")
			const abort = vitest.fn()
			const processPromise = Object.assign(Promise.resolve(), { abort, continue: vitest.fn() })
			const service = {
				evaluatePolicyOnly: vitest.fn().mockResolvedValue("guarded-host"),
				evaluateAndAuditExecution: vitest.fn(),
				getEffectiveTimeout: vitest.fn().mockImplementation((requestedMs: number) => requestedMs || 120_000),
				recordExecutionComplete: vitest.fn(),
				registerExternalProcess: vitest.fn(() => {
					throw registrationError
				}),
			}
			const terminal = {
				runCommand: vitest.fn().mockReturnValue(processPromise),
				getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/workspace"),
			}
			const getInstance = vitest
				.spyOn(SandboxExecutionService, "getInstance")
				.mockReturnValue(service as unknown as SandboxExecutionService)
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValueOnce(terminal)

			const execution = executeCommandModule.executeCommandInTerminal(mockCline as unknown as Task, {
				executionId: "terminal-registration-error",
				command: "echo test",
			})

			await expect(execution).rejects.toBe(registrationError)
			expect(abort).toHaveBeenCalledOnce()
			expect(service.recordExecutionComplete).toHaveBeenCalledTimes(1)
			expect(service.recordExecutionComplete).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ backend: "guarded-host" }),
				registrationError,
			)
			getInstance.mockRestore()
		})
	})
})
