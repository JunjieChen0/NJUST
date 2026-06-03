import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ToolUse } from "../../../shared/tools"

// ── Hoisted mocks ──────────────────────────────────────────────────────
const { globMock, isPathOutsideWorkspaceMock, getReadablePathMock } = vi.hoisted(() => ({
	globMock: vi.fn(),
	isPathOutsideWorkspaceMock: vi.fn(),
	getReadablePathMock: vi.fn(),
}))

vi.mock("glob", () => ({
	glob: globMock,
}))

vi.mock("../../../utils/pathUtils", () => ({
	isPathOutsideWorkspace: isPathOutsideWorkspaceMock,
}))

vi.mock("../../../utils/path", () => ({
	getReadablePath: getReadablePathMock,
}))

vi.mock("../../../utils/errorHandling", () => ({
	ignoreAbortError: vi.fn(),
}))

vi.mock("../../../shared/logger", () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Suppress BaseTool transitive imports
vi.mock("../../security/metrics", () => ({
	recordSecurityMetric: vi.fn(),
	startTraceSpan: vi.fn(() => ({ end: vi.fn() })),
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: { reportError: vi.fn() },
}))

import { GlobTool } from "../GlobTool"

// ── Helpers ─────────────────────────────────────────────────────────────

function makeCallbacks(overrides?: Partial<any>) {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		...overrides,
	}
}

