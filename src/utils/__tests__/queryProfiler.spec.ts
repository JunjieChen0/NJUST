import { describe, expect, it } from "vitest"

import { globalQueryProfiler } from "../queryProfiler"

describe("queryProfiler", () => {
	it("computes TTFT and E2E on finish", async () => {
		const requestId = `req-${Date.now()}`
		globalQueryProfiler.start({
			requestId,
			taskId: "task-1",
			modelId: "model-a",
			startedAt: Date.now(),
		})

		await new Promise((r) => setTimeout(r, 5))
		globalQueryProfiler.markFirstToken(requestId)
		await new Promise((r) => setTimeout(r, 5))
		const result = globalQueryProfiler.finish(requestId)

		expect(result).toBeDefined()
		expect(result!.requestId).toBe(requestId)
		expect(result!.ttftMs).toBeTypeOf("number")
		expect(result!.e2eMs).toBeTypeOf("number")
		expect(result!.e2eMs!).toBeGreaterThanOrEqual(result!.ttftMs!)
	})

	it("returns undefined for unknown request id", () => {
		const result = globalQueryProfiler.finish("unknown-req-id")
		expect(result).toBeUndefined()
	})
})
