import { describe, it, expect, vi } from "vitest"
import { Task } from "../Task"

vi.mock("../../checkpoints", () => ({ getCheckpointService: vi.fn().mockResolvedValue(undefined) }))
vi.mock("../../prefetch", () => ({ startAllPrefetch: vi.fn() }))
vi.mock("../createCloudAgentHost", () => ({ createCloudAgentHost: () => ({}) }))
vi.mock("../CloudAgentOrchestrator", () => ({
	CloudAgentOrchestrator: class {
		run = vi.fn().mockResolvedValue(undefined)
	},
}))

describe("task loop finalization", () => {
	it("does not start Cloud execution when cancelled during SDK preparation", async () => {
		const host: any = {
			abort: false,
			cangjieRuntimePolicy: { hasCjpmProject: async () => true },
			cangjieVerification: {
				prepareForTask: async () => {
					host.abort = true
				},
			},
			initiateMemrlBeforeRun: vi.fn(),
		}
		await (Task.prototype as any).initiateCloudAgentLoop.call(host, "update the project")
		expect(host.initiateMemrlBeforeRun).not.toHaveBeenCalled()
	})
	it.each([
		["initiateTaskLoop", false],
		["initiateTaskLoop", true],
		["initiateCloudAgentLoop", false],
		["initiateCloudAgentLoop", true],
	] as const)("%s ends without waiting for memory (completed=%s)", async (method, taskCompleted) => {
		let finishMemory!: () => void
		const pendingMemory = new Promise<void>((resolve) => {
			finishMemory = resolve
		})
		const host: any = {
			taskId: "task",
			cangjieRuntimePolicy: { hasCjpmProject: vi.fn().mockResolvedValue(false) },
			hostRef: { deref: () => undefined },
			activeTaskLoopCount: 0,
			taskLoopIdleResolvers: new Set(),
			taskCompleted,
			initiateMemrlBeforeRun: vi.fn().mockResolvedValue(undefined),
			emit: vi.fn(),
			recursivelyMakeClineRequests: vi.fn().mockResolvedValue(true),
			publishVerificationSummary: vi.fn().mockResolvedValue(undefined),
			persistMemrlEpisode: vi.fn().mockReturnValue(pendingMemory),
		}
		let ended = false
		const loop = (Task.prototype as any)[method]
			.call(host, method === "initiateTaskLoop" ? [] : "hello")
			.then(() => {
				ended = true
			})
		try {
			await vi.waitFor(() => expect(ended).toBe(true))
			expect(host.persistMemrlEpisode).toHaveBeenCalledWith(taskCompleted ? "completion" : "interrupted")
			if (method === "initiateTaskLoop") expect(host.activeTaskLoopCount).toBe(0)
		} finally {
			finishMemory()
			await loop
		}
	})

	it.each(["initiateTaskLoop", "initiateCloudAgentLoop"])(
		"%s does not write cancellation facts when abandoned",
		async (method) => {
			const host: any = {
				taskId: "task",
				cangjieRuntimePolicy: { hasCjpmProject: vi.fn().mockResolvedValue(false) },
				hostRef: { deref: () => undefined },
				activeTaskLoopCount: 0,
				taskLoopIdleResolvers: new Set(),
				taskCompleted: false,
				abandoned: true,
				abort: true,
				initiateMemrlBeforeRun: vi.fn().mockResolvedValue(undefined),
				emit: vi.fn(),
				publishVerificationSummary: vi.fn().mockResolvedValue(undefined),
				persistMemrlEpisode: vi.fn().mockResolvedValue(undefined),
			}
			await (Task.prototype as any)[method].call(host, method === "initiateTaskLoop" ? [] : "hello")
			expect(host.publishVerificationSummary).not.toHaveBeenCalled()
			expect(host.persistMemrlEpisode).not.toHaveBeenCalled()
		},
	)
})