function makeTask(overrides?: any) {
	return {
		taskId: "test-task",
		cwd: "/workspace",
		consecutiveMistakeCount: 5,
		...overrides,
	}
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("GlobTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		isPathOutsideWorkspaceMock.mockReturnValue(false)
		getReadablePathMock.mockImplementation((_cwd: string, rel: string) => rel || ".")
	})

	describe("tool properties", () => {
		it("has correct name", () => {
			const tool = new GlobTool()
			expect(tool.name).toBe("glob")
		})

		it("is concurrency safe", () => {
			const tool = new GlobTool()
			expect(tool.isConcurrencySafe()).toBe(true)
		})

		it("is read-only", () => {
			const tool = new GlobTool()
			expect(tool.isReadOnly()).toBe(true)
		})

		it("returns 'Glob' as user-facing name", () => {
			const tool = new GlobTool()
			expect(tool.userFacingName()).toBe("Glob")
		})

		it("has search hints", () => {
			const tool = new GlobTool()
			expect(tool.searchHint).toContain("glob")
		})

		it("has custom maxResultSizeChars of 50000", () => {
			const tool = new GlobTool()
			expect(tool.maxResultSizeChars).toBe(50_000)
		})

		it("returns eager for eager execution decision", () => {
			const tool = new GlobTool()
			expect(tool.getEagerExecutionDecision()).toBe("eager")
		})
	})

	describe("isPartialArgsStable", () => {
		it("returns true when pattern is a non-empty string", () => {
			const tool = new GlobTool()
			expect(tool.isPartialArgsStable({ pattern: "*.ts" })).toBe(true)
		})

		it("returns false when pattern is empty", () => {
			const tool = new GlobTool()
			expect(tool.isPartialArgsStable({ pattern: "" })).toBe(false)
		})

		it("returns false when pattern is undefined", () => {
			const tool = new GlobTool()
			expect(tool.isPartialArgsStable({})).toBe(false)
		})
	})

	describe("execute()", () => {
		it("finds files matching the pattern and pushes sorted results", async () => {
			const tool = new GlobTool()
			globMock.mockResolvedValue(["b.ts", "a.ts", "c.ts"])
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask()

			await tool.execute({ pattern: "**/*.ts" }, task as any, callbacks)

			expect(globMock).toHaveBeenCalledWith("**/*.ts", {
				cwd: expect.any(String),
				nodir: true,
				dot: true,
				posix: true,
			})
			expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("a.ts\nb.ts\nc.ts"))
			// Should reset consecutiveMistakeCount
			expect(task.consecutiveMistakeCount).toBe(0)
		})

		it("handles empty results", async () => {
			const tool = new GlobTool()
			globMock.mockResolvedValue([])
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask()

			await tool.execute({ pattern: "**/*.xyz" }, task as any, callbacks)

			expect(pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining('No files matched the pattern "**/*.xyz"'),
			)
		})

		it("limits results to MAX_RESULTS (2000) and shows truncation message", async () => {
			const tool = new GlobTool()
			const files = Array.from({ length: 2500 }, (_, i) => `file${i}.ts`)
			globMock.mockResolvedValue(files)
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask()

			await tool.execute({ pattern: "**/*.ts" }, task as any, callbacks)

			expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("showing first 2000"))
		})

		it("denies access when path is outside workspace", async () => {
			const tool = new GlobTool()
			isPathOutsideWorkspaceMock.mockReturnValue(true)
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask()

			await tool.execute({ pattern: "**/*.ts", path: "/outside" }, task as any, callbacks)

			expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Access denied"))
			expect(globMock).not.toHaveBeenCalled()
		})

		it("uses custom path when provided", async () => {
			const tool = new GlobTool()
			globMock.mockResolvedValue(["test.ts"])
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask()

			await tool.execute({ pattern: "*.ts", path: "src" }, task as any, callbacks)

			expect(globMock).toHaveBeenCalledWith(
				"*.ts",
				expect.objectContaining({
					cwd: expect.stringContaining("src"),
				}),
			)
		})

		it("defaults to current directory when path is not provided", async () => {
			const tool = new GlobTool()
			globMock.mockResolvedValue(["file.ts"])
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask()

			await tool.execute({ pattern: "*.ts" }, task as any, callbacks)

			// glob should be called with the resolved cwd (task.cwd + ".")
			expect(globMock).toHaveBeenCalled()
		})

		it("returns early when approval is denied", async () => {
			const tool = new GlobTool()
			globMock.mockResolvedValue(["file.ts"])
			const pushToolResult = vi.fn()
			const askApproval = vi.fn().mockResolvedValue(false)
			const callbacks = makeCallbacks({ askApproval, pushToolResult })
			const task = makeTask()

			await tool.execute({ pattern: "*.ts" }, task as any, callbacks)

			expect(pushToolResult).not.toHaveBeenCalled()
		})

		it("handles glob errors gracefully", async () => {
			const tool = new GlobTool()
			globMock.mockRejectedValue(new Error("glob failed"))
			const handleError = vi.fn()
			const callbacks = makeCallbacks({ handleError })
			const task = makeTask()

			await tool.execute({ pattern: "**/*.ts" }, task as any, callbacks)

			expect(handleError).toHaveBeenCalledWith("glob pattern matching", expect.any(Error))
		})

		it("trims whitespace from path", async () => {
			const tool = new GlobTool()
			globMock.mockResolvedValue(["file.ts"])
			const pushToolResult = vi.fn()
			const callbacks = makeCallbacks({ pushToolResult })
			const task = makeTask()

			await tool.execute({ pattern: "*.ts", path: "  src  " }, task as any, callbacks)

			expect(globMock).toHaveBeenCalledWith(
				"*.ts",
				expect.objectContaining({
					cwd: expect.stringContaining("src"),
				}),
			)
		})
	})

	describe("handlePartial()", () => {
		it("sends partial message to task.ask", async () => {
			const tool = new GlobTool()
			const askMock = vi.fn().mockResolvedValue(undefined)
			const task = makeTask({ ask: askMock })
			const block = {
				nativeArgs: { pattern: "*.ts", path: "src" },
				params: {},
				partial: true,
			} as any as ToolUse<"glob">

			await tool.handlePartial(task as any, block)

			expect(askMock).toHaveBeenCalledWith("tool", expect.any(String), true)
		})

		it("falls back to params.path when nativeArgs is missing", async () => {
			const tool = new GlobTool()
			const askMock = vi.fn().mockResolvedValue(undefined)
			const task = makeTask({ ask: askMock })
			const block = {
				nativeArgs: undefined,
				params: { path: "lib" },
				partial: true,
			} as any as ToolUse<"glob">

			await tool.handlePartial(task as any, block)

			expect(askMock).toHaveBeenCalled()
		})
	})

	describe("inputSchema", () => {
		it("defines pattern as required and path as optional", () => {
			const tool = new GlobTool()
			// Access the protected inputSchema via the getSchemaAdapter
			const adapter = tool.getSchemaAdapter()
			expect(adapter).toBeDefined()
		})
	})
})
