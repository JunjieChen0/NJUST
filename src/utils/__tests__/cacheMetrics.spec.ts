import { describe, expect, it } from "vitest"

import { CacheMetrics } from "../cacheMetrics"

describe("CacheMetrics", () => {
	it("computes recent hit rate correctly", () => {
		const metrics = new CacheMetrics()
		metrics.record({
			timestamp: Date.now(),
			inputTokens: 100,
			cacheCreationInputTokens: 0,
			cacheReadInputTokens: 100,
			outputTokens: 20,
			model: "m1",
		})
		metrics.record({
			timestamp: Date.now(),
			inputTokens: 100,
			cacheCreationInputTokens: 100,
			cacheReadInputTokens: 0,
			outputTokens: 20,
			model: "m1",
		})

		const hitRate = metrics.getRecentHitRate(2)
		// total input includes input + cacheCreation + cacheRead for each entry
		// (100+0+100) + (100+100+0) = 400, cacheRead = 100 => 0.25
		expect(hitRate).toBeCloseTo(0.25, 5)
	})

	it("returns aggregate summary with estimated savings", () => {
		const metrics = new CacheMetrics()
		metrics.record({
			timestamp: Date.now(),
			inputTokens: 200,
			cacheCreationInputTokens: 100,
			cacheReadInputTokens: 200,
			outputTokens: 50,
			model: "m2",
		})

		const summary = metrics.getSummary()
		expect(summary.totalRequests).toBe(1)
		expect(summary.totalInputTokens).toBe(200)
		expect(summary.totalCacheCreationTokens).toBe(100)
		expect(summary.totalCacheReadTokens).toBe(200)
		expect(summary.cacheHitRate).toBeCloseTo(0.4, 5)
		expect(summary.estimatedSavingsPercent).toBeCloseTo(0.36, 5)
	})

	it("resets entries", () => {
		const metrics = new CacheMetrics()
		metrics.record({
			timestamp: Date.now(),
			inputTokens: 10,
			cacheCreationInputTokens: 0,
			cacheReadInputTokens: 0,
			outputTokens: 1,
			model: "m3",
		})
		metrics.reset()
		expect(metrics.getSummary().totalRequests).toBe(0)
	})
})
