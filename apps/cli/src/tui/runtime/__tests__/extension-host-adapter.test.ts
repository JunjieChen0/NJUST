import { describe, it, expect } from "vitest"
import { tuiReducer, initialTuiState } from "../extension-host-adapter.ts"
import type { TuiAction } from "../types.ts"

describe("tuiReducer", () => {
	it("creates session", () => {
		const action: TuiAction = {
			type: "session/create",
			payload: { id: "s1", workspacePath: "/test" },
		}
		const state = tuiReducer(initialTuiState, action)

		expect(state.sessions.has("s1")).toBe(true)
		expect(state.currentSessionId).toBe("s1")
		expect(state.sessions.get("s1")?.status).toBe("starting")
	})

	it("updates session status", () => {
		let state = tuiReducer(initialTuiState, {
			type: "session/create",
			payload: { id: "s1", workspacePath: "/test" },
		})
		state = tuiReducer(state, {
			type: "session/update",
			payload: { id: "s1", status: "running" },
		})

		expect(state.sessions.get("s1")?.status).toBe("running")
	})

	it("creates message", () => {
		let state = tuiReducer(initialTuiState, {
			type: "session/create",
			payload: { id: "s1", workspacePath: "/test" },
		})
		state = tuiReducer(state, {
			type: "message/create",
			payload: {
				id: "m1",
				sessionId: "s1",
				role: "user",
				createdAt: 1000,
				updatedAt: 1000,
				content: "Hello",
			},
		})

		expect(state.messages.has("m1")).toBe(true)
		expect(state.sessions.get("s1")?.messages).toHaveLength(1)
	})

	it("creates part and updates", () => {
		let state = tuiReducer(initialTuiState, {
			type: "part/create",
			payload: {
				id: "p1",
				messageId: "m1",
				sessionId: "s1",
				type: "text",
				status: "streaming",
			},
		})
		state = tuiReducer(state, {
			type: "part/update",
			payload: { id: "p1", delta: "Hello" },
		})

		expect(state.parts.get("p1")?.delta).toBe("Hello")
	})

	it("completes part", () => {
		let state = tuiReducer(initialTuiState, {
			type: "part/create",
			payload: {
				id: "p1",
				messageId: "m1",
				sessionId: "s1",
				type: "text",
				status: "streaming",
			},
		})
		state = tuiReducer(state, {
			type: "part/complete",
			payload: { id: "p1", content: "Hello world" },
		})

		expect(state.parts.get("p1")?.status).toBe("completed")
		expect(state.parts.get("p1")?.content).toBe("Hello world")
	})

	it("fails part", () => {
		let state = tuiReducer(initialTuiState, {
			type: "part/create",
			payload: {
				id: "p1",
				messageId: "m1",
				sessionId: "s1",
				type: "tool",
				status: "streaming",
			},
		})
		state = tuiReducer(state, {
			type: "part/fail",
			payload: { id: "p1", error: "Tool failed" },
		})

		expect(state.parts.get("p1")?.status).toBe("failed")
		expect(state.parts.get("p1")?.toolError).toBe("Tool failed")
	})

	it("completes task", () => {
		let state = tuiReducer(initialTuiState, {
			type: "session/create",
			payload: { id: "s1", workspacePath: "/test" },
		})
		state = tuiReducer(state, {
			type: "task/complete",
			payload: { success: true },
		})

		expect(state.sessions.get("s1")?.status).toBe("completed")
	})

	it("cancels task", () => {
		let state = tuiReducer(initialTuiState, {
			type: "session/create",
			payload: { id: "s1", workspacePath: "/test" },
		})
		state = tuiReducer(state, {
			type: "task/cancel",
			payload: { reason: "user" },
		})

		expect(state.sessions.get("s1")?.status).toBe("cancelled")
	})

	it("fails task", () => {
		let state = tuiReducer(initialTuiState, {
			type: "session/create",
			payload: { id: "s1", workspacePath: "/test" },
		})
		state = tuiReducer(state, {
			type: "task/fail",
			payload: { error: "Something went wrong" },
		})

		expect(state.sessions.get("s1")?.status).toBe("failed")
	})

	it("is immutable", () => {
		const action: TuiAction = {
			type: "session/create",
			payload: { id: "s1", workspacePath: "/test" },
		}
		const state1 = tuiReducer(initialTuiState, action)
		const state2 = tuiReducer(state1, action)

		expect(state1).not.toBe(state2)
		expect(state1.sessions).not.toBe(state2.sessions)
	})
})
