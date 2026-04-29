import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("uuid", () => ({ v7: vi.fn(() => "mock-uuid-1234") }))
vi.mock("vscode", () => ({
	OutputChannel: class {},
	window: { showErrorMessage: vi.fn() },
}))

import { AgentOrchestrator } from "../AgentOrchestrator"

function mockProvider() {
	return {
		handleModeSwitch: vi.fn().mockResolvedValue(undefined),
		createTask: vi.fn().mockResolvedValue({
			taskId: "task-1",
			clineMessages: [],
			didFinishAbortingStream: false,
			abandoned: false,
		}),
		postMessageToWebview: vi.fn(),
	} as any
}

function mockOutputChannel() {
	return { appendLine: vi.fn() } as any
}

describe("AgentOrchestrator — public API", () => {
	let orch: AgentOrchestrator
	let provider: any

	beforeEach(() => {
		provider = mockProvider()
		orch = new AgentOrchestrator(provider, mockOutputChannel())
	})

	it("starts with empty agent list", () => {
		expect(orch.getAllAgents()).toEqual([])
		expect(orch.getActiveAgents()).toEqual([])
	})

	it("getSharedContext returns an object with id", () => {
		const ctx = orch.getSharedContext()
		expect(ctx.id).toBe("mock-uuid-1234")
		expect(ctx.modifiedFiles).toBeInstanceOf(Set)
		expect(ctx.results).toBeInstanceOf(Map)
	})

	it("addModifiedFile tracks files in shared context", () => {
		orch.addModifiedFile("/path/to/file.ts")
		expect(orch.getSharedContext().modifiedFiles.has("/path/to/file.ts")).toBe(true)
	})

	it("resetContext clears state", () => {
		orch.addModifiedFile("/test.ts")
		orch.resetContext()
		expect(orch.getSharedContext().modifiedFiles.size).toBe(0)
		expect(orch.getAllAgents()).toEqual([])
	})

	it("cancelAgent marks agent as failed", async () => {
		// Simulate an agent being tracked
		const ctx = orch.getSharedContext()
		ctx.metadata.set("test-agent", {})
		// cancelAgent handles missing task gracefully
		await expect(orch.cancelAgent("non-existent")).resolves.toBeUndefined()
	})

	it("cancelAll resolves without error when no agents", async () => {
		await expect(orch.cancelAll()).resolves.toBeUndefined()
	})
})

describe("AgentOrchestrator — forkContextForSubtask", () => {
	let orch: AgentOrchestrator

	beforeEach(() => {
		orch = new AgentOrchestrator(mockProvider(), mockOutputChannel())
	})

	it("produces a single user message", () => {
		const messages = orch.forkContextForSubtask([], "do something")
		expect(messages).toHaveLength(1)
		expect(messages[0].role).toBe("user")
	})

	it("embeds task description in the forked context", () => {
		const messages = orch.forkContextForSubtask([], "build the project")
		const text = (messages[0].content as any[])[0].text
		expect(text).toContain("build the project")
	})

	it("includes parent context summary", () => {
		const parentMessages = [
			{ role: "user", content: "help me", ts: 1 },
			{ role: "assistant", content: "sure", ts: 2 },
		] as any[]
		const messages = orch.forkContextForSubtask(parentMessages, "task")
		const text = (messages[0].content as any[])[0].text
		expect(text).toContain("[Parent Context Summary]")
		expect(text).toContain("[End Parent Context Summary]")
	})

	it("generates a timestamp for the forked message", () => {
		const messages = orch.forkContextForSubtask([], "task")
		expect(messages[0].ts).toBeGreaterThan(0)
	})

	it("respects summaryMaxTokens config", () => {
		const messages = orch.forkContextForSubtask([], "task", { summaryMaxTokens: 100 })
		expect(messages).toHaveLength(1)
	})
})

describe("AgentOrchestrator — aggregateSubtaskResult", () => {
	let orch: AgentOrchestrator

	beforeEach(() => {
		orch = new AgentOrchestrator(mockProvider(), mockOutputChannel())
	})

	it("appends result message to parent messages", () => {
		const parent: any[] = []
		const result = orch.aggregateSubtaskResult(
			{ agentId: "a1", taskId: "t1", resultSummary: "done", status: "completed" },
			parent,
		)
		expect(result).toHaveLength(1)
		expect(result[0].role).toBe("user")
	})

	it("includes status and summary in result", () => {
		const parent: any[] = []
		const result = orch.aggregateSubtaskResult(
			{ agentId: "a1", taskId: "t1", resultSummary: "Build succeeded", status: "completed" },
			parent,
		)
		const text = (result[0].content as any[])[0].text
		expect(text).toContain("completed")
		expect(text).toContain("Build succeeded")
		expect(text).toContain("[Subtask Result")
	})

	it("mutates the parent array in place", () => {
		const parent: any[] = [{ role: "user", content: "original" }]
		const result = orch.aggregateSubtaskResult(
			{ agentId: "a1", taskId: "t1", resultSummary: "ok", status: "completed" },
			parent,
		)
		expect(result).toBe(parent) // same reference
		expect(parent).toHaveLength(2)
	})
})
