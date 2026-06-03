import { beforeEach, describe, expect, it, vi } from "vitest"

const { toolErrorMock } = vi.hoisted(() => ({
	toolErrorMock: vi.fn((msg: string) => `Error: ${msg}`),
}))

vi.mock("../../prompts/responses", () => ({
	formatResponse: {
		toolError: toolErrorMock,
	},
}))

import { sendMessageTool } from "../SendMessageTool"

function createTask(overrides: Record<string, unknown> = {}) {
	return {
		taskId: "task-1",
		parentTaskId: undefined,
		consecutiveMistakeCount: 0,
		didToolFailInCurrentTurn: false,
		providerRef: {
			deref: () => ({
				findTaskInStack: vi.fn(),
				getCurrentTaskStack: vi.fn().mockReturnValue([]),
			}),
		},
		ask: vi.fn().mockResolvedValue(true),
		...overrides,
	} as any
}

function createCallbacks() {
	return {
		askApproval: vi.fn().mockResolvedValue(true),
		handleError: vi.fn(),
		pushToolResult: vi.fn(),
	}
}

describe("SendMessageTool", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("metadata", () => {
		it("has correct user-facing name", () => {
			expect(sendMessageTool.userFacingName()).toBe("Send Message")
		})

		it("has search hint", () => {
			expect(sendMessageTool.searchHint).toContain("send message")
		})

		it("is not read only", () => {
			expect(sendMessageTool.isReadOnly()).toBe(false)
		})
	})

	describe("execute", () => {
		it("returns error when provider reference is lost", async () => {
			const task = createTask({
				providerRef: { deref: () => undefined },
			})
			const callbacks = createCallbacks()

			await sendMessageTool.execute({ targetTaskId: "task-2", message: "hello" }, task, callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Provider reference lost"))
		})

		it("returns error when sending to self", async () => {
			const task = createTask({ taskId: "task-1" })
			const callbacks = createCallbacks()

			await sendMessageTool.execute({ targetTaskId: "task-1", message: "hello" }, task, callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Cannot send a message to yourself"),
			)
		})

		it("returns error when target task is not found", async () => {
			const provider = {
				findTaskInStack: vi.fn().mockReturnValue(undefined),
				getCurrentTaskStack: vi.fn().mockReturnValue(["task-1"]),
			}
			const task = createTask({
				providerRef: { deref: () => provider },
			})
			const callbacks = createCallbacks()

			await sendMessageTool.execute({ targetTaskId: "task-999", message: "hello" }, task, callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining('Target task "task-999" not found'),
			)
		})

		it("returns error when target task is aborted", async () => {
			const targetTask = { abort: true, abandoned: false }
			const provider = {
				findTaskInStack: vi.fn().mockReturnValue(targetTask),
				getCurrentTaskStack: vi.fn().mockReturnValue(["task-1", "task-2"]),
			}
			const task = createTask({
				providerRef: { deref: () => provider },
				parentTaskId: "task-2",
			})
			const callbacks = createCallbacks()

			await sendMessageTool.execute({ targetTaskId: "task-2", message: "hello" }, task, callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("already been completed or aborted"),
			)
		})

		it("returns error when target task is abandoned", async () => {
			const targetTask = { abort: false, abandoned: true }
			const provider = {
				findTaskInStack: vi.fn().mockReturnValue(targetTask),
				getCurrentTaskStack: vi.fn().mockReturnValue(["task-1", "task-2"]),
			}
			const task = createTask({
				providerRef: { deref: () => provider },
				parentTaskId: "task-2",
			})
			const callbacks = createCallbacks()

			await sendMessageTool.execute({ targetTaskId: "task-2", message: "hello" }, task, callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("already been completed or aborted"),
			)
		})

		it("returns error when target is not a related task", async () => {
			const targetTask = {
				abort: false,
				abandoned: false,
				parentTaskId: "other-parent",
			}
			const provider = {
				findTaskInStack: vi.fn().mockReturnValue(targetTask),
				getCurrentTaskStack: vi.fn().mockReturnValue(["task-1", "task-3"]),
			}
			const task = createTask({
				providerRef: { deref: () => provider },
				parentTaskId: "some-parent",
			})
			const callbacks = createCallbacks()

			await sendMessageTool.execute({ targetTaskId: "task-3", message: "hello" }, task, callbacks as any)

			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("not a parent, child, or sibling"),
			)
		})

		it("sends message to parent task successfully", async () => {
			const addMessageMock = vi.fn()
			const targetTask = {
				abort: false,
				abandoned: false,
				parentTaskId: undefined,
				messageQueueService: { addMessage: addMessageMock },
			}
			const provider = {
				findTaskInStack: vi.fn().mockReturnValue(targetTask),
				getCurrentTaskStack: vi.fn().mockReturnValue(["task-1", "task-parent"]),
			}
			const task = createTask({
				taskId: "task-1",
				parentTaskId: "task-parent",
				providerRef: { deref: () => provider },
			})
			const callbacks = createCallbacks()

			await sendMessageTool.execute(
				{ targetTaskId: "task-parent", message: "hello parent" },
				task,
				callbacks as any,
			)

			expect(callbacks.askApproval).toHaveBeenCalled()
			expect(addMessageMock).toHaveBeenCalledWith(expect.stringContaining("hello parent"))
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Message sent to parent task"),
			)
			expect(task.consecutiveMistakeCount).toBe(0)
		})

		it("sends message to child task successfully", async () => {
			const addMessageMock = vi.fn()
			const targetTask = {
				abort: false,
				abandoned: false,
				parentTaskId: "task-1",
				messageQueueService: { addMessage: addMessageMock },
			}
			const provider = {
				findTaskInStack: vi.fn().mockReturnValue(targetTask),
				getCurrentTaskStack: vi.fn().mockReturnValue(["task-1", "task-child"]),
			}
			const task = createTask({
				taskId: "task-1",
				providerRef: { deref: () => provider },
			})
			const callbacks = createCallbacks()

			await sendMessageTool.execute(
				{ targetTaskId: "task-child", message: "hello child" },
				task,
				callbacks as any,
			)

			expect(addMessageMock).toHaveBeenCalledWith(expect.stringContaining("hello child"))
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(expect.stringContaining("Message sent to child task"))
		})

		it("sends message to sibling task successfully", async () => {
			const addMessageMock = vi.fn()
			const targetTask = {
				abort: false,
				abandoned: false,
				parentTaskId: "shared-parent",
				messageQueueService: { addMessage: addMessageMock },
			}
			const provider = {
				findTaskInStack: vi.fn().mockReturnValue(targetTask),
				getCurrentTaskStack: vi.fn().mockReturnValue(["task-1", "task-sibling"]),
			}
			const task = createTask({
				taskId: "task-1",
				parentTaskId: "shared-parent",
				providerRef: { deref: () => provider },
			})
			const callbacks = createCallbacks()

			await sendMessageTool.execute(
				{ targetTaskId: "task-sibling", message: "hello sibling" },
				task,
				callbacks as any,
			)

			expect(addMessageMock).toHaveBeenCalledWith(expect.stringContaining("hello sibling"))
			expect(callbacks.pushToolResult).toHaveBeenCalledWith(
				expect.stringContaining("Message sent to sibling task"),
			)
		})

		it("does not send message when approval is denied", async () => {
			const addMessageMock = vi.fn()
			const targetTask = {
				abort: false,
				abandoned: false,
				parentTaskId: undefined,
				messageQueueService: { addMessage: addMessageMock },
			}
			const provider = {
				findTaskInStack: vi.fn().mockReturnValue(targetTask),
				getCurrentTaskStack: vi.fn().mockReturnValue(["task-1", "task-parent"]),
			}
			const task = createTask({
				parentTaskId: "task-parent",
				providerRef: { deref: () => provider },
			})
			const callbacks = createCallbacks()
			callbacks.askApproval.mockResolvedValue(false)

			await sendMessageTool.execute({ targetTaskId: "task-parent", message: "hello" }, task, callbacks as any)

			expect(addMessageMock).not.toHaveBeenCalled()
			expect(callbacks.pushToolResult).not.toHaveBeenCalled()
		})

		it("delegates unexpected errors to handleError", async () => {
			const provider = {
				findTaskInStack: vi.fn().mockImplementation(() => {
					throw new Error("stack overflow")
				}),
				getCurrentTaskStack: vi.fn().mockReturnValue([]),
			}
			const task = createTask({
				providerRef: { deref: () => provider },
			})
			const callbacks = createCallbacks()

			await sendMessageTool.execute({ targetTaskId: "task-2", message: "hello" }, task, callbacks as any)

			expect(callbacks.handleError).toHaveBeenCalledWith(
				"sending message to agent",
				expect.objectContaining({ message: "stack overflow" }),
			)
		})
	})

	describe("handlePartial", () => {
		it("asks with partial tool message", async () => {
			const task = createTask()

			await sendMessageTool.handlePartial(task, {
				nativeArgs: { targetTaskId: "task-2", message: "hello" },
				partial: true,
			} as any)

			expect(task.ask).toHaveBeenCalledWith("tool", expect.stringContaining("send_message"), true)
		})
	})
})
