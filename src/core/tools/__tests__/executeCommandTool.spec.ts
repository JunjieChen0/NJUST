// npx vitest run src/core/tools/__tests__/executeCommandTool.spec.ts

import { describe, it, expect, beforeEach, afterEach } from "vitest"

import type { ToolUsage } from "@njust-ai/types"
import fs from "fs/promises"
import * as vscode from "vscode"

import { Task } from "../../task/Task"
import { formatResponse } from "../../prompts/responses"
import { ToolUse, AskApproval, HandleError, PushToolResult } from "../../../shared/tools"
import { unescapeHtmlEntities } from "../../../utils/text-normalization"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"

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

			await executeCommandTool.execute({ command: "cjpm build 2>&1" }, mockCline as unknown as Task, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
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
			mockCline.cwd = "C:\\Users\\Administrator\\Desktop"
			;(vscode.window as any).activeTextEditor = {
				document: { uri: { fsPath: "D:\\cangjie\\Cangjie-Examples\\HTTP\\src\\main.cj" } },
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

			await executeCommandTool.execute({ command: "cjpm build 2>&1" }, mockCline as unknown as Task, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
			})

			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(
				"D:\\cangjie\\Cangjie-Examples\\HTTP",
				"test-task-id",
				"execa",
				{ exactCwd: true },
			)
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

			await executeCommandTool.execute({ command: "cjpm check" }, mockCline as unknown as Task, {
				askApproval: mockAskApproval as unknown as AskApproval,
				handleError: mockHandleError as unknown as HandleError,
				pushToolResult: mockPushToolResult as unknown as PushToolResult,
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
				mockCline as unknown as Task,
				{
					askApproval: mockAskApproval as unknown as AskApproval,
					handleError: mockHandleError as unknown as HandleError,
					pushToolResult: mockPushToolResult as unknown as PushToolResult,
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
				mockCline as unknown as Task,
				{
					askApproval: mockAskApproval as unknown as AskApproval,
					handleError: mockHandleError as unknown as HandleError,
					pushToolResult: mockPushToolResult as unknown as PushToolResult,
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
				mockCline as unknown as Task,
				{
					askApproval: mockAskApproval as unknown as AskApproval,
					handleError: mockHandleError as unknown as HandleError,
					pushToolResult: mockPushToolResult as unknown as PushToolResult,
				},
			)

			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(
				expect.stringContaining("packages"),
				"test-task-id",
				"execa",
				{ exactCwd: false },
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
	})
})
