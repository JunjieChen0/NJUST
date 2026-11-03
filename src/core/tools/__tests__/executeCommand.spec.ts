//
// Tests the ExecuteCommand tool itself vs calling the tool where the tool is mocked.
//
import { describe, it, expect, beforeEach, vi } from "vitest"

import * as path from "path"
import * as fs from "fs/promises"

import { ExecuteCommandOptions } from "../ExecuteCommandTool"
import { TerminalRegistry } from "../../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../../integrations/terminal/Terminal"
import { ExecaTerminal } from "../../../integrations/terminal/ExecaTerminal"
import { TerminalProcess } from "../../../integrations/terminal/TerminalProcess"
import { mergePromise } from "../../../integrations/terminal/mergePromise"
import type { RooTerminalCallbacks } from "../../../integrations/terminal/types"
import { withCjpmProjectLock } from "../../../services/cangjie-lsp/cjpmProjectLock"

// Mock fs to control directory existence checks
vitest.mock("fs/promises")

// Mock TerminalRegistry to control terminal creation
vitest.mock("../../../integrations/terminal/TerminalRegistry")

// Mock Terminal and ExecaTerminal classes
vitest.mock("../../../integrations/terminal/Terminal")
vitest.mock("../../../integrations/terminal/ExecaTerminal")

// Import the actual executeCommand function (not mocked)
import { executeCommandInTerminal } from "../ExecuteCommandTool"

