import { describe, it, expect, vi } from "vitest"

import type { ToolUse } from "../../../shared/tools"
import type { Task } from "../../task/Task"
import { customToolRegistry } from "@njust-ai/core/custom-tools"
import { getBuiltInAgent } from "../../agent/builtInAgents"

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
	it("keeps a verifier read-only and never blocks on a clarification prompt", async () => {
		const ask = vi.fn()
		const task = makeTask({
			taskMode: "cangjie",
			agentType: "CangjieVerify",
			parentTaskId: "parent",
			ask,
			say: vi.fn(),
		})
		// CangjieVerify is an unattended verifier: its tool list intentionally omits
		// ask_followup_question because a followup ask waits indefinitely for a human.
		const allowed = [...getBuiltInAgent("CangjieVerify")!.tools]
		expect(allowed).not.toContain("ask_followup_question")

		const clarification: ToolUse = {
			type: "tool_use",
			name: "ask_followup_question",
			params: {},
			nativeArgs: { question: "上界是否包含100？", follow_up: [{ text: "包含" }, { text: "不包含" }] },
			partial: false,
		}

		for (const denied of [
			clarification,
			writeBlock,
			{ ...writeBlock, name: "execute_command", nativeArgs: { command: "cjpm test > result.txt" } },
		] as ToolUse[]) {
			expect(await validateToolUseBlock(task, denied, "denied", "cangjie", [], {}, undefined, allowed)).toBe(
				false,
			)
		}
		expect(ask).not.toHaveBeenCalled()
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
