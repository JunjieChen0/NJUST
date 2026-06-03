import { describe, expect, it, vi, beforeEach } from "vitest"

import { ToolExecutionContext } from "../ToolExecutionContext"

describe("ToolExecutionContext", () => {
	let ctx: ToolExecutionContext

	beforeEach(() => {
		ctx = new ToolExecutionContext(5)
	})

	describe("constructor", () => {
		it("initializes stats, concurrencyController, scheduler, and streamingExecutor", () => {
			expect(ctx.stats).toBeDefined()
			expect(ctx.concurrencyController).toBeDefined()
			expect(ctx.scheduler).toBeDefined()
			expect(ctx.streamingExecutor).toBeDefined()
		})

		it("accepts maxConcurrency of 1", () => {
			const small = new ToolExecutionContext(1)
			expect(small.streamingExecutor).toBeDefined()
		})

		it("handles NaN maxConcurrency by falling back to 10", () => {
			const fallback = new ToolExecutionContext(NaN)
			expect(fallback.streamingExecutor).toBeDefined()
		})

		it("handles zero maxConcurrency by falling back to 10", () => {
			const zero = new ToolExecutionContext(0)
			expect(zero.streamingExecutor).toBeDefined()
		})

		it("handles negative maxConcurrency by clamping to 1", () => {
			const negative = new ToolExecutionContext(-5)
			expect(negative.streamingExecutor).toBeDefined()
		})
	})

	describe("getSiblingAbortController", () => {
		it("creates a new AbortController on first call", () => {
			const controller = ctx.getSiblingAbortController()
			expect(controller).toBeInstanceOf(AbortController)
			expect(controller.signal.aborted).toBe(false)
		})

		it("returns the same controller on subsequent calls", () => {
			const first = ctx.getSiblingAbortController()
			const second = ctx.getSiblingAbortController()
			expect(first).toBe(second)
		})

		it("creates a new controller if the previous one was aborted", () => {
			const first = ctx.getSiblingAbortController()
			first.abort("test")
			const second = ctx.getSiblingAbortController()
			expect(second).not.toBe(first)
			expect(second.signal.aborted).toBe(false)
		})
	})

	describe("signalSiblingAbort", () => {
		it("aborts the sibling controller with the given reason", () => {
			const controller = ctx.getSiblingAbortController()
			ctx.signalSiblingAbort("custom_reason")
			expect(controller.signal.aborted).toBe(true)
			expect(controller.signal.reason).toBe("custom_reason")
		})

		it("uses 'sibling_error' as the default reason", () => {
			const controller = ctx.getSiblingAbortController()
			ctx.signalSiblingAbort()
			expect(controller.signal.aborted).toBe(true)
			expect(controller.signal.reason).toBe("sibling_error")
		})

		it("is a no-op when no controller has been created", () => {
			// Should not throw
			expect(() => ctx.signalSiblingAbort()).not.toThrow()
		})

		it("is a no-op when controller is already aborted", () => {
			const controller = ctx.getSiblingAbortController()
			ctx.signalSiblingAbort("first")
			// Second signal should not throw or change the reason
			ctx.signalSiblingAbort("second")
			expect(controller.signal.reason).toBe("first")
		})
	})

	describe("isSiblingAborted", () => {
		it("returns false initially when no controller exists", () => {
			expect(ctx.isSiblingAborted).toBe(false)
		})

		it("returns false when controller exists but is not aborted", () => {
			ctx.getSiblingAbortController()
			expect(ctx.isSiblingAborted).toBe(false)
		})

		it("returns true after signalSiblingAbort is called", () => {
			ctx.getSiblingAbortController()
			ctx.signalSiblingAbort()
			expect(ctx.isSiblingAborted).toBe(true)
		})
	})

	describe("resetSiblingAbortController", () => {
		it("clears the controller so next get creates a fresh one", () => {
			const first = ctx.getSiblingAbortController()
			ctx.resetSiblingAbortController()
			const second = ctx.getSiblingAbortController()
			expect(second).not.toBe(first)
			expect(second.signal.aborted).toBe(false)
		})

		it("makes isSiblingAborted return false even if previously aborted", () => {
			ctx.getSiblingAbortController()
			ctx.signalSiblingAbort()
			expect(ctx.isSiblingAborted).toBe(true)

			ctx.resetSiblingAbortController()
			expect(ctx.isSiblingAborted).toBe(false)
		})
	})

	describe("enableAdaptiveTuning", () => {
		it("calls enableAutoTuning on the concurrency controller with stats", () => {
			const spy = vi.spyOn(ctx.concurrencyController, "enableAutoTuning")
			ctx.enableAdaptiveTuning()
			expect(spy).toHaveBeenCalledOnce()
			expect(spy).toHaveBeenCalledWith(ctx.stats)
		})
	})

	describe("recordToolErrorMetric", () => {
		it("records an error in stats with duration 2500 and failed=true", () => {
			const recordSpy = vi.spyOn(ctx.stats, "record")
			const _tuningSpy = vi.spyOn(ctx.concurrencyController, "enableAutoTuning")

			ctx.recordToolErrorMetric("bash")

			expect(recordSpy).toHaveBeenCalledOnce()
			expect(recordSpy).toHaveBeenCalledWith("bash", 2500, true)
		})

		it("enables auto tuning on the concurrency controller", () => {
			const tuningSpy = vi.spyOn(ctx.concurrencyController, "enableAutoTuning")
			ctx.recordToolErrorMetric("write_to_file")
			expect(tuningSpy).toHaveBeenCalledOnce()
			expect(tuningSpy).toHaveBeenCalledWith(ctx.stats)
		})

		it("updates stats so the error is reflected in failure rate", () => {
			ctx.recordToolErrorMetric("bash")
			expect(ctx.stats.getFailureRate("bash")).toBe(1)
			expect(ctx.stats.getAverageDuration("bash")).toBe(2500)
		})
	})

	describe("dispose", () => {
		it("disables auto tuning on the concurrency controller", () => {
			const spy = vi.spyOn(ctx.concurrencyController, "disableAutoTuning")
			ctx.dispose()
			// Called once directly by dispose() and once more by concurrencyController.reset()
			expect(spy).toHaveBeenCalledTimes(2)
		})

		it("aborts the sibling controller with 'context_disposed' reason", () => {
			const controller = ctx.getSiblingAbortController()
			ctx.dispose()
			expect(controller.signal.aborted).toBe(true)
			expect(controller.signal.reason).toBe("context_disposed")
		})

		it("does not abort an already-aborted sibling controller", () => {
			const controller = ctx.getSiblingAbortController()
			ctx.signalSiblingAbort("already_done")
			// dispose should not re-abort or throw
			expect(() => ctx.dispose()).not.toThrow()
			expect(controller.signal.reason).toBe("already_done")
		})

		it("resets the concurrency controller", () => {
			const spy = vi.spyOn(ctx.concurrencyController, "reset")
			ctx.dispose()
			expect(spy).toHaveBeenCalledOnce()
		})

		it("resets stats", () => {
			ctx.stats.record("bash", 100, true)
			expect(ctx.stats.getAverageDuration("bash")).toBe(100)

			const spy = vi.spyOn(ctx.stats, "reset")
			ctx.dispose()
			expect(spy).toHaveBeenCalledOnce()
			expect(ctx.stats.getAverageDuration("bash")).toBe(0)
		})

		it("clears the sibling controller reference so isSiblingAborted returns false", () => {
			ctx.getSiblingAbortController()
			ctx.dispose()
			expect(ctx.isSiblingAborted).toBe(false)
		})

		it("is safe to call when no sibling controller was ever created", () => {
			expect(() => ctx.dispose()).not.toThrow()
		})
	})
})
