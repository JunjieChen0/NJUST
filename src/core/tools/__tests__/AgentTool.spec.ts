import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { AgentTool, resolveSubAgentTools } from "../AgentTool"

function createCallbacks() {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
	}
}

function createTask(overrides: Record<string, unknown> = {}) {
	const host = {
		getTaskStackSize: vi.fn().mockReturnValue(1),
		delegateParentAndOpenChild: vi.fn().mockResolvedValue({ taskId: "child-1", taskCompleted: true }),
	}
	return {
		taskId: "parent-1",
		consecutiveMistakeCount: 0,
		recordToolError: vi.fn(),
		didToolFailInCurrentTurn: false,
		sayAndCreateMissingParamError: vi.fn().mockResolvedValue("missing task"),
		providerRef: { deref: () => host },
		getTaskMode: vi.fn().mockResolvedValue("code"),
		getBackgroundSignal: vi.fn().mockReturnValue(new Promise(() => undefined)),
		cangjieRuntimePolicy: { noteAgentDelegation: vi.fn() },
		userMessageContentReady: false,
		isPaused: false,
		ask: vi.fn().mockResolvedValue(true),
		host,
		...overrides,
	} as any
}

describe("AgentTool", () => {
	let tool: AgentTool

	beforeEach(() => {
		tool = new AgentTool()
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.clearAllTimers()
	})

	it("exposes agent metadata", () => {
		expect(tool.userFacingName()).toBe("Agent")
		expect(tool.searchHint).toContain("sub-agent")
	})

	it("reports lost provider reference", async () => {
		const task = createTask({ providerRef: { deref: () => undefined } })
		const callbacks = createCallbacks()

		await tool.execute({ task: "inspect" }, task, callbacks as any)

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Provider reference lost"))
	})

	it("enforces the concurrent sub-agent limit", async () => {
		const task = createTask()
		task.host.getTaskStackSize.mockReturnValue(4)
		const callbacks = createCallbacks()

		await tool.execute({ task: "inspect" }, task, callbacks as any)

		expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("concurrent agent limit reached"))
		expect(task.host.delegateParentAndOpenChild).not.toHaveBeenCalled()
	})

	it("does not spawn when approval is denied", async () => {
		const task = createTask()
		const callbacks = createCallbacks()
		callbacks.askApproval.mockResolvedValueOnce(false)

		await tool.execute({ task: "inspect", agentType: "explore" }, task, callbacks as any)

		expect(callbacks.askApproval).toHaveBeenCalledWith("tool", expect.stringContaining('"agentType":"explore"'))
		expect(task.host.delegateParentAndOpenChild).not.toHaveBeenCalled()
	})

	it("spawns an approved explore sub-agent with forked isolation", async () => {
		const task = createTask()
		const callbacks = createCallbacks()

		await tool.execute({ task: "inspect files", agentType: "explore", maxTurns: 3 }, task, callbacks as any)

		expect(task.host.delegateParentAndOpenChild).toHaveBeenCalledWith(
			expect.objectContaining({
				parentTaskId: "parent-1",
				mode: "code",
				isolationLevel: "forked",
				initialTodos: [],
				allowedTools: expect.arrayContaining(["read_file", "search_files"]),
				message: expect.stringContaining("[Sub-Agent Type: explore]"),
			}),
		)
		const message = task.host.delegateParentAndOpenChild.mock.calls[0][0].message as string
		expect(message).toContain("read_file, search_files")
		expect(message).toContain("maximum of 3 conversation turns")
		expect(callbacks.pushToolResult).toHaveBeenCalledWith("Delegated to sub-agent (explore); awaiting completion.")
		expect(task.userMessageContentReady).toBe(true)
	})

	it("publishes the delegation result before creating the child", async () => {
		const task = createTask()
		const callbacks = createCallbacks()
		task.host.delegateParentAndOpenChild.mockImplementationOnce(async () => {
			expect(task.isPaused).toBe(true)
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				"Delegated to sub-agent (explore); awaiting completion.",
			)
			return { taskId: "child-1" }
		})

		await tool.execute({ task: "inspect", agentType: "explore" }, task, callbacks as any)

		expect(task.host.delegateParentAndOpenChild).toHaveBeenCalledOnce()
	})

	it("spawns CangjieVerify with its enforced read-only tool allowlist", async () => {
		const task = createTask({ getTaskMode: vi.fn().mockResolvedValue("cangjie") })
		const callbacks = createCallbacks()
		callbacks.askApproval.mockResolvedValueOnce(false)

		await tool.execute({ task: "run cjpm build", agentType: "CangjieVerify" }, task, callbacks as any)

		expect(callbacks.askApproval).not.toHaveBeenCalled()
		const options = task.host.delegateParentAndOpenChild.mock.calls[0][0]
		expect(options.allowedTools).toEqual(resolveSubAgentTools("CangjieVerify"))
		expect(options.allowedTools).toContain("execute_command")
		expect(options.allowedTools).toContain("attempt_completion")
		expect(options.allowedTools).not.toContain("write_to_file")
		expect(options.message).toContain("[Sub-Agent Type: CangjieVerify]")
		expect(options.message).toContain("You are CangjieVerify")
		expect(options.message).toContain("You MUST NOT modify files")
		expect(options.agentType).toBe("CangjieVerify")
		expect(task.cangjieRuntimePolicy.noteAgentDelegation).not.toHaveBeenCalled()
	})

	it("spawns CangjieImplement with the native apply_patch edit path", async () => {
		const task = createTask({ getTaskMode: vi.fn().mockResolvedValue("cangjie") })
		const callbacks = createCallbacks()

		await tool.execute({ task: "add a function", agentType: "CangjieImplement" }, task, callbacks as any)

		const options = task.host.delegateParentAndOpenChild.mock.calls[0][0]
		expect(options.allowedTools).toContain("apply_patch")
		expect(options.allowedTools).toContain("execute_command")
		expect(options.allowedTools).toContain("attempt_completion")
		expect(options.allowedTools).not.toContain("write_to_file")
		expect(options.allowedTools).not.toContain("apply_diff")
		expect(options.message).toContain("Use apply_patch for edits")
	})

	it("inherits parent tools for custom agents", async () => {
		const task = createTask()
		const callbacks = createCallbacks()

		await tool.execute({ task: "custom work", agentType: "custom" }, task, callbacks as any)

		expect(task.host.delegateParentAndOpenChild.mock.calls[0][0].allowedTools).toBeUndefined()
	})

	it("delegates spawn failures to handleError", async () => {
		const task = createTask()
		task.host.delegateParentAndOpenChild.mockRejectedValueOnce(new Error("spawn failed"))
		const callbacks = createCallbacks()

		await tool.execute({ task: "inspect" }, task, callbacks as any)

		expect(callbacks.handleError).toHaveBeenCalledWith(
			"creating sub-agent",
			expect.objectContaining({ message: "spawn failed" }),
		)
		expect(task.isPaused).toBe(false)
	})

	it("shows partial agent approval content", async () => {
		const task = createTask()

		await tool.handlePartial(task, {
			params: { task: "inspect files" },
			nativeArgs: { agentType: "verify" },
			partial: true,
		} as any)

		expect(task.ask).toHaveBeenCalledWith(
			"tool",
			JSON.stringify({ tool: "agent", agentType: "verify", content: "inspect files" }),
			true,
		)
	})
})
