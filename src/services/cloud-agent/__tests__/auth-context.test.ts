import { describe, it, expect, vi, afterEach } from "vitest"
import {
	createAuthContext,
	unauthenticatedContext,
	checkToolExecutionAuth,
	type AuthTokenSource,
} from "../auth-context"
import { executeDeferredToolCall } from "../executeDeferredToolCall"
import type { DeferredToolCall } from "../types"
import { execReadFile } from "../../mcp-server/tool-executors"

vi.mock("../../mcp-server/tool-executors", () => ({
	execReadFile: vi.fn(() => Promise.resolve("file content")),
	execWriteFile: vi.fn(() => Promise.resolve("file written")),
	execListFiles: vi.fn(() => Promise.resolve("file1\nfile2")),
	execSearchFiles: vi.fn(() => Promise.resolve("search results")),
	execCommand: vi.fn(() => Promise.resolve("command executed")),
	execApplyDiff: vi.fn(() => Promise.resolve("diff applied")),
}))

// ─── AuthContext factory & check ─────────────────────────────────────────────

describe("AuthContext — explicit parameter model", () => {
	describe("createAuthContext", () => {
		it("creates an authenticated context", () => {
			const ctx = createAuthContext("profile-1", "api-key")
			expect(ctx.authenticated).toBe(true)
			expect(ctx.tokenSource).toBe("api-key")
			expect(ctx.profileId).toBe("profile-1")
		})

		it("supports all token sources", () => {
			const sources: AuthTokenSource[] = [
				"global-device-token",
				"profile-device-token",
				"api-key",
				"bearer",
				"basic",
				"custom",
			]
			for (const source of sources) {
				const ctx = createAuthContext("p", source)
				expect(ctx.tokenSource).toBe(source)
			}
		})
	})

	describe("unauthenticatedContext", () => {
		it("returns an unauthenticated context", () => {
			const ctx = unauthenticatedContext()
			expect(ctx.authenticated).toBe(false)
			expect(ctx.tokenSource).toBeNull()
			expect(ctx.profileId).toBe("")
		})
	})

	describe("checkToolExecutionAuth", () => {
		it("denies when context is not authenticated", () => {
			const ctx = unauthenticatedContext()
			const result = checkToolExecutionAuth(ctx)
			expect(result.allowed).toBe(false)
			expect(result.reason).toContain("no authenticated Cloud Agent session")
		})

		it("allows when context is authenticated", () => {
			const ctx = createAuthContext("profile-1", "api-key")
			const result = checkToolExecutionAuth(ctx)
			expect(result.allowed).toBe(true)
			expect(result.reason).toBeUndefined()
		})
	})
})

// ─── No global state: no residual auth after operations ─────────────────────

describe("AuthContext — no residual global state", () => {
	it("unauthenticated context denies tool execution", () => {
		const ctx = unauthenticatedContext()
		const result = checkToolExecutionAuth(ctx)
		expect(result.allowed).toBe(false)
	})

	it("creating an authenticated context does not affect a separate unauthenticated check", () => {
		const _authed = createAuthContext("profile-1", "api-key")
		const unauthed = unauthenticatedContext()
		// Even after creating an authenticated context, the unauthenticated
		// context still denies — there is no shared global state.
		expect(checkToolExecutionAuth(unauthed).allowed).toBe(false)
	})

	it("two contexts with different profiles do not interfere", () => {
		const ctx1 = createAuthContext("profile-A", "api-key")
		const ctx2 = createAuthContext("profile-B", "bearer")
		expect(ctx1.profileId).toBe("profile-A")
		expect(ctx2.profileId).toBe("profile-B")
		expect(checkToolExecutionAuth(ctx1).allowed).toBe(true)
		expect(checkToolExecutionAuth(ctx2).allowed).toBe(true)
	})
})

// ─── executeDeferredToolCall auth enforcement ────────────────────────────────

