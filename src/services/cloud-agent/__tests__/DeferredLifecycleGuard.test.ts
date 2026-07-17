import { describe, it, expect } from "vitest"
import { DeferredLifecycleGuard, DEFAULT_LIFECYCLE_CONFIG } from "../DeferredLifecycleGuard"

describe("DeferredLifecycleGuard", () => {
	describe("initial state", () => {
		it("starts in idle phase", () => {
			const guard = new DeferredLifecycleGuard()
			expect(guard.getPhase()).toBe("idle")
			expect(guard.getIteration()).toBe(0)
			expect(guard.isAborted()).toBe(false)
		})
	})

	describe("transitionToPending", () => {
		it("transitions from idle to pending", () => {
			const guard = new DeferredLifecycleGuard()
			const result = guard.transitionToPending(3)
			expect(result.action).toBe("continue")
			expect(guard.getPhase()).toBe("pending")
		})

		it("aborts when iteration limit is reached", () => {
			const guard = new DeferredLifecycleGuard({ maxIterations: 2 })
			guard.transitionToPending(1)
			guard.incrementIteration()
			guard.recordToolCompletion()
			guard.transitionToRunning()

			guard.transitionToPending(1)
			guard.incrementIteration()
			guard.recordToolCompletion()
			guard.transitionToRunning()

			const result = guard.transitionToPending(1)
			expect(result.action).toBe("abort")
			expect(result.reason).toContain("Iteration limit reached")
			expect(guard.isAborted()).toBe(true)
		})

		it("aborts when wall-clock limit is reached", () => {
			const guard = new DeferredLifecycleGuard({ maxDurationMs: -1 })
			const result = guard.transitionToPending(1)
			expect(result.action).toBe("abort")
			expect(result.reason).toContain("Wall-clock limit reached")
			expect(guard.isAborted()).toBe(true)
		})

		it("rejects transition when already aborted", () => {
			const guard = new DeferredLifecycleGuard({ maxIterations: 1 })
			guard.transitionToPending(1)
			guard.incrementIteration()
			guard.transitionToPending(1)

			const result = guard.transitionToPending(1)
			expect(result.action).toBe("abort")
			expect(result.reason).toContain("already aborted")
		})
	})

	describe("incrementIteration", () => {
		it("increments and checks limits", () => {
			const guard = new DeferredLifecycleGuard({ maxIterations: 3 })
			guard.transitionToPending(1)
			expect(guard.incrementIteration().action).toBe("continue")
			expect(guard.getIteration()).toBe(1)
			expect(guard.incrementIteration().action).toBe("continue")
			expect(guard.getIteration()).toBe(2)
			expect(guard.incrementIteration().action).toBe("continue")
			expect(guard.getIteration()).toBe(3)
		})

		it("aborts when exceeding max iterations", () => {
			const guard = new DeferredLifecycleGuard({ maxIterations: 1 })
			guard.transitionToPending(1)
			guard.incrementIteration()
			const result = guard.incrementIteration()
			expect(result.action).toBe("abort")
			expect(result.reason).toContain("Iteration limit reached")
		})
	})

	describe("recordToolCompletion", () => {
		it("tracks completed tools", () => {
			const guard = new DeferredLifecycleGuard()
			guard.transitionToPending(3)
			expect(guard.recordToolCompletion().action).toBe("continue")
			expect(guard.recordToolCompletion().action).toBe("continue")
			expect(guard.recordToolCompletion().action).toBe("continue")
		})

		it("aborts when more completions than pending tools", () => {
			const guard = new DeferredLifecycleGuard()
			guard.transitionToPending(2)
			guard.recordToolCompletion()
			guard.recordToolCompletion()
			const result = guard.recordToolCompletion()
			expect(result.action).toBe("abort")
			expect(result.reason).toContain("Batch integrity violation")
			expect(guard.isAborted()).toBe(true)
		})
	})

	describe("validateBatchCompleteness", () => {
		it("passes when all tools completed", () => {
			const guard = new DeferredLifecycleGuard()
			guard.transitionToPending(3)
			guard.recordToolCompletion()
			guard.recordToolCompletion()
			guard.recordToolCompletion()
			expect(guard.validateBatchCompleteness().action).toBe("continue")
		})

		it("aborts when not all tools completed", () => {
			const guard = new DeferredLifecycleGuard()
			guard.transitionToPending(3)
			guard.recordToolCompletion()
			const result = guard.validateBatchCompleteness()
			expect(result.action).toBe("abort")
			expect(result.reason).toContain("expected 3 results, got 1")
			expect(guard.isAborted()).toBe(true)
		})

		it("passes when zero pending tools", () => {
			const guard = new DeferredLifecycleGuard()
			guard.transitionToPending(0)
			expect(guard.validateBatchCompleteness().action).toBe("continue")
		})
	})

	describe("transitionToRunning", () => {
		it("transitions from pending to running when batch is complete", () => {
			const guard = new DeferredLifecycleGuard()
			guard.transitionToPending(2)
			guard.recordToolCompletion()
			guard.recordToolCompletion()
			const result = guard.transitionToRunning()
			expect(result.action).toBe("continue")
			expect(guard.getPhase()).toBe("running")
		})

		it("aborts when batch is incomplete", () => {
			const guard = new DeferredLifecycleGuard()
			guard.transitionToPending(3)
			guard.recordToolCompletion()
			const result = guard.transitionToRunning()
			expect(result.action).toBe("abort")
			expect(result.reason).toContain("Batch integrity violation")
		})

		it("aborts when not in pending phase", () => {
			const guard = new DeferredLifecycleGuard()
			const result = guard.transitionToRunning()
			expect(result.action).toBe("abort")
			expect(result.reason).toContain("Invalid state transition")
		})
	})

	describe("checkPendingTimeout", () => {
		it("passes when within timeout", () => {
			const guard = new DeferredLifecycleGuard({ pendingToRunningTimeoutMs: 60000 })
			guard.transitionToPending(1)
			expect(guard.checkPendingTimeout().action).toBe("continue")
		})

		it("aborts when pending timeout exceeded", async () => {
			const guard = new DeferredLifecycleGuard({ pendingToRunningTimeoutMs: 1 })
			guard.transitionToPending(1)
			await new Promise((r) => setTimeout(r, 10))
			const result = guard.checkPendingTimeout()
			expect(result.action).toBe("abort")
			expect(result.reason).toContain("Pending-to-running timeout")
		})

		it("does not check timeout when not in pending phase", () => {
			const guard = new DeferredLifecycleGuard({ pendingToRunningTimeoutMs: 1 })
			const result = guard.checkPendingTimeout()
			expect(result.action).toBe("continue")
		})
	})

	describe("abort", () => {
		it("manually aborts the guard", () => {
			const guard = new DeferredLifecycleGuard()
			guard.abort("Manual abort")
			expect(guard.isAborted()).toBe(true)
			expect(guard.getPhase()).toBe("aborted")
		})

		it("prevents further transitions after abort", () => {
			const guard = new DeferredLifecycleGuard()
			guard.abort("Manual abort")
			const result = guard.transitionToPending(1)
			expect(result.action).toBe("abort")
			expect(result.reason).toContain("already aborted")
		})
	})

	describe("transitionToDone", () => {
		it("transitions to done phase", () => {
			const guard = new DeferredLifecycleGuard()
			guard.transitionToDone()
			expect(guard.getPhase()).toBe("done")
		})
	})

	describe("default config", () => {
		it("uses default config values", () => {
			expect(DEFAULT_LIFECYCLE_CONFIG.maxIterations).toBe(50)
			expect(DEFAULT_LIFECYCLE_CONFIG.maxDurationMs).toBe(120_000)
			expect(DEFAULT_LIFECYCLE_CONFIG.pendingToRunningTimeoutMs).toBe(300_000)
		})
	})

	describe("full lifecycle simulation", () => {
		it("supports a complete pending -> running -> pending -> done cycle", () => {
			const guard = new DeferredLifecycleGuard({ maxIterations: 10, maxDurationMs: 60000 })

			guard.transitionToPending(2)
			guard.incrementIteration()
			guard.recordToolCompletion()
			guard.recordToolCompletion()
			expect(guard.transitionToRunning().action).toBe("continue")

			guard.transitionToPending(1)
			guard.incrementIteration()
			guard.recordToolCompletion()
			expect(guard.transitionToRunning().action).toBe("continue")

			guard.transitionToDone()
			expect(guard.getPhase()).toBe("done")
		})

		it("aborts mid-lifecycle when iteration limit is hit", () => {
			const guard = new DeferredLifecycleGuard({ maxIterations: 1, maxDurationMs: 60000 })

			guard.transitionToPending(1)
			guard.incrementIteration()
			guard.recordToolCompletion()
			guard.transitionToRunning()

			guard.transitionToPending(1)
			const result = guard.incrementIteration()
			expect(result.action).toBe("abort")
			expect(guard.getPhase()).toBe("aborted")
		})
	})
})
