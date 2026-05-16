import { describe, expect, it, vi } from "vitest"

import { PermissionContext } from "../PermissionContext"

describe("PermissionContext", () => {
	it("resolves once and ignores later decisions", async () => {
		const context = new PermissionContext()
		const wait = context.waitForDecision()

		expect(context.allow("hook", "ok")).toBe(true)
		expect(context.deny("ui", "late")).toBe(false)

		await expect(wait).resolves.toEqual({ decision: "allow", source: "hook", message: "ok" })
		expect(context.isResolved).toBe(true)
		expect(context.result?.decision).toBe("allow")
	})

	it.each([
		["allow", "classifier"],
		["deny", "remote"],
		["abort", "ui"],
	] as const)("supports %s shorthand", (method, source) => {
		const context = new PermissionContext()

		expect(context[method](source, "msg")).toBe(true)
		expect(context.result).toEqual({ decision: method, source, message: "msg" })
	})

	it("returns resolved decision immediately", async () => {
		const context = new PermissionContext()
		context.deny("ui")

		await expect(context.waitForDecision()).resolves.toEqual({ decision: "deny", source: "ui", message: undefined })
	})

	it("ignores resolve callback errors", async () => {
		const context = new PermissionContext()
		const wait = context.waitForDecision()
		;(context as any)._resolveCallbacks.push(() => {
			throw new Error("callback failed")
		})

		expect(context.abort("remote")).toBe(true)

		await expect(wait).resolves.toMatchObject({ decision: "abort", source: "remote" })
	})

	it("resolves timeout default decision", async () => {
		vi.useFakeTimers()
		const context = new PermissionContext()
		const wait = context.waitForDecisionWithTimeout(25, "abort")
		await vi.advanceTimersByTimeAsync(25)

		await expect(wait).resolves.toMatchObject({
			decision: "abort",
			source: "auto_approval",
			message: "Permission timed out after 25ms",
		})
		vi.useRealTimers()
	})

	it("does not override an already resolved timeout wait", async () => {
		vi.useFakeTimers()
		const context = new PermissionContext()
		const wait = context.waitForDecisionWithTimeout(25)
		context.allow("ui")
		await vi.advanceTimersByTimeAsync(25)

		await expect(wait).resolves.toMatchObject({ decision: "allow", source: "ui" })
		vi.useRealTimers()
	})

	it("dispose clears waiters without resolving", () => {
		const context = new PermissionContext()
		void context.waitForDecision()

		context.dispose()

		expect(context.isResolved).toBe(false)
		expect(context.allow()).toBe(true)
	})
})
