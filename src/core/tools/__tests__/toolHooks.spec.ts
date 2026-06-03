import { describe, it, expect, vi } from "vitest"
import type {
	ToolHookContext,
	LifecycleHookContext,
	PreToolUseHook,
	PostToolUseHook,
	PostToolUseFailureHook,
	PermissionDeniedHook,
	SessionStartHook,
	SessionEndHook,
	SetupHook,
	StopHook,
	SubagentStartHook,
	SubagentStopHook,
	PreCompactHook,
	PostCompactHook,
	PreCompactHookContext,
	PostCompactHookContext,
	HookEventType,
	HookExecutionOrder,
} from "../toolHooks"

// ── Tests ────────────────────────────────────────────────────────────────

describe("toolHooks type definitions", () => {
	describe("ToolHookContext", () => {
		it("has required fields: taskId, toolUseId, cwd", () => {
			const ctx: ToolHookContext = {
				taskId: "task-1",
				toolUseId: "use-1",
				cwd: "/workspace",
			}
			expect(ctx.taskId).toBe("task-1")
			expect(ctx.toolUseId).toBe("use-1")
			expect(ctx.cwd).toBe("/workspace")
		})
	})

	describe("LifecycleHookContext", () => {
		it("supports optional taskId, cwd, and metadata", () => {
			const empty: LifecycleHookContext = {}
			expect(empty.taskId).toBeUndefined()

			const full: LifecycleHookContext = {
				taskId: "t1",
				cwd: "/ws",
				metadata: { key: "value" },
			}
			expect(full.taskId).toBe("t1")
			expect(full.metadata).toEqual({ key: "value" })
		})
	})

	describe("PreToolUseHook", () => {
		it("can allow execution", async () => {
			const hook: PreToolUseHook = async (_toolName, _input, _context) => ({
				allow: true,
			})
			const result = await hook("read_file", {}, { taskId: "t1", toolUseId: "u1", cwd: "." })
			expect(result.allow).toBe(true)
		})

		it("can block execution with a reason", async () => {
			const hook: PreToolUseHook = async () => ({
				allow: false,
				reason: "blocked by policy",
			})
			const result = await hook("write_to_file", {}, { taskId: "t1", toolUseId: "u1", cwd: "." })
			expect(result.allow).toBe(false)
			expect(result.reason).toBe("blocked by policy")
		})

		it("can modify input", async () => {
			const hook: PreToolUseHook = async (_toolName, input) => ({
				allow: true,
				modifiedInput: { ...input, normalized: true },
			})
			const result = await hook("edit", { path: "test.ts" }, { taskId: "t1", toolUseId: "u1", cwd: "." })
			expect(result.allow).toBe(true)
			expect(result.modifiedInput).toEqual({ path: "test.ts", normalized: true })
		})
	})

	describe("PostToolUseHook", () => {
		it("receives tool name, input, result, and context", async () => {
			const spy = vi.fn()
			const hook: PostToolUseHook = async (toolName, input, result, _context) => {
				spy(toolName, input, result, _context)
			}
			const ctx: ToolHookContext = { taskId: "t1", toolUseId: "u1", cwd: "." }
			await hook("read_file", { path: "x.ts" }, "file contents" as any, ctx)

			expect(spy).toHaveBeenCalledWith("read_file", { path: "x.ts" }, "file contents", ctx)
		})
	})

	describe("PostToolUseFailureHook", () => {
		it("receives error information", async () => {
			const spy = vi.fn()
			const hook: PostToolUseFailureHook = async (toolName, _input, error, _context) => {
				spy(toolName, error.message)
			}
			await hook("edit", {}, new Error("file not found"), {
				taskId: "t1",
				toolUseId: "u1",
				cwd: ".",
			})

			expect(spy).toHaveBeenCalledWith("edit", "file not found")
		})
	})

	describe("PermissionDeniedHook", () => {
		it("receives denial reason", async () => {
			const spy = vi.fn()
			const hook: PermissionDeniedHook = async (toolName, _input, reason, _context) => {
				spy(toolName, reason)
			}
			await hook("write_to_file", { path: "secret.ts" }, "not allowed", {
				taskId: "t1",
				toolUseId: "u1",
				cwd: ".",
			})

			expect(spy).toHaveBeenCalledWith("write_to_file", "not allowed")
		})
	})

	describe("SessionStartHook", () => {
		it("receives lifecycle context", async () => {
			const spy = vi.fn()
			const hook: SessionStartHook = async (context) => {
				spy(context.taskId)
			}
			await hook({ taskId: "session-1", cwd: "/ws" })
			expect(spy).toHaveBeenCalledWith("session-1")
		})
	})

	describe("SessionEndHook", () => {
		it("receives lifecycle context with optional aborted flag", async () => {
			const spy = vi.fn()
			const hook: SessionEndHook = async (context) => {
				spy(context.aborted)
			}
			await hook({ taskId: "session-1", aborted: true })
			expect(spy).toHaveBeenCalledWith(true)
		})

		it("aborted flag defaults to undefined", async () => {
			const spy = vi.fn()
			const hook: SessionEndHook = async (context) => {
				spy(context.aborted)
			}
			await hook({ taskId: "session-1" })
			expect(spy).toHaveBeenCalledWith(undefined)
		})
	})

	describe("SetupHook and StopHook", () => {
		it("setup hook executes with lifecycle context", async () => {
			const spy = vi.fn()
			const hook: SetupHook = async (context) => {
				spy("setup", context.cwd)
			}
			await hook({ cwd: "/workspace" })
			expect(spy).toHaveBeenCalledWith("setup", "/workspace")
		})

		it("stop hook executes with lifecycle context", async () => {
			const spy = vi.fn()
			const hook: StopHook = async (context) => {
				spy("stop", context.cwd)
			}
			await hook({ cwd: "/workspace" })
			expect(spy).toHaveBeenCalledWith("stop", "/workspace")
		})
	})

	describe("SubagentStartHook", () => {
		it("receives parentTaskId and agentType", async () => {
			const spy = vi.fn()
			const hook: SubagentStartHook = async (parentTaskId, agentType, _context) => {
				spy(parentTaskId, agentType)
			}
			await hook("parent-1", "code-reviewer", { taskId: "parent-1" })
			expect(spy).toHaveBeenCalledWith("parent-1", "code-reviewer")
		})
	})

	describe("SubagentStopHook", () => {
		it("receives parentTaskId, agentType, and success flag", async () => {
			const spy = vi.fn()
			const hook: SubagentStopHook = async (parentTaskId, agentType, success, _context) => {
				spy(parentTaskId, agentType, success)
			}
			await hook("parent-1", "code-reviewer", true, {})
			expect(spy).toHaveBeenCalledWith("parent-1", "code-reviewer", true)
		})
	})

	describe("PreCompactHook", () => {
		it("can allow compaction", async () => {
			const hook: PreCompactHook = async (_context) => ({ allow: true })
			const ctx: PreCompactHookContext = {
				messageCount: 10,
				tokenCount: 5000,
			}
			const result = await hook(ctx)
			expect(result.allow).toBe(true)
		})

		it("can block compaction with a reason", async () => {
			const hook: PreCompactHook = async () => ({
				allow: false,
				reason: "cache is hot",
			})
			const result = await hook({ messageCount: 5, tokenCount: 2000 })
			expect(result.allow).toBe(false)
			expect(result.reason).toBe("cache is hot")
		})
	})

	describe("PostCompactHook", () => {
		it("receives before/after metrics", async () => {
			const spy = vi.fn()
			const hook: PostCompactHook = async (context) => {
				spy(context.messageCountBefore, context.messageCountAfter)
			}
			const ctx: PostCompactHookContext = {
				messageCountBefore: 20,
				messageCountAfter: 5,
				tokenCountBefore: 10000,
				tokenCountAfter: 2000,
			}
			await hook(ctx)
			expect(spy).toHaveBeenCalledWith(20, 5)
		})
	})

	describe("HookEventType union", () => {
		it("accepts all known event type strings", () => {
			const events: HookEventType[] = [
				"PreToolUse",
				"PostToolUse",
				"PostToolUseFailure",
				"PermissionDenied",
				"SessionStart",
				"SessionEnd",
				"Setup",
				"Stop",
				"SubagentStart",
				"SubagentStop",
				"PreCompact",
				"PostCompact",
			]
			expect(events).toHaveLength(12)
		})
	})

	describe("HookExecutionOrder", () => {
		it("accepts both valid order values", () => {
			const orders: HookExecutionOrder[] = ["before-permission", "after-permission"]
			expect(orders).toHaveLength(2)
			expect(orders).toContain("before-permission")
			expect(orders).toContain("after-permission")
		})
	})
})
