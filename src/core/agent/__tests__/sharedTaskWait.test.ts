import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { waitForTaskCompletion } from "../sharedTaskWait"
import type { AgentTaskLike } from "../AgentTaskController"

function makeTask(overrides: Partial<AgentTaskLike>): AgentTaskLike {
	return { clineMessages: [], didFinishAbortingStream: false, abandoned: false, ...overrides } as AgentTaskLike
}

const wait = (task: AgentTaskLike) => waitForTaskCompletion(task, { pollIntervalMs: 1 })

describe("waitForTaskCompletion", () => {
	beforeEach(() => vi.useFakeTimers())
	afterEach(() => vi.useRealTimers())

	/** Attach the assertion before advancing timers so no rejection goes unhandled. */
	async function runPoll(assertion: Promise<unknown>): Promise<void> {
		await vi.advanceTimersByTimeAsync(10)
		await assertion
	}

	it("resolves with the completion result", async () => {
		const task = makeTask({ clineMessages: [{ type: "say", say: "completion_result", text: "done" }] as never })
		await runPoll(expect(wait(task)).resolves.toBe("done"))
	})

	it("rejects with the task's error when it aborted after an error", async () => {
		const task = makeTask({
			didFinishAbortingStream: true,
			clineMessages: [{ type: "say", say: "error", text: "boom" }] as never,
		})
		await runPoll(expect(wait(task)).rejects.toThrow("boom"))
	})

	it("rejects (instead of resolving as success) when the task was aborted without an error", async () => {
		await runPoll(expect(wait(makeTask({ didFinishAbortingStream: true }))).rejects.toThrow(/cancel/i))
	})

	it("rejects when the task was abandoned", async () => {
		await runPoll(expect(wait(makeTask({ abandoned: true }))).rejects.toThrow(/cancel/i))
	})
})
