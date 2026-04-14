import { describe, expect, it, vi } from "vitest"

import { ErrorRecoveryHandler } from "../ErrorRecoveryHandler"

describe("ErrorRecoveryHandler", () => {
	it("bypasses condense when compact failures exceed threshold", () => {
		const task = {
			compactFailureCount: 3,
			maxCompactFailures: 3,
		} as any
		const handler = new ErrorRecoveryHandler(task)
		expect(handler.shouldBypassCondense()).toBe(true)
	})

	it("records compact failure and increments counter", async () => {
		const say = vi.fn(async () => undefined)
		const task = {
			compactFailureCount: 0,
			maxCompactFailures: 3,
			say,
		} as any
		const handler = new ErrorRecoveryHandler(task)

		await handler.recordCompactFailure("compact failed")
		expect(task.compactFailureCount).toBe(1)
		expect(say).toHaveBeenCalledWith("condense_context_error", "compact failed")
	})

	it("resets compact failure counter after success", () => {
		const task = {
			compactFailureCount: 2,
			maxCompactFailures: 3,
		} as any
		const handler = new ErrorRecoveryHandler(task)

		handler.resetCompactFailure()
		expect(task.compactFailureCount).toBe(0)
	})
})
