/**
 * Performance Baseline Tests (Phase 10 §8.5)
 *
 * Records performance metrics for both Ink and OpenTUI to enable comparison.
 */

import { describe, it, expect } from "vitest"
import { performance } from "perf_hooks"

describe("Performance Baseline Tests (Phase 10 §8.5)", () => {
	describe("Reducer Performance", () => {
		it("processes 1000 messages within 100ms", async () => {
			const { tuiReducer, initialTuiState } = await import("../runtime/extension-host-adapter.js")

			// Create session
			let state = tuiReducer(initialTuiState, {
				type: "session/create",
				payload: { id: "s1", workspacePath: "/test" },
			})

			// Process 1000 messages
			const start = performance.now()

			for (let i = 0; i < 1000; i++) {
				state = tuiReducer(state, {
					type: "message/create",
					payload: {
						id: `m${i}`,
						sessionId: "s1",
						role: i % 2 === 0 ? "user" : "assistant",
						createdAt: Date.now(),
						updatedAt: Date.now(),
						content: `Message ${i}`,
					},
				})
			}

			const elapsed = performance.now() - start

			// Should be well under 100ms for 1000 messages
			expect(elapsed).toBeLessThan(100)
			expect(state.messages.size).toBe(1000)
		})

		it("processes streaming deltas efficiently", async () => {
			const { tuiReducer, initialTuiState } = await import("../runtime/extension-host-adapter.js")

			// Setup
			let state = tuiReducer(initialTuiState, {
				type: "session/create",
				payload: { id: "s1", workspacePath: "/test" },
			})

			state = tuiReducer(state, {
				type: "part/create",
				payload: {
					id: "p1",
					messageId: "m1",
					sessionId: "s1",
					type: "text",
					status: "streaming",
				},
			})

			// Simulate 1000 streaming deltas
			const start = performance.now()

			for (let i = 0; i < 1000; i++) {
				state = tuiReducer(state, {
					type: "part/update",
					payload: { id: "p1", delta: `chunk${i} ` },
				})
			}

			const elapsed = performance.now() - start

			// Streaming updates should be very fast
			expect(elapsed).toBeLessThan(50)
		})
	})

	describe("IPC Protocol Performance", () => {
		it("serializes 100 messages within 10ms", async () => {
			const { IpcProtocol } = await import("../runtime/ipc-protocol.js")

			const messages = Array.from({ length: 100 }, (_, i) =>
				IpcProtocol.createEvent("message", { index: i, text: `Message ${i}` }),
			)

			const start = performance.now()

			for (const msg of messages) {
				IpcProtocol.serialize(msg)
			}

			const elapsed = performance.now() - start

			expect(elapsed).toBeLessThan(10)
		})

		it("parses 100 messages within 10ms", async () => {
			const { IpcProtocol } = await import("../runtime/ipc-protocol.js")

			const messages = Array.from({ length: 100 }, () =>
				IpcProtocol.serialize(IpcProtocol.createEvent("message", { test: true })),
			).join("")

			const start = performance.now()
			IpcProtocol.parse(messages)
			const elapsed = performance.now() - start

			expect(elapsed).toBeLessThan(10)
		})
	})

	describe("Prompt History Performance", () => {
		it("handles 1000 history entries", async () => {
			const { PromptHistory } = await import("../components/prompt/history.js")

			const history = new PromptHistory([], 1000)

			const start = performance.now()

			for (let i = 0; i < 1000; i++) {
				history.add(`Command ${i}`)
			}

			const elapsed = performance.now() - start

			expect(elapsed).toBeLessThan(200) // disk I/O adds overhead vs pure memory
			expect(history.size()).toBeLessThanOrEqual(1000)
		})

		it("deduplicates entries efficiently", async () => {
			const { PromptHistory } = await import("../components/prompt/history.js")

			const history = new PromptHistory([], 100)

			// Add same command 100 times
			for (let i = 0; i < 100; i++) {
				history.add("duplicate command")
			}

			expect(history.size()).toBe(1)
		})

		it("searches history efficiently", async () => {
			const { PromptHistory } = await import("../components/prompt/history.js")

			const history = new PromptHistory([], 1000)

			for (let i = 0; i < 1000; i++) {
				history.add(`git commit -m "fix: issue ${i}"`)
			}

			const start = performance.now()
			const results = history.search("commit")
			const elapsed = performance.now() - start

			expect(elapsed).toBeLessThan(10)
			expect(results.length).toBe(1000)
		})
	})
})