// Tests for the executeCommand function
describe("executeCommand", () => {
	let mockTask: any
	let mockTerminal: any
	let mockProcess: any
	let mockProvider: any

	beforeEach(() => {
		vitest.clearAllMocks()

		// Mock fs.access to simulate directory existence
		;(fs.access as any).mockResolvedValue(undefined)

		// Create mock provider
		mockProvider = {
			postMessageToWebview: vitest.fn(),
			getState: vitest.fn().mockResolvedValue({
				terminalShellIntegrationDisabled: false,
			}),
			context: {
				extensionPath: "/mock/extension/path",
			},
		}

		// Create mock task
		mockTask = {
			cwd: "/test/project",
			taskId: "test-task-123",
			providerRef: {
				deref: vitest.fn().mockReturnValue(mockProvider),
			},
			say: vitest.fn().mockResolvedValue(undefined),
			terminalProcess: undefined,
		}

		// Create mock process that resolves immediately
		mockProcess = Promise.resolve()
		mockProcess.continue = vitest.fn()

		// Create mock terminal with getCurrentWorkingDirectory method
		mockTerminal = {
			provider: "vscode",
			id: 1,
			initialCwd: "/test/project",
			getCurrentWorkingDirectory: vitest.fn().mockReturnValue("/test/project"),
			runCommand: vitest.fn().mockReturnValue(mockProcess),
			terminal: {
				show: vitest.fn(),
			},
		}

		// Mock TerminalRegistry.getOrCreateTerminal
		;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockTerminal)
	})

	describe("Working Directory Behavior", () => {
		it("waits for baseline cleanup and the save-time build before starting cjpm", async () => {
			let finishBaseline!: () => void
			let finishBuild!: () => void
			const baseline = new Promise<void>((resolve) => {
				finishBaseline = resolve
			})
			const saveBuild = withCjpmProjectLock(
				mockTask.cwd,
				() =>
					new Promise<void>((resolve) => {
						finishBuild = resolve
					}),
			)
			mockTask.cangjieVerification = { preemptBaseline: vi.fn(() => baseline) }
			mockTerminal.runCommand.mockImplementation((_command: string, callbacks: RooTerminalCallbacks) => {
				setTimeout(() => {
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					void callbacks.onCompleted("build complete", mockProcess)
				}, 0)
				return mockProcess
			})
			const execution = executeCommandInTerminal(mockTask, { executionId: "locked", command: "cjpm build" })
			try {
				await vi.waitFor(() => expect(mockTask.cangjieVerification.preemptBaseline).toHaveBeenCalled())
				expect(mockTerminal.runCommand).not.toHaveBeenCalled()
				finishBaseline()
				await new Promise((resolve) => setTimeout(resolve, 10))
				expect(mockTerminal.runCommand).not.toHaveBeenCalled()
			} finally {
				finishBaseline()
				finishBuild()
				await Promise.all([saveBuild, execution])
			}
			expect(mockTerminal.runCommand).toHaveBeenCalledTimes(1)
		})

		it.each(["agent timeout", "user feedback"])(
			"releases the project lock as soon as cjpm moves to the background (%s)",
			async (cause) => {
				let callbacks!: RooTerminalCallbacks
				let continueProcess!: () => void
				const process = mergePromise(
					Object.assign(new TerminalProcess(mockTerminal), {
						continue: () => continueProcess(),
						abort: vi.fn(),
					}),
					new Promise<void>((resolve) => {
						continueProcess = resolve
					}),
				)
				mockTask.supersedePendingAsk = vi.fn()
				mockTask.ask = vi.fn().mockResolvedValue({ response: "messageResponse", text: "continue" })
				mockTerminal.runCommand.mockImplementation((_command: string, cb: RooTerminalCallbacks) => {
					callbacks = cb
					if (cause === "user feedback")
						queueMicrotask(() => {
							void cb.onLine("running", process)
						})
					return process
				})
				await executeCommandInTerminal(mockTask, {
					executionId: "background",
					command: "cjpm test",
					agentTimeout: cause === "agent timeout" ? 1 : 0,
				})
				let acquired = false
				const nextBuild = withCjpmProjectLock(mockTask.cwd, async () => {
					acquired = true
				})
				try {
					await new Promise((resolve) => setTimeout(resolve, 10))
					expect(acquired).toBe(true)
				} finally {
					callbacks.onShellExecutionComplete({ exitCode: 0 }, process)
					await callbacks.onCompleted("done", process)
					await nextBuild
				}
				expect(acquired).toBe(true)
			},
		)

		it("releases the cjpm lock when the terminal cannot start", async () => {
			mockTerminal.runCommand.mockImplementationOnce(() => {
				throw new Error("spawn failed")
			})

			await expect(
				executeCommandInTerminal(mockTask, { executionId: "startup-failed", command: "cjpm build" }),
			).rejects.toThrow("spawn failed")
			await expect(withCjpmProjectLock(mockTask.cwd, async () => "released")).resolves.toBe("released")
		})

		it("does not start cjpm after cancellation while waiting for the project lock", async () => {
			let finishBuild!: () => void
			const build = withCjpmProjectLock(
				mockTask.cwd,
				() =>
					new Promise<void>((resolve) => {
						finishBuild = resolve
					}),
			)
			await vi.waitFor(() => expect(finishBuild).toBeDefined())
			const execution = executeCommandInTerminal(mockTask, { executionId: "cancelled", command: "cjpm build" })
			mockTask.abort = true
			finishBuild()

			await expect(execution).resolves.toEqual([false, expect.stringMatching(/cancelled/)])
			await build
			expect(mockTerminal.runCommand).not.toHaveBeenCalled()
			await expect(withCjpmProjectLock(mockTask.cwd, async () => "released")).resolves.toBe("released")
		})

		it("should use terminal.getCurrentWorkingDirectory() in the output message for completed commands", async () => {
			// Setup: Mock terminal to return a different current working directory
			const initialCwd = "/test/project"
			const currentCwd = "/test/project/subdirectory"

			mockTask.cwd = initialCwd
			mockTerminal.initialCwd = initialCwd
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(currentCwd)

			// Mock the terminal process to complete successfully
			mockTerminal.runCommand.mockImplementation(function (command: string, callbacks: RooTerminalCallbacks) {
				// Simulate command completion
				setTimeout(async () => {
					await callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(mockTerminal.getCurrentWorkingDirectory).toHaveBeenCalled()
			expect(result).toContain(`within working directory '${currentCwd}'`)
			expect(result).not.toContain(`within working directory '${initialCwd}'`)
		})

		it("should use terminal.getCurrentWorkingDirectory() for VSCode Terminal with shell integration", async () => {
			// Setup: Mock VSCode Terminal instance
			const vscodeTerminal = new Terminal(1, undefined, "/test/project")
			const mockVSCodeTerminal = vscodeTerminal as any

			// Mock shell integration providing different cwd
			mockVSCodeTerminal.terminal = {
				show: vitest.fn(),
				shellIntegration: {
					cwd: { fsPath: "/test/project/changed-dir" },
				},
			}
			mockVSCodeTerminal.getCurrentWorkingDirectory = vitest.fn().mockReturnValue("/test/project/changed-dir")
			mockVSCodeTerminal.runCommand = vitest.fn(function (command: string, callbacks: RooTerminalCallbacks) {
				setTimeout(async () => {
					await callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockVSCodeTerminal)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("within working directory '/test/project/changed-dir'")
		})

		it("should use terminal.getCurrentWorkingDirectory() for ExecaTerminal (always returns initialCwd)", async () => {
			// Setup: Mock ExecaTerminal instance
			const execaTerminal = new ExecaTerminal(1, "/test/project")
			const mockExecaTerminal = execaTerminal as any

			// ExecaTerminal always returns initialCwd
			mockExecaTerminal.getCurrentWorkingDirectory = vitest.fn().mockReturnValue("/test/project")
			mockExecaTerminal.runCommand = vitest.fn(function (command: string, callbacks: RooTerminalCallbacks) {
				setTimeout(async () => {
					await callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})
			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockExecaTerminal)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: true, // Forces ExecaTerminal
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(mockExecaTerminal.getCurrentWorkingDirectory).toHaveBeenCalled()
			expect(result).toContain("within working directory '/test/project'")
		})
	})

	describe("Custom Working Directory", () => {
		it("should reject an absolute custom cwd that escapes the task workspace", async () => {
			// Security: an absolute path outside `task.cwd` must NOT be honoured,
			// even if the agent supplies it. See resolveWithinWorkspace.
			const customCwd = "/custom/absolute/path"

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd,
				terminalShellIntegrationDisabled: false,
			}

			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			expect(rejected).toBe(false)
			expect(String(result)).toMatch(
				/is rejected: Target path '\/custom\/absolute\/path' resolves outside workspace/,
			)
			expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		})

		it("should handle relative custom cwd and use terminal.getCurrentWorkingDirectory() in output", async () => {
			const relativeCwd = "subdirectory"
			const resolvedCwd = path.resolve(mockTask.cwd, relativeCwd)

			mockTerminal.getCurrentWorkingDirectory.mockReturnValue(resolvedCwd)
			mockTerminal.runCommand.mockImplementation(function (command: string, callbacks: RooTerminalCallbacks) {
				setTimeout(async () => {
					await callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd: relativeCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify — terminal is created with the resolved cwd; we don't pin
			// the exact string because realpath/normalisation may rewrite it.
			expect(rejected).toBe(false)
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalled()
			expect(result).toContain(`within working directory '${resolvedCwd.toPosix()}'`)
		})

		it("should reject a relative custom cwd that climbs out via '..'", async () => {
			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd: "../escape",
				terminalShellIntegrationDisabled: false,
			}

			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			expect(rejected).toBe(false)
			expect(String(result)).toMatch(/is rejected:/)
			expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		})

		it("should return rejection error when custom working directory is outside workspace", async () => {
			const nonExistentCwd = "/non/existent/path"

			// Mock fs.access to throw error for non-existent directory
			;(fs.access as any).mockRejectedValue(new Error("Directory does not exist"))

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				customCwd: nonExistentCwd,
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify — boundary check fires before fs.access; the rejection
			// reason describes the workspace escape rather than a missing dir.
			expect(rejected).toBe(false)
			expect(String(result)).toMatch(/is rejected:/)
			expect(TerminalRegistry.getOrCreateTerminal).not.toHaveBeenCalled()
		})
	})

	describe("Terminal Provider Selection", () => {
		it("should use vscode provider when shell integration is enabled", async () => {
			mockTerminal.runCommand.mockImplementation(function (command: string, callbacks: RooTerminalCallbacks) {
				setTimeout(async () => {
					await callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(mockTask.cwd, mockTask.taskId, "vscode")
		})

		it("should use execa provider when shell integration is disabled", async () => {
			mockTerminal.runCommand.mockImplementation(function (command: string, callbacks: RooTerminalCallbacks) {
				setTimeout(async () => {
					await callbacks.onCompleted("Command output", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo test",
				terminalShellIntegrationDisabled: true,
			}

			// Execute
			await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(TerminalRegistry.getOrCreateTerminal).toHaveBeenCalledWith(mockTask.cwd, mockTask.taskId, "execa")
		})
	})

	describe("Command Execution States", () => {
		it("should handle completed command with exit code 0", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation(function (command: string, callbacks: RooTerminalCallbacks) {
				setTimeout(async () => {
					await callbacks.onCompleted("Command completed successfully", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "echo success",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("Exit code: 0")
			expect(result).toContain("within working directory '/test/project'")
		})

		it("should handle completed command with non-zero exit code", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation(function (command: string, callbacks: RooTerminalCallbacks) {
				setTimeout(async () => {
					await callbacks.onCompleted("Command failed", mockProcess)
					callbacks.onShellExecutionComplete({ exitCode: 1 }, mockProcess)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "exit 1",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("Command execution was not successful")
			expect(result).toContain("Exit code: 1")
			expect(result).toContain("within working directory '/test/project'")
		})

		it("should handle command terminated by signal", async () => {
			mockTerminal.getCurrentWorkingDirectory.mockReturnValue("/test/project")
			mockTerminal.runCommand.mockImplementation(function (command: string, callbacks: RooTerminalCallbacks) {
				setTimeout(async () => {
					await callbacks.onCompleted("Command interrupted", mockProcess)
					callbacks.onShellExecutionComplete(
						{
							exitCode: undefined,
							signalName: "SIGINT",
							coreDumpPossible: false,
						},
						mockProcess,
					)
				}, 0)
				return mockProcess
			})

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "long-running-command",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify
			expect(rejected).toBe(false)
			expect(result).toContain("Process terminated by signal SIGINT")
			expect(result).toContain("within working directory '/test/project'")
		})
	})

	describe("Terminal Working Directory Updates", () => {
		it("should update working directory when terminal returns different cwd", async () => {
			// Setup: Terminal initially at project root, but getCurrentWorkingDirectory returns different path
			const initialCwd = "/test/project"
			const updatedCwd = "/test/project/src"

			mockTask.cwd = initialCwd
			mockTerminal.initialCwd = initialCwd

			// Mock Terminal instance behavior
			const mockTerminalInstance = {
				...mockTerminal,
				terminal: { show: vitest.fn() },
				getCurrentWorkingDirectory: vitest.fn().mockReturnValue(updatedCwd),
				runCommand: vitest.fn(function (command: string, callbacks: RooTerminalCallbacks) {
					setTimeout(async () => {
						await callbacks.onCompleted("Directory changed", mockProcess)
						callbacks.onShellExecutionComplete({ exitCode: 0 }, mockProcess)
					}, 0)
					return mockProcess
				}),
			}

			;(TerminalRegistry.getOrCreateTerminal as any).mockResolvedValue(mockTerminalInstance)

			const options: ExecuteCommandOptions = {
				executionId: "test-123",
				command: "cd src && pwd",
				terminalShellIntegrationDisabled: false,
			}

			// Execute
			const [rejected, result] = await executeCommandInTerminal(mockTask, options)

			// Verify the result uses the updated working directory
			expect(rejected).toBe(false)
			expect(result).toContain(`within working directory '${updatedCwd}'`)
			expect(result).not.toContain(`within working directory '${initialCwd}'`)

			// Verify the terminal's getCurrentWorkingDirectory was called
			expect(mockTerminalInstance.getCurrentWorkingDirectory).toHaveBeenCalled()
		})
	})
})
