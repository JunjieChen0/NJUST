// npx vitest run src/integrations/terminal/__tests__/TerminalRegistry.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

import * as vscode from "vscode"
import { Terminal } from "../Terminal"
import { TerminalRegistry } from "../TerminalRegistry"

const PAGER = process.platform === "win32" ? "" : "cat"

vi.mock("execa", () => ({
	execa: vi.fn(),
}))

describe("TerminalRegistry", () => {
	let mockCreateTerminal: any

	beforeEach(() => {
		;(TerminalRegistry as any).terminals = []
		;(TerminalRegistry as any).nextTerminalId = 1
		mockCreateTerminal = vi.spyOn(vscode.window, "createTerminal").mockImplementation(
			(..._args: any[]) =>
				({
					exitStatus: undefined,
					name: "NJUST_AI",
					processId: Promise.resolve(123),
					creationOptions: {},

					state: {
						isInteractedWith: true,
						shell: { id: "test-shell", executable: "/bin/bash", args: [] },
					},

					dispose: vi.fn(),
					hide: vi.fn(),
					show: vi.fn(),
					sendText: vi.fn(),

					shellIntegration: {
						executeCommand: vi.fn(),
					},
				}) as any,
		)
	})

	describe("createTerminal", () => {
		it("creates terminal with PAGER set appropriately for platform", () => {
			TerminalRegistry.createTerminal("/test/path", "vscode")

			expect(mockCreateTerminal).toHaveBeenCalledWith({
				cwd: "/test/path",
				name: "NJUST_AI",
				iconPath: expect.any(Object),
				env: {
					PAGER,
					NJUST_AI_ACTIVE: "true",
					VTE_VERSION: "0",
					PROMPT_EOL_MARK: "",
				},
			})
		})

		it("adds PROMPT_COMMAND when Terminal.getCommandDelay() > 0", () => {
			// Set command delay to 50ms for this test
			const originalDelay = Terminal.getCommandDelay()
			Terminal.setCommandDelay(50)

			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "NJUST_AI",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						NJUST_AI_ACTIVE: "true",
						PROMPT_COMMAND: "sleep 0.05",
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
					},
				})
			} finally {
				// Restore original delay
				Terminal.setCommandDelay(originalDelay)
			}
		})

		it("adds Oh My Zsh integration env var when enabled", () => {
			Terminal.setTerminalZshOhMy(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "NJUST_AI",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						NJUST_AI_ACTIVE: "true",
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
						ITERM_SHELL_INTEGRATION_INSTALLED: "Yes",
					},
				})
			} finally {
				Terminal.setTerminalZshOhMy(false)
			}
		})

		it("adds Powerlevel10k integration env var when enabled", () => {
			Terminal.setTerminalZshP10k(true)
			try {
				TerminalRegistry.createTerminal("/test/path", "vscode")

				expect(mockCreateTerminal).toHaveBeenCalledWith({
					cwd: "/test/path",
					name: "NJUST_AI",
					iconPath: expect.any(Object),
					env: {
						PAGER,
						NJUST_AI_ACTIVE: "true",
						VTE_VERSION: "0",
						PROMPT_EOL_MARK: "",
						POWERLEVEL9K_TERM_SHELL_INTEGRATION: "true",
					},
				})
			} finally {
				Terminal.setTerminalZshP10k(false)
			}
		})
	})

	describe("getOrCreateTerminal", () => {
		it("reuses a task terminal with a different cwd by default", async () => {
			const existingTerminal = TerminalRegistry.createTerminal("/home/user/Desktop", "execa")
			existingTerminal.taskId = "task-1"

			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/workspace", "task-1", "execa")

			expect(terminal).toBe(existingTerminal)
			expect(terminal.getCurrentWorkingDirectory()).toBe("/home/user/Desktop")
		})

		it("does not reuse a task terminal with a different cwd when exactCwd is required", async () => {
			const existingTerminal = TerminalRegistry.createTerminal("/home/user/Desktop", "execa")
			existingTerminal.taskId = "task-1"

			const terminal = await TerminalRegistry.getOrCreateTerminal("/test/workspace", "task-1", "execa", {
				exactCwd: true,
			})

			expect(terminal).not.toBe(existingTerminal)
			expect(terminal.getCurrentWorkingDirectory()).toBe("/test/workspace")
		})
	})
})
