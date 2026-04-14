import { describe, expect, it } from "vitest"

import { TaskStateMachine, TaskState } from "../TaskStateMachine"

describe("Task state machine integration (lightweight)", () => {
	it("covers processing -> waiting approval -> processing flow", () => {
		const sm = new TaskStateMachine()
		sm.transition(TaskState.PREPARING)
		sm.transition(TaskState.STREAMING)
		sm.transition(TaskState.PROCESSING_TOOLS)
		sm.transition(TaskState.WAITING_APPROVAL)
		sm.transition(TaskState.PREPARING)
		sm.transition(TaskState.STREAMING)
		sm.transition(TaskState.PROCESSING_TOOLS)
		expect(sm.state).toBe(TaskState.PROCESSING_TOOLS)
	})

	it("covers backoff retry recovery path", () => {
		const sm = new TaskStateMachine()
		sm.transition(TaskState.PREPARING)
		sm.transition(TaskState.STREAMING)
		sm.transition(TaskState.RECOVERING_MAX_TOKENS)
		sm.transition(TaskState.PREPARING)
		expect(sm.state).toBe(TaskState.PREPARING)
	})

	it("allows streaming to compacting recovery path", () => {
		const sm = new TaskStateMachine()
		sm.transition(TaskState.PREPARING)
		sm.transition(TaskState.STREAMING)
		sm.transition(TaskState.COMPACTING)
		sm.transition(TaskState.PREPARING)
		expect(sm.state).toBe(TaskState.PREPARING)
	})
})