describe("executeDeferredToolCall auth enforcement", () => {
	const cwd = "/test/workspace"

	afterEach(() => {
		vi.mocked(execReadFile).mockClear()
	})

	it("denies all tool calls when context is unauthenticated", async () => {
		const ctx = unauthenticatedContext()

		const tools: DeferredToolCall[] = [
			{ call_id: "1", tool: "read_file", arguments: { path: "test.txt" } },
			{ call_id: "2", tool: "write_file", arguments: { path: "test.txt", content: "data" } },
			{ call_id: "3", tool: "list_files", arguments: { path: "." } },
			{ call_id: "4", tool: "search_files", arguments: { path: ".", regex: "test" } },
			{ call_id: "5", tool: "execute_command", arguments: { command: "echo test" } },
			{ call_id: "6", tool: "apply_diff", arguments: { path: "test.txt", diff: "diff" } },
		]

		for (const call of tools) {
			const result = await executeDeferredToolCall(cwd, call, ctx)
			expect(result.is_error).toBe(true)
			expect(result.content).toContain("no authenticated Cloud Agent session")
		}
	})

	it("allows tool calls when context is authenticated", async () => {
		const ctx = createAuthContext("profile-1", "api-key")

		const call: DeferredToolCall = {
			call_id: "1",
			tool: "read_file",
			arguments: { path: "test.txt" },
		}

		const result = await executeDeferredToolCall(cwd, call, ctx)
		expect(result.is_error).toBe(false)
		expect(result.content).toBe("file content")
	})

	it("short-circuits before any tool executor runs when unauthenticated", async () => {
		const ctx = unauthenticatedContext()
		const mockExecReadFile = vi.mocked(execReadFile)
		mockExecReadFile.mockClear()

		const call: DeferredToolCall = {
			call_id: "1",
			tool: "read_file",
			arguments: { path: "test.txt" },
		}

		await executeDeferredToolCall(cwd, call, ctx)
		expect(mockExecReadFile).not.toHaveBeenCalled()
	})

	it("denies unknown tools even when authenticated", async () => {
		const ctx = createAuthContext("profile-1", "api-key")

		const call: DeferredToolCall = {
			call_id: "1",
			tool: "malicious_tool",
			arguments: { path: "test.txt" },
		}

		const result = await executeDeferredToolCall(cwd, call, ctx)
		expect(result.is_error).toBe(true)
		expect(result.content).toContain("Unknown tool")
	})

	it("denies tool calls with parse-failed arguments even when authenticated", async () => {
		const ctx = createAuthContext("profile-1", "api-key")

		const call: DeferredToolCall = {
			call_id: "1",
			tool: "read_file",
			arguments: { _arguments_parse_failed: true, _raw_arguments: "{invalid" },
		}

		const result = await executeDeferredToolCall(cwd, call, ctx)
		expect(result.is_error).toBe(true)
		expect(result.content).toContain("Invalid JSON")
	})
})

// ─── Concurrency isolation ──────────────────────────────────────────────────

describe("AuthContext — concurrency isolation", () => {
	const cwd = "/test/workspace"

	it("two concurrent tasks with different contexts do not interfere", async () => {
		const ctxA = createAuthContext("task-A", "api-key")
		const ctxB = unauthenticatedContext()

		const call: DeferredToolCall = {
			call_id: "1",
			tool: "read_file",
			arguments: { path: "test.txt" },
		}

		// Run both concurrently
		const [resultA, resultB] = await Promise.all([
			executeDeferredToolCall(cwd, call, ctxA),
			executeDeferredToolCall(cwd, call, ctxB),
		])

		expect(resultA.is_error).toBe(false)
		expect(resultA.content).toBe("file content")
		expect(resultB.is_error).toBe(true)
		expect(resultB.content).toContain("no authenticated Cloud Agent session")
	})

	it("one task failure does not affect another task", async () => {
		const ctxA = createAuthContext("task-A", "api-key")
		const ctxB = createAuthContext("task-B", "bearer")

		const failCall: DeferredToolCall = {
			call_id: "fail",
			tool: "unknown_tool",
			arguments: {},
		}
		const okCall: DeferredToolCall = {
			call_id: "ok",
			tool: "read_file",
			arguments: { path: "test.txt" },
		}

		const [resultA, resultB] = await Promise.all([
			executeDeferredToolCall(cwd, failCall, ctxA),
			executeDeferredToolCall(cwd, okCall, ctxB),
		])

		expect(resultA.is_error).toBe(true)
		expect(resultB.is_error).toBe(false)
		expect(resultB.content).toBe("file content")
	})
})

// ─── Token isolation ─────────────────────────────────────────────────────────

describe("AuthContext — token isolation", () => {
	it("AuthContext does not contain token value", () => {
		const ctx = createAuthContext("profile-1", "api-key")
		const json = JSON.stringify(ctx)
		// The context should only contain authenticated, tokenSource, profileId
		// No actual token/secret values
		expect(json).not.toContain("secret")
		expect(json).not.toContain("password")
		expect(Object.keys(ctx)).toEqual(["authenticated", "tokenSource", "profileId"])
	})

	it("error messages do not leak token source details", () => {
		const ctx = unauthenticatedContext()
		const result = checkToolExecutionAuth(ctx)
		// The error message describes auth requirements generically;
		// it must not contain actual profile IDs, secret values, or
		// specific token-source identifiers like "api-key" or "bearer".
		expect(result.reason).not.toContain("api-key")
		expect(result.reason).not.toContain("bearer")
		expect(result.reason).not.toContain("basic")
		expect(result.reason).not.toContain("custom")
	})
})
