import { describe, it, expect, vi } from "vitest"

import type { ToolUse } from "../../../shared/tools"
import type { Task } from "../../task/Task"
import { customToolRegistry } from "@njust-ai/core/custom-tools"
import { getBuiltInAgent } from "../../agent/builtInAgents"
import { AskFollowupQuestionTool } from "../../tools/AskFollowupQuestionTool"

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
	it("lets a verifier wait for clarification while writes and shell side effects remain blocked", async () => {
		let answer!: (value: { text: string }) => void
		const task = makeTask({
			taskMode: "cangjie",
			agentType: "CangjieVerify",
			parentTaskId: "parent",
			ask: vi.fn(() => new Promise((resolve) => (answer = resolve))),
			say: vi.fn(),
		})
		const allowed = [...getBuiltInAgent("CangjieVerify")!.tools]
		const params = { question: "上界是否包含100？", follow_up: [{ text: "包含" }, { text: "不包含" }] }
		const block: ToolUse = {
			type: "tool_use",
			name: "ask_followup_question",
			params: {},
			nativeArgs: params,
			partial: false,
		}
		expect(await validateToolUseBlock(task, block, "clarify", "cangjie", [], {}, undefined, allowed)).toBe(true)
		const callbacks = { pushToolResult: vi.fn(), handleError: vi.fn(), askApproval: vi.fn() }
		const pending = new AskFollowupQuestionTool().execute(params, task, callbacks)
		expect(task.ask).toHaveBeenCalledWith("followup", expect.stringContaining("100"), false)
		expect(callbacks.pushToolResult).not.toHaveBeenCalled()
		answer({ text: "包含100" })
		await pending
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("包含100"))

		for (const denied of [
			writeBlock,
			{ ...writeBlock, name: "execute_command", nativeArgs: { command: "cjpm test > result.txt" } },
		] as ToolUse[]) {
			expect(await validateToolUseBlock(task, denied, "denied", "cangjie", [], {}, undefined, allowed)).toBe(
				false,
			)
		}
	})

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
