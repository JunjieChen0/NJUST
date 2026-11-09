import { beforeEach, describe, expect, it, vi } from "vitest"

import { TelemetryService, type TelemetryClient } from "../index.js"

function resetInstance(): void {
	;(TelemetryService as any)._instance = undefined
}

describe("TelemetryService external clients", () => {
	beforeEach(() => {
		resetInstance()
	})

	it("forwards sanitized exception events to registered clients", () => {
		const service = TelemetryService.createInstance({ enableOtel: false })
		const client: TelemetryClient = { captureEvent: vi.fn() }
		service.register(client)

		service.captureException(new Error("boom"), {
			event: "extension_init_error",
			taskId: "task-1",
			rawMessage: "must not leave the process",
		})

		expect(client.captureEvent).toHaveBeenCalledWith("exception", {
			error_type: "boom",
			event: "extension_init_error",
			taskId: "task-1",
		})
	})

	it("supports unregistering a client", () => {
		const service = TelemetryService.createInstance({ enableOtel: false })
		const client: TelemetryClient = { captureEvent: vi.fn() }
		const unregister = service.register(client)

		unregister()
		service.captureEvent("task_created", { taskId: "task-1" })

		expect(client.captureEvent).not.toHaveBeenCalled()
	})

	it("does not forward events after explicit opt-out", () => {
		const service = TelemetryService.createInstance({ enableOtel: false })
		const client: TelemetryClient = { captureEvent: vi.fn() }
		service.register(client)
		service.updateTelemetryState(false)

		service.captureEvent("task_created", { taskId: "task-1" })

		expect(client.captureEvent).not.toHaveBeenCalled()
	})

	it("isolates synchronous throws and async rejections from clients", async () => {
		const service = TelemetryService.createInstance({ enableOtel: false })
		const healthy: TelemetryClient = { captureEvent: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }
		service.register({
			captureEvent: () => {
				throw new Error("exporter failed")
			},
		})
		service.register({ captureEvent: vi.fn().mockRejectedValue(new Error("network down")) })
		service.register(healthy)

		expect(() => service.captureEvent("task_created", { taskId: "task-1" })).not.toThrow()
		await service.flush()

		expect(healthy.captureEvent).toHaveBeenCalledWith("task_created", { taskId: "task-1" })
		expect(healthy.flush).toHaveBeenCalledTimes(1)
	})
})
