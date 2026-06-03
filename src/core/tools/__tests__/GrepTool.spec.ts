import { beforeEach, describe, expect, it, vi } from "vitest"

const { regexSearchFilesMock, validateRegexPatternMock, isPathOutsideWorkspaceMock } = vi.hoisted(() => ({
	regexSearchFilesMock: vi.fn(),
	validateRegexPatternMock: vi.fn(),
	isPathOutsideWorkspaceMock: vi.fn(),
}))

vi.mock("../../../services/ripgrep", () => ({
	regexSearchFiles: regexSearchFilesMock,
}))

vi.mock("../../../utils/safeRegex", () => ({
	validateRegexPattern: validateRegexPatternMock,
}))

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: isPathOutsideWorkspaceMock,
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: vi.fn((_cwd: string, rel: string) => rel),
}))

import { grepTool } from "../GrepTool"

function createTask(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/workspace",
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		rooIgnoreController: {},
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

describe("GrepTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		validateRegexPatternMock.mockReturnValue({ valid: true })
		isPathOutsideWorkspaceMock.mockReturnValue(false)
		regexSearchFilesMock.mockResolvedValue("search results")
	})

	describe("metadata", () => {
		it("is concurrency safe and read only", () => {
			expect(grepTool.isConcurrencySafe()).toBe(true)
			expect(grepTool.isReadOnly()).toBe(true)
		})

		it("is eager execution", () => {
			expect(grepTool.getEagerExecutionDecision()).toBe("eager")
		})

		it("has stable partial args when pattern is non-empty", () => {
			expect(grepTool.isPartialArgsStable({ pattern: "test" })).toBe(true)
			expect(grepTool.isPartialArgsStable({ pattern: "" })).toBe(false)
			expect(grepTool.isPartialArgsStable({})).toBe(false)
		})

		it("has user-facing name and search hint", () => {
			expect(grepTool.userFacingName()).toBe("Grep")
			expect(grepTool.searchHint).toContain("grep")
		})
	})

	describe("validateInput", () => {
		it("rejects empty pattern", () => {
			const result = grepTool.validateInput({ pattern: "" })
			expect(result.valid).toBe(false)
			expect(result.error).toContain("required")
		})

		it("rejects whitespace-only pattern", () => {
			const result = grepTool.validateInput({ pattern: "   " })
			expect(result.valid).toBe(false)
			expect(result.error).toContain("required")
		})

		it("rejects unsafe regex", () => {
			validateRegexPatternMock.mockReturnValue({ valid: false, reason: "catastrophic backtracking" })
			const result = grepTool.validateInput({ pattern: "(a+)+" })
			expect(result.valid).toBe(false)
			expect(result.error).toContain("Unsafe regex")
		})

		it("accepts valid pattern", () => {
			const result = grepTool.validateInput({ pattern: "foo" })
			expect(result.valid).toBe(true)
		})
	})

	describe("execute", () => {
		it("searches files and pushes results on approval", async () => {
			const task = createTask()
			const callbacks = createCallbacks()

			await grepTool.execute({ pattern: "import", path: "src" }, task, callbacks as any)

			expect(regexSearchFilesMock).toHaveBeenCalledWith(
				"/workspace",
				expect.stringContaining("src"),
				"import",
				undefined,
				task.rooIgnoreController,
			)
			expect(callbacks.askApproval).toHaveBeenCalledWith("tool", expect.stringContaining("search results"))
			expect(callbacks.pushToolResult).toHaveBeenCalledWith("search results")
			expect(task.consecutiveMistakeCount).toBe(0)
		})

		it("defaults path to current directory when not provided", async () => {
			const task = createTask()
			const callbacks = createCallbacks()

			await grepTool.execute({ pattern: "test" }, task, callbacks as any)

			expect(regexSearchFilesMock).toHaveBeenCalledWith(
				"/workspace",
				expect.stringContaining(""),
				"test",
				undefined,
				task.rooIgnoreController,
			)
		})

		it("passes include as filePattern", async () => {
			const task = createTask()
			const callbacks = createCallbacks()

			await grepTool.execute({ pattern: "test", include: "*.ts" }, task, callbacks as any)

			expect(regexSearchFilesMock).toHaveBeenCalledWith(
				"/workspace",
				expect.any(String),
				"test",
				"*.ts",
				task.rooIgnoreController,
			)
		})

		it("does not push results when approval is denied", async () => {
			const callbacks = createCallbacks()
			callbacks.askApproval.mockResolvedValue(false)

			await grepTool.execute({ pattern: "test" }, createTask(), callbacks as any)

			expect(regexSearchFilesMock).toHaveBeenCalled()
			expect(callbacks.pushToolResult).not.toHaveBeenCalled()
		})

		it("delegates search errors to handleError", async () => {
			regexSearchFilesMock.mockRejectedValue(new Error("ripgrep crashed"))
			const callbacks = createCallbacks()

			await grepTool.execute({ pattern: "test" }, createTask(), callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith(
				"grep search",
				expect.objectContaining({ message: "ripgrep crashed" }),
			)
		})

		it("detects outside workspace paths", async () => {
			isPathOutsideWorkspaceMock.mockReturnValue(true)
			const task = createTask()
			const callbacks = createCallbacks()

			await grepTool.execute({ pattern: "test", path: "/outside" }, task, callbacks as any)

			expect(isPathOutsideWorkspaceMock).toHaveBeenCalled()
			expect(callbacks.askApproval).toHaveBeenCalledWith("tool", expect.stringContaining("true"))
		})
	})

	describe("handlePartial", () => {
		it("asks with partial tool message", async () => {
			const task = createTask()

			await grepTool.handlePartial(task, {
				params: { pattern: "test", path: "src" },
				nativeArgs: { pattern: "test", path: "src" },
				partial: true,
			} as any)

			expect(task.ask).toHaveBeenCalledWith("tool", expect.stringContaining("searchFiles"), true)
		})
	})
})
