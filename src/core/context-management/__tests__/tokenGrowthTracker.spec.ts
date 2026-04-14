import { describe, expect, it } from "vitest"

import { TokenGrowthTracker } from "../tokenGrowthTracker"

describe("TokenGrowthTracker", () => {
	it("predicts next tokens using EMA growth", () => {
		const tracker = new TokenGrowthTracker({ maxWindowSize: 5, emaAlpha: 0.5 })
		tracker.addSample(10_000)
		tracker.addSample(12_000)
		tracker.addSample(15_000)

		const snapshot = tracker.getSnapshot()
		expect(snapshot).toBeDefined()
		expect(snapshot!.predictedNextTokens).toBeGreaterThan(15_000)
		expect(snapshot!.emaGrowth).toBeGreaterThan(0)
	})

	it("flags accelerating growth when latest jump exceeds average", () => {
		const tracker = new TokenGrowthTracker({ maxWindowSize: 6, emaAlpha: 0.4 })
		tracker.addSample(20_000)
		tracker.addSample(21_000)
		tracker.addSample(22_000)
		tracker.addSample(25_000)

		const snapshot = tracker.getSnapshot()
		expect(snapshot).toBeDefined()
		expect(snapshot!.isAccelerating).toBe(true)
	})

	it("handles flat or negative growth without acceleration", () => {
		const tracker = new TokenGrowthTracker({ maxWindowSize: 5, emaAlpha: 0.3 })
		tracker.addSample(30_000)
		tracker.addSample(29_000)
		tracker.addSample(29_000)
		tracker.addSample(28_500)

		const snapshot = tracker.getSnapshot()
		expect(snapshot).toBeDefined()
		expect(snapshot!.predictedNextTokens).toBeGreaterThanOrEqual(0)
		expect(snapshot!.isAccelerating).toBe(false)
	})

	it("ignores invalid samples and supports reset", () => {
		const tracker = new TokenGrowthTracker({ maxWindowSize: 3 })
		tracker.addSample(10_000)
		tracker.addSample(Number.NaN)
		tracker.addSample(-1)
		tracker.addSample(11_000)

		expect(tracker.getSnapshot()).toBeDefined()
		tracker.reset()
		expect(tracker.getSnapshot()).toBeUndefined()
	})
})
