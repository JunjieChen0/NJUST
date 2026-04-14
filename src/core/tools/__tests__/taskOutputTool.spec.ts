import { describe, expect, it, vi } from "vitest"

vi.mock("../../task-persistence", () => ({
	readTaskMessages: vi.fn(),
}))

import { readTaskMessages } from "../../task-persistence"
import { taskOutputTool } from "../TaskOutputTool"

describe("TaskOutputTool", () => {
	it("returns paginated task output", async () => {
		vi.mocked(readTaskMessages).mockResolvedValue([
			{ role: "assistant", content: "m1" } as any,
			{ role: "assistant", content: "m2" } as any,
			{ role: "assistant", content: "m3" } as any,
		])

		const task = {
			globalStoragePath: "/tmp",
			sayAndCreateMissingParamError: vi.fn(),
		} as any
		const pushToolResult = vi.fn()

		await taskOutputTool.execute({ taskId: "t-1", offset: 1, limit: 1 }, task, { pushToolResult } as any)

		const raw = pushToolResult.mock.calls[0][0] as string
		const parsed = JSON.parse(raw)
		expect(parsed.taskId).toBe("t-1")
		expect(parsed.offset).toBe(1)
		expect(parsed.limit).toBe(1)
		expect(parsed.returned).toBe(1)
		expect(parsed.hasMore).toBe(true)
	})

	it("returns error when read fails", async () => {
		vi.mocked(readTaskMessages).mockRejectedValue(new Error("boom"))
		const task = {
			globalStoragePath: "/tmp",
			sayAndCreateMissingParamError: vi.fn(),
		} as any
		const pushToolResult = vi.fn()

		await taskOutputTool.execute({ taskId: "t-1" }, task, { pushToolResult } as any)
		expect(pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Failed to read task output"))
	})
})
