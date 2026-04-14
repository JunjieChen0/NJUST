import { describe, expect, it, vi } from "vitest"

vi.mock("../../../../utils/storage", () => ({
	getTaskDirectoryPath: vi.fn(async () => "/tmp/task-dir"),
}))

vi.mock("get-folder-size", () => ({
	default: {
		loose: vi.fn(async () => 0),
	},
}))

import { taskMetadata } from "../taskMetadata"

describe("taskMetadata trace persistence", () => {
	it("persists parentTraceId into history item", async () => {
		const { historyItem } = await taskMetadata({
			taskId: "task-1",
			rootTaskId: "root-1",
			parentTaskId: "parent-1",
			parentTraceId: "trace-abc-123",
			taskNumber: 1,
			messages: [],
			globalStoragePath: "/tmp",
			workspace: "/tmp/ws",
		})

		expect(historyItem.parentTraceId).toBe("trace-abc-123")
	})
})
