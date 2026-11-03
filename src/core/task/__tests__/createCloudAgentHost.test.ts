import { EventEmitter } from "events"
import { describe, expect, it, vi } from "vitest"
import { NJUST_AIEventName } from "@njust-ai/types"

import { createCloudAgentHost } from "../createCloudAgentHost"

const { captureTaskCompleted } = vi.hoisted(() => ({ captureTaskCompleted: vi.fn() }))
vi.mock("@njust-ai/telemetry", () => ({ TelemetryService: { instance: { captureTaskCompleted } } }))
vi.mock("../../../i18n", () => ({ t: (key: string) => key }))

function makeTask() {
	const tokenUsage = { totalTokensIn: 1, totalTokensOut: 2, totalCost: 0, contextTokens: 0 }
	return Object.assign(new EventEmitter(), {
		taskId: "task-1",
		instanceId: "inst-1",
		cwd: "/ws",
		abort: false,
		parentTaskId: "parent-1",
		toolUsage: {},
		say: vi.fn(),
		ask: vi.fn(),
		hostRef: { deref: () => undefined },
		getTokenUsage: vi.fn(() => tokenUsage),
		emitFinalTokenUsageUpdate: vi.fn(),
		markTaskCompleted: vi.fn(),
	})
}

describe("createCloudAgentHost.markCompleted", () => {
	it("starts each cloud submission separately from prior completed state", () => {
		const task = Object.assign(makeTask(), { markCloudRunStarted: vi.fn() })
		createCloudAgentHost(task).beginRun?.()
		expect(task.markCloudRunStarted).toHaveBeenCalledOnce()
	})

	it("records applied paths and uses normal command approval for local verification", async () => {
		const summary = {
			overall: "failed",
			acceptance: "pending",
			build: { state: "failed" },
			test: { state: "not_run" },
		}
		let approve: ((command: string) => Promise<boolean>) | undefined
		const task = Object.assign(makeTask(), {
			cangjieRuntimePolicy: { noteDelegatedWrites: vi.fn() },
			cangjieVerification: {
				verifyForCompletion: vi.fn(async (callback: typeof approve) => {
					approve = callback
					return { action: "block" }
				}),
				currentSummary: vi.fn().mockResolvedValue(summary),
			},
		})
		task.ask.mockResolvedValue({ response: "yesButtonClicked" })
		await expect(createCloudAgentHost(task as any).verifyLocally?.(["/ws/src/a.cj"])).resolves.toEqual(summary)
		expect(task.cangjieRuntimePolicy.noteDelegatedWrites).toHaveBeenCalledWith(["/ws/src/a.cj"])
		await expect(approve!("cjpm test")).resolves.toBe(true)
		expect(task.ask).toHaveBeenCalledWith("command", "cjpm test")
	})
	it("emits TaskCompleted and marks the task completed", () => {
		const task = makeTask()
		const onCompleted = vi.fn()
		task.on(NJUST_AIEventName.TaskCompleted, onCompleted)

		createCloudAgentHost(task).markCompleted()

		expect(task.emitFinalTokenUsageUpdate).toHaveBeenCalled()
		expect(captureTaskCompleted).toHaveBeenCalledWith("task-1")
		expect(onCompleted).toHaveBeenCalledWith("task-1", task.getTokenUsage(), task.toolUsage, { isSubtask: true })
		expect(task.markTaskCompleted).toHaveBeenCalled()
	})
})
