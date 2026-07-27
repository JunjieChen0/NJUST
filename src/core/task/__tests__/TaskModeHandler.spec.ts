import { describe, expect, it, vi } from "vitest"

import { TaskModeHandler } from "../TaskModeHandler"

describe("TaskModeHandler", () => {
	it("makes an explicit delegated mode available synchronously and does not overwrite it", async () => {
		const handler = new TaskModeHandler({
			cancelCurrentRequest: vi.fn(),
			updateApiConfiguration: vi.fn(),
		})
		const host = {
			getState: vi.fn().mockResolvedValue({ mode: "cloud-agent", currentApiConfigName: "default" }),
			log: vi.fn(),
		} as any

		handler.initializeAsync(host, "cangjie")

		expect(handler.taskMode).toBe("cangjie")
		await handler.waitForModeInitialization()
		expect(await handler.getTaskMode()).toBe("cangjie")
		await handler.waitForApiConfigInitialization()
		expect(handler.taskMode).toBe("cangjie")
	})
})
