import { beforeEach, describe, expect, it, vi } from "vitest"

import { powerShellTool, PowerShellTool } from "../PowerShellTool"

function createTask(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/workspace",
		consecutiveMistakeCount: 0,
		ask: vi.fn().mockResolvedValue(true),
		...overrides,
	} as any
}

function createCallbacks() {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
	}
}

describe("PowerShellTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("metadata", () => {
		it("should defer loading", () => {
			expect(powerShellTool.shouldDefer).toBe(true)
		})

		it("has search hint", () => {
			expect(powerShellTool.searchHint).toContain("powershell")
		})
	})

	describe("isAvailable", () => {
		it("returns true on win32", () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "win32" })
			expect(PowerShellTool.isAvailable()).toBe(true)
			Object.defineProperty(process, "platform", { value: originalPlatform })
		})

		it("returns false on non-win32", () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, "platform", { value: "linux" })
			expect(PowerShellTool.isAvailable()).toBe(false)
			Object.defineProperty(process, "platform", { value: originalPlatform })
		})
	})

	describe("validateInput", () => {
		it("rejects empty command", () => {
			const result = powerShellTool.validateInput({ command: "" })
			expect(result.valid).toBe(false)
			expect(result.error).toContain("required")
		})

		it("rejects whitespace-only command", () => {
			const result = powerShellTool.validateInput({ command: "   " })
			expect(result.valid).toBe(false)
			expect(result.error).toContain("required")
		})

		it("accepts valid command", () => {
			const result = powerShellTool.validateInput({ command: "Get-Process" })
			expect(result.valid).toBe(true)
		})
	})

	describe("execute", () => {
		it("prepares encoded command and asks for approval", async () => {
			const task = createTask()
			const callbacks = createCallbacks()

			await powerShellTool.execute({ command: "Get-Process" }, task, callbacks as any)

			expect(callbacks.askApproval).toHaveBeenCalledWith(
				"command",
				expect.stringContaining("powershell.exe -NoProfile -NonInteractive -EncodedCommand"),
			)
			expect(task.consecutiveMistakeCount).toBe(0)
		})

		it("pushes result with prepared command info on approval", async () => {
			const callbacks = createCallbacks()

			await powerShellTool.execute({ command: "Get-Process" }, createTask(), callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("PowerShell command prepared"),
			)
		})

		it("encodes command in base64", async () => {
			const callbacks = createCallbacks()
			const command = "Write-Host 'Hello'"
			const expectedBase64 = Buffer.from(command, "utf-8").toString("base64")

			await powerShellTool.execute({ command }, createTask(), callbacks as any)

			expect(callbacks.askApproval).toHaveBeenCalledWith("command", expect.stringContaining(expectedBase64))
		})

		it("does not push result when approval is denied", async () => {
			const callbacks = createCallbacks()
			callbacks.askApproval.mockResolvedValue(false)

			await powerShellTool.execute({ command: "Get-Process" }, createTask(), callbacks as any)

			expect(callbacks.pushToolResult).not.toHaveBeenCalled()
		})

		it("delegates errors to handleError", async () => {
			const callbacks = createCallbacks()
			callbacks.askApproval.mockImplementation(() => {
				throw new Error("approval system down")
			})

			await powerShellTool.execute({ command: "Get-Process" }, createTask(), callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith(
				"executing PowerShell command",
				expect.objectContaining({ message: "approval system down" }),
			)
		})
	})

	describe("handlePartial", () => {
		it("asks with partial command message", async () => {
			const task = createTask()

			await powerShellTool.handlePartial(task, {
				params: { command: "Get-Process" },
				partial: true,
			} as any)

			expect(task.ask).toHaveBeenCalledWith("command", expect.stringContaining("Get-Process"))
		})
	})
})
