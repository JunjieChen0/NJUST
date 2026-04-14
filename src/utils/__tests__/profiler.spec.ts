import { describe, expect, it } from "vitest"

import { startupProfiler } from "../profiler"

describe("startupProfiler", () => {
	it("records start/end duration", async () => {
		const name = `activate-${Date.now()}`
		startupProfiler.start(name)
		await new Promise((r) => setTimeout(r, 3))
		startupProfiler.end(name)

		const summary = startupProfiler.summary()
		const entry = summary.find((e) => e.name === name)
		expect(entry).toBeDefined()
		expect(entry!.startedAt).toBeTypeOf("number")
		expect(entry!.endedAt).toBeTypeOf("number")
		expect(entry!.durationMs).toBeTypeOf("number")
		expect(entry!.durationMs!).toBeGreaterThanOrEqual(0)
	})
})
