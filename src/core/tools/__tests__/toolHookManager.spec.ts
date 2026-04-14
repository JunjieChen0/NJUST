import { describe, expect, it, vi } from "vitest"

import { ToolHookManager } from "../ToolHookManager"

describe("ToolHookManager", () => {
	it("short-circuits pre-hooks when a hook denies execution", async () => {
		const mgr = new ToolHookManager()
		mgr.registerPreHook(async () => ({ allow: true, modifiedInput: { path: "a.ts" } }))
		mgr.registerPreHook(async () => ({ allow: false, reason: "blocked by policy" }))

		const result = await mgr.runPreHooks("read_file", { path: "x.ts" }, { taskId: "t1" } as any)
		expect(result.allow).toBe(false)
		expect(result.reason).toBe("blocked by policy")
	})

	it("propagates modified input across pre-hooks", async () => {
		const mgr = new ToolHookManager()
		mgr.registerPreHook(async (_tool, input) => ({ allow: true, modifiedInput: { ...input, a: 1 } }))
		mgr.registerPreHook(async (_tool, input) => ({ allow: true, modifiedInput: { ...input, b: 2 } }))

		const result = await mgr.runPreHooks("search_files", { q: "x" }, { taskId: "t2" } as any)
		expect(result.allow).toBe(true)
		expect(result.modifiedInput).toEqual({ q: "x", a: 1, b: 2 })
	})

	it("runs post-hooks and failure-hooks without throwing on hook errors", async () => {
		const mgr = new ToolHookManager()
		const postSpy = vi.fn(async () => undefined)
		const failureSpy = vi.fn(async () => undefined)
		mgr.registerPostHook(async () => {
			throw new Error("post hook failure")
		})
		mgr.registerPostHook(postSpy)
		mgr.registerFailureHook(async () => {
			throw new Error("failure hook failure")
		})
		mgr.registerFailureHook(failureSpy)

		await expect(
			mgr.runPostHooks("tool_search", { q: "abc" }, "ok" as any, { taskId: "t3" } as any),
		).resolves.toBeUndefined()
		await expect(
			mgr.runFailureHooks("tool_search", { q: "abc" }, new Error("tool error"), { taskId: "t3" } as any),
		).resolves.toBeUndefined()

		expect(postSpy).toHaveBeenCalledTimes(1)
		expect(failureSpy).toHaveBeenCalledTimes(1)
	})
})
