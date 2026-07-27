// npx vitest run __tests__/provider-delegation.spec.ts

import { describe, it, expect, vi } from "vitest"
import { NJUST_AIEventName } from "@njust-ai/types"
import { delegateParentAndOpenChildWithProvider, type IDelegationHost } from "../core/webview/ClineProviderDelegation"

/** Minimal parent task surface used by delegateParentAndOpenChild (flush + lineage). */
function createDelegationParentStub(overrides: { taskId?: string } = {}) {
	const taskId = overrides.taskId ?? "parent-1"
	return {
		taskId,
		emit: vi.fn(),
		flushPendingToolResultsToHistory: vi.fn().mockResolvedValue(true),
		retrySaveApiConversationHistory: vi.fn().mockResolvedValue(true),
		cangjieRuntimePolicy: {
			noteAgentDelegation: vi.fn(),
		},
		isPaused: false,
	}
}

describe("ClineProvider.delegateParentAndOpenChild()", () => {
	it("persists parent delegation metadata and emits TaskDelegated", async () => {
		const providerEmit = vi.fn()
		const parentTask = createDelegationParentStub()

		const childStart = vi.fn()
		const updateTaskHistory = vi.fn()
		const stackPop = vi.fn().mockResolvedValue(undefined)
		const createTask = vi.fn().mockResolvedValue({ taskId: "child-1", start: childStart })
		const handleModeSwitch = vi.fn().mockResolvedValue(undefined)
		const getTaskWithId = vi.fn(async function (id: string) {
			if (id === "parent-1") {
				return {
					historyItem: {
						id: "parent-1",
						task: "Parent",
						tokensIn: 0,
						tokensOut: 0,
						totalCost: 0,
						childIds: [],
					},
				}
			}
			// child-1
			return {
				historyItem: {
					id: "child-1",
					task: "Do something",
					tokensIn: 0,
					tokensOut: 0,
					totalCost: 0,
				},
			}
		})

		const provider = {
			emit: providerEmit,
			getCurrentTask: vi.fn(() => parentTask),
			stack: {
				pop: stackPop,
			},
			createTask,
			getTaskWithId,
			updateTaskHistory,
			handleModeSwitch,
			log: vi.fn(),
		} as unknown as IDelegationHost

		const params = {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
			allowedTools: ["read_file", "execute_command"],
			agentType: "CangjieVerify",
		}

		const child = await delegateParentAndOpenChildWithProvider(provider, params)

		expect(child.taskId).toBe("child-1")

		// Parent stays below the child and is paused instead of being aborted.
		expect(stackPop).not.toHaveBeenCalled()
		expect(parentTask.isPaused).toBe(true)
		expect(parentTask.cangjieRuntimePolicy.noteAgentDelegation).toHaveBeenCalledWith("CangjieVerify")
		// Child task is created with startTask: false and initialStatus: "active"
		expect(createTask).toHaveBeenCalledWith("Do something", undefined, parentTask, {
			initialTodos: [],
			initialStatus: "active",
			startTask: false,
			allowedTools: ["read_file", "execute_command"],
			taskMode: "code",
			agentType: "CangjieVerify",
		})

		// Metadata persistence - parent gets "delegated" status (child status is set at creation via initialStatus)
		expect(updateTaskHistory).toHaveBeenCalledTimes(1)

		// Parent set to "delegated"
		const parentSaved = updateTaskHistory.mock.calls[0][0]
		expect(parentSaved).toEqual(
			expect.objectContaining({
				id: "parent-1",
				status: "delegated",
				delegatedToId: "child-1",
				awaitingChildId: "child-1",
				childIds: expect.arrayContaining(["child-1"]),
				delegatedAgentTypes: ["CangjieVerify"],
			}),
		)

		// child.start() must be called AFTER parent metadata is persisted
		expect(childStart).toHaveBeenCalledTimes(1)

		// Event emission (provider-level)
		expect(providerEmit).toHaveBeenCalledWith(NJUST_AIEventName.TaskDelegated, "parent-1", "child-1")

		// Mode switch
		expect(handleModeSwitch).toHaveBeenCalledWith("code")
	})

	it("calls child.start() only after parent metadata is persisted (no race condition)", async () => {
		const callOrder: string[] = []

		const parentTask = createDelegationParentStub()
		const childStart = vi.fn(() => callOrder.push("child.start"))

		const updateTaskHistory = vi.fn(async function () {
			callOrder.push("updateTaskHistory")
		})
		const stackPop = vi.fn().mockResolvedValue(undefined)
		const createTask = vi.fn(async function () {
			callOrder.push("createTask")
			return { taskId: "child-1", start: childStart }
		})
		const handleModeSwitch = vi.fn().mockResolvedValue(undefined)
		const getTaskWithId = vi.fn().mockResolvedValue({
			historyItem: {
				id: "parent-1",
				task: "Parent",
				tokensIn: 0,
				tokensOut: 0,
				totalCost: 0,
				childIds: [],
			},
		})

		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			stack: {
				pop: stackPop,
			},
			createTask,
			getTaskWithId,
			updateTaskHistory,
			handleModeSwitch,
			log: vi.fn(),
		} as unknown as IDelegationHost

		await delegateParentAndOpenChildWithProvider(provider, {
			parentTaskId: "parent-1",
			message: "Do something",
			initialTodos: [],
			mode: "code",
			allowedTools: undefined,
		})

		// Verify ordering: createTask → updateTaskHistory → child.start
		expect(callOrder).toEqual(["createTask", "updateTaskHistory", "child.start"])
	})

	it("unpauses the parent if child creation fails", async () => {
		const parentTask = createDelegationParentStub()
		const provider = {
			emit: vi.fn(),
			getCurrentTask: vi.fn(() => parentTask),
			stack: { pop: vi.fn() },
			createTask: vi.fn().mockRejectedValue(new Error("create failed")),
			getTaskWithId: vi.fn(),
			updateTaskHistory: vi.fn(),
			handleModeSwitch: vi.fn().mockResolvedValue(undefined),
			log: vi.fn(),
		} as unknown as IDelegationHost

		await expect(
			delegateParentAndOpenChildWithProvider(provider, {
				parentTaskId: "parent-1",
				message: "Do something",
				initialTodos: [],
				mode: "code",
			}),
		).rejects.toThrow("create failed")
		expect(parentTask.isPaused).toBe(false)
	})
})
