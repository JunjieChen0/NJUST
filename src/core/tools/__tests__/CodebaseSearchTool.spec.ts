import { beforeEach, describe, expect, it, vi } from "vitest"

const {
	getWorkspacePathMock,
	codeIndexManagerGetInstanceMock,
	toolResultCacheGetMock,
	toolResultCacheSetMock,
	toolResultCacheMakeKeyMock,
} = vi.hoisted(() => ({
	getWorkspacePathMock: vi.fn(),
	codeIndexManagerGetInstanceMock: vi.fn(),
	toolResultCacheGetMock: vi.fn(),
	toolResultCacheSetMock: vi.fn(),
	toolResultCacheMakeKeyMock: vi.fn().mockReturnValue("cache-key"),
}))

vi.mock("vscode", () => ({
	workspace: {
		asRelativePath: vi.fn((filePath: string) => filePath),
	},
}))

vi.mock("../../../utils/path", () => ({
	getWorkspacePath: getWorkspacePathMock,
}))

vi.mock("../../../services/code-index/manager", () => ({
	CodeIndexManager: {
		getInstance: codeIndexManagerGetInstanceMock,
	},
}))

vi.mock("../helpers/ToolResultCache", () => ({
	toolResultCache: {
		get: toolResultCacheGetMock,
		set: toolResultCacheSetMock,
		makeKey: toolResultCacheMakeKeyMock,
	},
}))

import { codebaseSearchTool } from "../CodebaseSearchTool"

function createTask(overrides: Record<string, unknown> = {}) {
	return {
		cwd: "/workspace",
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		providerRef: {
			deref: () => ({
				context: { extensionPath: "/ext" },
			}),
		},
		say: vi.fn().mockResolvedValue(undefined),
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing query"),
		...overrides,
	} as any
}

function createCallbacks() {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
		reportProgress: vi.fn(),
	}
}

describe("CodebaseSearchTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getWorkspacePathMock.mockReturnValue("/workspace")
		toolResultCacheGetMock.mockReturnValue(undefined)
	})

	describe("metadata", () => {
		it("is concurrency safe", () => {
			expect(codebaseSearchTool.isConcurrencySafe()).toBe(true)
		})

		it("is eager execution", () => {
			expect(codebaseSearchTool.getEagerExecutionDecision()).toBe("eager")
		})

		it("has stable partial args when query is non-empty", () => {
			expect(codebaseSearchTool.isPartialArgsStable({ query: "test" })).toBe(true)
			expect(codebaseSearchTool.isPartialArgsStable({ query: "" })).toBe(false)
			expect(codebaseSearchTool.isPartialArgsStable({})).toBe(false)
		})
	})

	describe("execute", () => {
		it("returns cached result if available", async () => {
			toolResultCacheGetMock.mockReturnValue("cached result")
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "test" }, createTask(), callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith("cached result")
		})

		it("handles missing workspace path", async () => {
			getWorkspacePathMock.mockReturnValue("")
			const task = createTask({ cwd: "" })
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "test" }, task, callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith(
				"codebase_search",
				expect.objectContaining({ message: "Could not determine workspace path." }),
			)
		})

		it("handles missing query parameter", async () => {
			const task = createTask()
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "" }, task, callbacks as any)

			expect(task.consecutiveMistakeCount).toBe(1)
			expect(task.didToolFailInCurrentTurn).toBe(true)
			expect(callbacks.pushToolResult).toHaveBeenCalledWith("missing query")
		})

		it("returns denied when approval is rejected", async () => {
			const callbacks = createCallbacks()
			callbacks.askApproval.mockResolvedValue(false)

			await codebaseSearchTool.execute({ query: "test" }, createTask(), callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("denied"))
		})

		it("throws when extension context is unavailable", async () => {
			const task = createTask({
				providerRef: { deref: () => undefined },
			})
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "test" }, task, callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith(
				"codebase_search",
				expect.objectContaining({ message: expect.stringContaining("context") }),
			)
		})

		it("throws when CodeIndexManager is unavailable", async () => {
			codeIndexManagerGetInstanceMock.mockReturnValue(null)
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "test" }, createTask(), callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith(
				"codebase_search",
				expect.objectContaining({ message: expect.stringContaining("CodeIndexManager") }),
			)
		})

		it("throws when code indexing is disabled", async () => {
			codeIndexManagerGetInstanceMock.mockReturnValue({
				isFeatureEnabled: false,
				isFeatureConfigured: true,
			})
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "test" }, createTask(), callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith(
				"codebase_search",
				expect.objectContaining({ message: expect.stringContaining("disabled") }),
			)
		})

		it("throws when code indexing is not configured", async () => {
			codeIndexManagerGetInstanceMock.mockReturnValue({
				isFeatureEnabled: true,
				isFeatureConfigured: false,
			})
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "test" }, createTask(), callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith(
				"codebase_search",
				expect.objectContaining({ message: expect.stringContaining("not configured") }),
			)
		})

		it("handles empty search results", async () => {
			codeIndexManagerGetInstanceMock.mockReturnValue({
				isFeatureEnabled: true,
				isFeatureConfigured: true,
				searchIndex: vi.fn().mockResolvedValue([]),
			})
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "findFoo" }, createTask(), callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining('No relevant code snippets found for the query: "findFoo"'),
			)
		})

		it("returns formatted search results on success", async () => {
			codeIndexManagerGetInstanceMock.mockReturnValue({
				isFeatureEnabled: true,
				isFeatureConfigured: true,
				searchIndex: vi.fn().mockResolvedValue([
					{
						score: 0.95,
						payload: {
							filePath: "src/index.ts",
							startLine: 1,
							endLine: 10,
							codeChunk: "  console.log('hello')  ",
						},
					},
				]),
			})
			const task = createTask()
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "hello" }, task, callbacks as any)

			expect(task.say).toHaveBeenCalledWith("codebase_search_result", expect.stringContaining("src/index.ts"))
			const result = callbacks.pushToolResult.mock.calls[0][0] as string
			expect(result).toContain("src/index.ts")
			expect(result).toContain("0.95")
			expect(result).toContain("console.log('hello')")
			expect(task.consecutiveMistakeCount).toBe(0)
		})

		it("skips results with missing payload", async () => {
			codeIndexManagerGetInstanceMock.mockReturnValue({
				isFeatureEnabled: true,
				isFeatureConfigured: true,
				searchIndex: vi.fn().mockResolvedValue([
					{ score: 0.8, payload: null },
					{ score: 0.7, payload: { notFilePath: true } },
				]),
			})
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "test" }, createTask(), callbacks as any)

			const result = callbacks.pushToolResult.mock.calls[0][0] as string
			expect(result).toContain("Query: test")
		})

		it("delegates unexpected errors to handleError", async () => {
			codeIndexManagerGetInstanceMock.mockReturnValue({
				isFeatureEnabled: true,
				isFeatureConfigured: true,
				searchIndex: vi.fn().mockRejectedValue(new Error("index corrupted")),
			})
			const callbacks = createCallbacks()

			await codebaseSearchTool.execute({ query: "test" }, createTask(), callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith(
				"codebase_search",
				expect.objectContaining({ message: "index corrupted" }),
			)
		})
	})

	describe("handlePartial", () => {
		it("asks with partial tool message", async () => {
			const task = createTask()
			task.ask = vi.fn().mockResolvedValue(true)

			await codebaseSearchTool.handlePartial(task, {
				params: { query: "test", path: "src" },
				partial: true,
			} as any)

			expect(task.ask).toHaveBeenCalledWith("tool", expect.stringContaining("codebaseSearch"), true)
		})
	})
})
