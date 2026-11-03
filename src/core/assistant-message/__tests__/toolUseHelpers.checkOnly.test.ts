import { describe, it, expect, vi } from "vitest"

import type { ToolUse } from "../../../shared/tools"
import type { Task } from "../../task/Task"
import { customToolRegistry } from "@njust-ai/core/custom-tools"

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: { reportError: vi.fn() },
}))

const { validateToolUseBlock } = await import("../toolUseHelpers")

function makeTask(overrides: Record<string, unknown>): Task {
	return {
		api: { getModel: () => ({ id: "m", info: {} }) },
		consecutiveMistakeCount: 0,
		recordToolError: vi.fn(),
		pushToolResultToUserContent: vi.fn(),
		cangjieRuntimePolicy: {
			validateAgentStageToolUse: () => null,
			isCheckOnlyRoute: () => true,
		},
		...overrides,
	} as Task
}

const writeBlock: ToolUse = {
	type: "tool_use",
	name: "write_to_file",
	params: { path: "src/main.cj", content: "main() {}" },
	nativeArgs: { path: "src/main.cj", content: "main() {}" },
	partial: false,
} as ToolUse

describe("validateToolUseBlock check-only isolation", () => {
	it("rejects a custom writer by its registered name", async () => {
		const has = vi.spyOn(customToolRegistry, "has").mockImplementation((name) => name === "write_project_file")
		try {
			const task = makeTask({ taskMode: "cangjie" })
			const block: ToolUse = { ...writeBlock, name: "write_project_file" as ToolUse["name"] }

			const ok = await validateToolUseBlock(
				task,
				block,
				"custom-1",
				"cangjie",
				[],
				{ customTools: true },
				undefined,
				undefined,
			)

			expect(ok).toBe(false)
			expect(task.pushToolResultToUserContent).toHaveBeenCalledWith(
				expect.objectContaining({ content: expect.stringMatching(/check-only/i) }),
			)
		} finally {
			has.mockRestore()
		}
	})

	it("rejects writes in a check-only Cangjie task", async () => {
		const task = makeTask({ taskMode: "cangjie" })

		const ok = await validateToolUseBlock(task, writeBlock, "call-1", "cangjie", [], {}, undefined, undefined)

		expect(ok).toBe(false)
		expect(task.pushToolResultToUserContent).toHaveBeenCalledWith(
			expect.objectContaining({ is_error: true, content: expect.stringMatching(/check-only/i) }),
		)
	})

	it("does not apply the route-based guard after the task leaves Cangjie mode", async () => {
		const task = makeTask({ taskMode: "code" })

		await validateToolUseBlock(task, writeBlock, "call-1", "code", [], {}, undefined, undefined)

		expect(task.pushToolResultToUserContent).not.toHaveBeenCalledWith(
			expect.objectContaining({ content: expect.stringMatching(/check-only/i) }),
		)
	})

	it("rejects writes from read-only Cangjie agents in any mode", async () => {
		const task = makeTask({
			taskMode: "code",
			agentType: "CangjieVerify",
			parentTaskId: "parent",
			cangjieRuntimePolicy: { validateAgentStageToolUse: () => null, isCheckOnlyRoute: () => false },
		})

		const ok = await validateToolUseBlock(task, writeBlock, "call-1", "code", [], {}, undefined, undefined)

		expect(ok).toBe(false)
		expect(task.pushToolResultToUserContent).toHaveBeenCalledWith(
			expect.objectContaining({ content: expect.stringMatching(/check-only/i) }),
		)
	})
})
