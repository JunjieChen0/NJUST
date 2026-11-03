import { describe, it, expect, vi } from "vitest"
import { Task } from "../Task"

function host(outcome: { overall: string; acceptance: string }) {
	const manager = {
		getStm: () => ({ summarize: () => "task summary" }),
		afterRun: vi.fn().mockResolvedValue(undefined),
	}
	const task: any = {
		memrlWrites: Promise.resolve(),
		memrlSummary: "",
		memrlIntent: "modify feature",
		taskId: "task",
		cwd: "/app",
		clineMessages: [],
		taskCompleted: false,
		hostRef: { deref: () => ({ getMemoryManager: () => manager }) },
		cangjieVerification: { getOutcome: vi.fn().mockResolvedValue(outcome) },
	}
	return { task, manager }
}

describe("Task memory uses verification facts", () => {
	it("does not recheck or overwrite memory for an abandoned task", async () => {
		const { task, manager } = host({ overall: "verified", acceptance: "accepted" })
		task.abandoned = true
		await Task.prototype.persistMemrlEpisode.call(task, "interrupted")
		expect(task.cangjieVerification.getOutcome).not.toHaveBeenCalled()
		expect(manager.afterRun).not.toHaveBeenCalled()
	})
	it.each(["no_record", "verified", "failed"])(
		"persists %s rather than converting a completion attempt to success",
		async (overall) => {
			const { task, manager } = host({ overall, acceptance: "pending" })
			task.persistMemrlEpisode = (reason: any) => Task.prototype.persistMemrlEpisode.call(task, reason)
			Task.prototype.markAttemptedCompletion.call(task)
			await task.memrlWrites
			expect(manager.afterRun).toHaveBeenCalledWith("task", "modify feature", "task summary", {
				overall,
				acceptance: "pending",
			})
		},
	)
	it.each(["verified", "failed"])("on interruption only recorded failure remains a failure (%s)", async (overall) => {
		const { task, manager } = host({ overall, acceptance: "no_delivery" })
		await Task.prototype.persistMemrlEpisode.call(task, "interrupted")
		expect(manager.afterRun.mock.calls[0][3].overall).toBe(overall === "failed" ? "failed" : "incomplete")
	})
	it.each(["pending", "accepted", "changes_requested"])(
		"preserves a verified delivery on interruption (%s)",
		async (acceptance) => {
			const { task, manager } = host({ overall: "verified", acceptance })
			await Task.prototype.persistMemrlEpisode.call(task, "interrupted")
			expect(manager.afterRun.mock.calls[0][3]).toEqual({ overall: "verified", acceptance })
		},
	)
	it("treats unreadable verification records as unknown, even when the user accepted", async () => {
		const { task, manager } = host({ overall: "verified", acceptance: "accepted" })
		task.cangjieVerification.getOutcome.mockRejectedValue(new Error("corrupt record"))
		await Task.prototype.persistMemrlEpisode.call(task, "decision")
		expect(manager.afterRun.mock.calls[0][3]).toEqual({ overall: "no_record", acceptance: "no_delivery" })
	})
	it("updates acceptance facts without manufacturing a successful verification", async () => {
		const { task, manager } = host({ overall: "incomplete", acceptance: "accepted" })
		await Task.prototype.persistMemrlEpisode.call(task, "decision")
		expect(manager.afterRun.mock.calls[0][3]).toEqual({ overall: "incomplete", acceptance: "accepted" })
	})
})
