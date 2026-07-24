import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { TelemetryBatcher } from "../TelemetryBatcher.js"
import type { TelemetryLogger } from "../TelemetryLogger.js"

function createMockLogger(): TelemetryLogger {
	return {
		log: vi.fn(),
		flush: vi.fn().mockResolvedValue(undefined),
	} as unknown as TelemetryLogger
}

describe("TelemetryBatcher", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("flushes when batch size is reached", () => {
		const logger = createMockLogger()
		const batcher = new TelemetryBatcher(logger, 3, 60_000)

		batcher.enqueue({ t: 1, n: "a", p: {} })
		batcher.enqueue({ t: 2, n: "b", p: {} })
		expect(logger.log).not.toHaveBeenCalled()

		batcher.enqueue({ t: 3, n: "c", p: {} }) // triggers flush at batch size 3
		expect(logger.log).toHaveBeenCalledTimes(3)
	})

	it("does not flush when queue is empty", () => {
		const logger = createMockLogger()
		const batcher = new TelemetryBatcher(logger, 10, 60_000)

		batcher.flush()
		expect(logger.log).not.toHaveBeenCalled()
	})

	it("flushes on timer interval", () => {
		const logger = createMockLogger()
		const batcher = new TelemetryBatcher(logger, 100, 5_000)
		batcher.start()

		batcher.enqueue({ t: 1, n: "evt", p: {} })
		expect(logger.log).not.toHaveBeenCalled()

		vi.advanceTimersByTime(5_000)
		expect(logger.log).toHaveBeenCalledTimes(1)
	})

	it("shutdown clears timer and flushes remaining entries", async () => {
		const logger = createMockLogger()
		const batcher = new TelemetryBatcher(logger, 100, 60_000)
		batcher.start()

		batcher.enqueue({ t: 1, n: "a", p: {} })
		batcher.enqueue({ t: 2, n: "b", p: {} })

		await batcher.shutdown()
		expect(logger.log).toHaveBeenCalledTimes(2)
		expect(logger.flush).toHaveBeenCalled()
		expect(batcher.hasFlushed).toBe(true)
	})

	it("start is idempotent (no duplicate timers)", () => {
		const logger = createMockLogger()
		const batcher = new TelemetryBatcher(logger, 100, 5_000)
		batcher.start()
		batcher.start() // second call should be no-op

		batcher.enqueue({ t: 1, n: "evt", p: {} })
		vi.advanceTimersByTime(5_000)
		// Should flush exactly once, not twice
		expect(logger.log).toHaveBeenCalledTimes(1)
	})
})
