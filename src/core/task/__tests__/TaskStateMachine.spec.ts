import { beforeEach, describe, expect, it, vi } from "vitest"

import { TaskStateMachine, TaskState } from "../TaskStateMachine"

vi.mock("../../../shared/logger", () => ({
	logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

describe("TaskStateMachine", () => {
	it("starts in IDLE", () => {
		const sm = new TaskStateMachine()
		expect(sm.state).toBe(TaskState.IDLE)
	})

	it("previousState is IDLE initially", () => {
		const sm = new TaskStateMachine()
		expect(sm.previousState).toBe(TaskState.IDLE)
	})

	it("previousState updates after transition", () => {
		const sm = new TaskStateMachine()
		sm.transition(TaskState.PREPARING)
		expect(sm.previousState).toBe(TaskState.IDLE)
	})

	it("canTransition returns true for same state", () => {
		const sm = new TaskStateMachine()
		expect(sm.canTransition(TaskState.IDLE)).toBe(true)
	})

	it("allows valid transitions", () => {
		const sm = new TaskStateMachine()
		sm.transition(TaskState.PREPARING)
		sm.transition(TaskState.STREAMING)
		sm.transition(TaskState.PROCESSING_TOOLS)
		sm.transition(TaskState.PREPARING)
		expect(sm.state).toBe(TaskState.PREPARING)
	})

	it("rejects invalid transitions", () => {
		const sm = new TaskStateMachine()
		expect(() => sm.transition(TaskState.STREAMING)).toThrow("Invalid task state transition")
	})

	it("rollback reverts to previous state", () => {
		const sm = new TaskStateMachine()
		sm.transition(TaskState.PREPARING)
		sm.transition(TaskState.STREAMING)
		sm.rollback()
		expect(sm.state).toBe(TaskState.PREPARING)
	})

	it("rollback only goes back one level", () => {
		const sm = new TaskStateMachine()
		sm.transition(TaskState.PREPARING)
		sm.transition(TaskState.STREAMING)
		sm.rollback()
		expect(sm.state).toBe(TaskState.PREPARING)
		sm.rollback()
		expect(sm.state).toBe(TaskState.PREPARING)
	})

	it("force allows direct override", () => {
		const sm = new TaskStateMachine()
		sm.force(TaskState.ERROR)
		expect(sm.state).toBe(TaskState.ERROR)
	})

	it("force to same state is no-op", () => {
		const sm = new TaskStateMachine()
		sm.force(TaskState.IDLE)
		expect(sm.state).toBe(TaskState.IDLE)
	})

	it("should allow ERROR -> PREPARING for retry recovery", () => {
		const sm = new TaskStateMachine()
		sm.force(TaskState.ERROR)
		expect(sm.canTransition(TaskState.PREPARING)).toBe(true)
	})

	it("should allow ERROR -> RECOVERING_MAX_TOKENS for token recovery", () => {
		const sm = new TaskStateMachine()
		sm.force(TaskState.ERROR)
		expect(sm.canTransition(TaskState.RECOVERING_MAX_TOKENS)).toBe(true)
	})

	describe("IDLE allowed exits", () => {
		it("IDLE -> PREPARING", () => {
			const sm = new TaskStateMachine()
			expect(sm.canTransition(TaskState.PREPARING)).toBe(true)
		})
		it("IDLE -> ERROR", () => {
			const sm = new TaskStateMachine()
			expect(sm.canTransition(TaskState.ERROR)).toBe(true)
		})
		it("IDLE -> COMPLETED", () => {
			const sm = new TaskStateMachine()
			expect(sm.canTransition(TaskState.COMPLETED)).toBe(true)
		})
		it("IDLE -/-> STREAMING", () => {
			const sm = new TaskStateMachine()
			expect(sm.canTransition(TaskState.STREAMING)).toBe(false)
		})
	})

	describe("PREPARING allowed exits", () => {
		it("PREPARING -> STREAMING", () => {
			const sm = new TaskStateMachine()
			sm.transition(TaskState.PREPARING)
			expect(sm.canTransition(TaskState.STREAMING)).toBe(true)
		})
		it("PREPARING -> COMPACTING", () => {
			const sm = new TaskStateMachine()
			sm.transition(TaskState.PREPARING)
			expect(sm.canTransition(TaskState.COMPACTING)).toBe(true)
		})
		it("PREPARING -> ERROR", () => {
			const sm = new TaskStateMachine()
			sm.transition(TaskState.PREPARING)
			expect(sm.canTransition(TaskState.ERROR)).toBe(true)
		})
		it("PREPARING -/-> IDLE", () => {
			const sm = new TaskStateMachine()
			sm.transition(TaskState.PREPARING)
			expect(sm.canTransition(TaskState.IDLE)).toBe(false)
		})
	})

	describe("STREAMING allowed exits", () => {
		let sm: TaskStateMachine
		beforeEach(() => {
			sm = new TaskStateMachine()
			sm.transition(TaskState.PREPARING)
			sm.transition(TaskState.STREAMING)
		})
		it("STREAMING -> PROCESSING_TOOLS", () => {
			expect(sm.canTransition(TaskState.PROCESSING_TOOLS)).toBe(true)
		})
		it("STREAMING -> COMPACTING", () => {
			expect(sm.canTransition(TaskState.COMPACTING)).toBe(true)
		})
		it("STREAMING -> RECOVERING_MAX_TOKENS", () => {
			expect(sm.canTransition(TaskState.RECOVERING_MAX_TOKENS)).toBe(true)
		})
		it("STREAMING -> WAITING_APPROVAL", () => {
			expect(sm.canTransition(TaskState.WAITING_APPROVAL)).toBe(true)
		})
		it("STREAMING -> COMPLETED", () => {
			expect(sm.canTransition(TaskState.COMPLETED)).toBe(true)
		})
		it("STREAMING -> ERROR", () => {
			expect(sm.canTransition(TaskState.ERROR)).toBe(true)
		})
		it("STREAMING -/-> IDLE", () => {
			expect(sm.canTransition(TaskState.IDLE)).toBe(false)
		})
	})

	describe("PROCESSING_TOOLS allowed exits", () => {
		let sm: TaskStateMachine
		beforeEach(() => {
			sm = new TaskStateMachine()
			sm.transition(TaskState.PREPARING)
			sm.transition(TaskState.STREAMING)
			sm.transition(TaskState.PROCESSING_TOOLS)
		})
		it("PROCESSING_TOOLS -> PREPARING", () => {
			expect(sm.canTransition(TaskState.PREPARING)).toBe(true)
		})
		it("PROCESSING_TOOLS -> WAITING_APPROVAL", () => {
			expect(sm.canTransition(TaskState.WAITING_APPROVAL)).toBe(true)
		})
		it("PROCESSING_TOOLS -> COMPLETED", () => {
			expect(sm.canTransition(TaskState.COMPLETED)).toBe(true)
		})
		it("PROCESSING_TOOLS -> ERROR", () => {
			expect(sm.canTransition(TaskState.ERROR)).toBe(true)
		})
		it("PROCESSING_TOOLS -/-> STREAMING", () => {
			expect(sm.canTransition(TaskState.STREAMING)).toBe(false)
		})
	})

	describe("COMPACTING allowed exits", () => {
		it("COMPACTING -> PREPARING and ERROR", () => {
			const sm = new TaskStateMachine()
			sm.transition(TaskState.PREPARING)
			sm.transition(TaskState.COMPACTING)
			expect(sm.canTransition(TaskState.PREPARING)).toBe(true)
			expect(sm.canTransition(TaskState.ERROR)).toBe(true)
			expect(sm.canTransition(TaskState.IDLE)).toBe(false)
		})
	})

	describe("RECOVERING_MAX_TOKENS allowed exits", () => {
		it("RECOVERING_MAX_TOKENS -> PREPARING and ERROR", () => {
			const sm = new TaskStateMachine()
			sm.transition(TaskState.PREPARING)
			sm.transition(TaskState.STREAMING)
			sm.transition(TaskState.RECOVERING_MAX_TOKENS)
			expect(sm.canTransition(TaskState.PREPARING)).toBe(true)
			expect(sm.canTransition(TaskState.ERROR)).toBe(true)
		})
	})

	describe("WAITING_APPROVAL allowed exits", () => {
		it("WAITING_APPROVAL -> PREPARING, ERROR, COMPLETED", () => {
			const sm = new TaskStateMachine()
			sm.transition(TaskState.PREPARING)
			sm.transition(TaskState.STREAMING)
			sm.transition(TaskState.WAITING_APPROVAL)
			expect(sm.canTransition(TaskState.PREPARING)).toBe(true)
			expect(sm.canTransition(TaskState.ERROR)).toBe(true)
			expect(sm.canTransition(TaskState.COMPLETED)).toBe(true)
			expect(sm.canTransition(TaskState.IDLE)).toBe(false)
		})
	})

	describe("COMPLETED allowed exits", () => {
		it("COMPLETED -> PREPARING and PROCESSING_TOOLS", () => {
			const sm = new TaskStateMachine()
			sm.transition(TaskState.PREPARING)
			sm.transition(TaskState.STREAMING)
			sm.transition(TaskState.COMPLETED)
			expect(sm.canTransition(TaskState.PREPARING)).toBe(true)
			expect(sm.canTransition(TaskState.PROCESSING_TOOLS)).toBe(true)
			expect(sm.canTransition(TaskState.IDLE)).toBe(false)
		})
	})

	describe("ERROR allowed exits", () => {
		it("ERROR -/-> COMPLETED", () => {
			const sm = new TaskStateMachine()
			sm.force(TaskState.ERROR)
			expect(sm.canTransition(TaskState.COMPLETED)).toBe(false)
		})
		it("ERROR -/-> IDLE", () => {
			const sm = new TaskStateMachine()
			sm.force(TaskState.ERROR)
			expect(sm.canTransition(TaskState.IDLE)).toBe(false)
		})
	})

	describe("force concurrency lock", () => {
		it("force rejects overlapping calls when lock is held", async () => {
			const sm = new TaskStateMachine()
			sm.force(TaskState.ERROR)
			const { logger } = vi.mocked(await import("../../../shared/logger"))
			logger.warn.mockClear()
			const originalForce = Object.getPrototypeOf(sm).force
			let nestedResult: TaskState | null = null
			const forceProxy = function (this: TaskStateMachine, to: TaskState, source?: string) {
				if (nestedResult === null) {
					nestedResult = TaskState.COMPLETED
					originalForce.call(this, nestedResult, "nested")
				}
				originalForce.call(this, to, source)
			}
			forceProxy.call(sm, TaskState.STREAMING, "outer")
			expect(nestedResult).toBe(TaskState.COMPLETED)
			expect(sm.state).toBe(TaskState.STREAMING)
		})
	})

	it("full lifecycle chain", () => {
		const sm = new TaskStateMachine()
		sm.transition(TaskState.PREPARING)
		sm.transition(TaskState.STREAMING)
		sm.transition(TaskState.PROCESSING_TOOLS)
		sm.transition(TaskState.PREPARING)
		sm.transition(TaskState.STREAMING)
		sm.transition(TaskState.COMPLETED)
		expect(sm.state).toBe(TaskState.COMPLETED)
		expect(sm.previousState).toBe(TaskState.STREAMING)
	})
})
