import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { useState, act as reactAct } from "react"
import { Text } from "ink"
import { render } from "ink-testing-library"

import { useFooterWelcome } from "../useFooterWelcome.js"

/**
 * Test harness: renders the hook's current value as text so we can
 * assert on the rendered frame. We can't use `@testing-library/react`'s
 * `renderHook` (not installed), so we drive the hook through Ink.
 */
function Harness({ connected }: { connected: boolean }) {
	const welcome = useFooterWelcome(connected)
	return <Text>{welcome ? "WELCOME" : "IDLE"}</Text>
}

/** Helper to advance fake timers and flush React's state updates. */
function advance(ms: number) {
	reactAct(() => {
		vi.advanceTimersByTime(ms)
	})
}

/** Helper to run a callback inside act and flush React updates. */
function flushCallback<T>(fn: () => T): T {
	let result: T
	reactAct(() => {
		result = fn()
	})
	return result!
}

describe("useFooterWelcome", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
		delete (globalThis as { __setConnected?: (v: boolean) => void }).__setConnected
	})

	it("starts with welcome=false (no nudge on launch)", () => {
		const { lastFrame } = render(<Harness connected={false} />)
		expect(lastFrame() ?? "").toContain("IDLE")
	})

	it("stays false during the initial 10s grace period", () => {
		const { lastFrame } = render(<Harness connected={false} />)
		advance(9_999)
		expect(lastFrame() ?? "").toContain("IDLE")
	})

	it("turns welcome=true after the 10s grace period", () => {
		const { lastFrame } = render(<Harness connected={false} />)
		advance(10_000)
		expect(lastFrame() ?? "").toContain("WELCOME")
	})

	it("cycles: true for 5s, then false for 10s, then true again", () => {
		const { lastFrame } = render(<Harness connected={false} />)

		// First appearance at t=10s
		advance(10_000)
		expect(lastFrame() ?? "").toContain("WELCOME")

		// Stays true through t=15s - 1ms
		advance(4_999)
		expect(lastFrame() ?? "").toContain("WELCOME")

		// Turns false at t=15s (5s of welcome elapsed)
		advance(1)
		expect(lastFrame() ?? "").toContain("IDLE")

		// Stays false through t=25s - 1ms
		advance(9_999)
		expect(lastFrame() ?? "").toContain("IDLE")

		// Turns true again at t=25s (10s of hide elapsed)
		advance(1)
		expect(lastFrame() ?? "").toContain("WELCOME")
	})

	it("never shows the nudge when connected=true from the start", () => {
		const { lastFrame } = render(<Harness connected={true} />)
		advance(60_000)
		expect(lastFrame() ?? "").toContain("IDLE")
	})

	describe("mid-cycle connect", () => {
		function ToggleHarness() {
			const [connected, setConnected] = useState(false)
			const welcome = useFooterWelcome(connected)
			;(globalThis as { __setConnected?: (v: boolean) => void }).__setConnected = setConnected
			return (
				<Text>
					{connected ? "CONNECTED" : "DISCONNECTED"} {welcome ? "WELCOME" : "IDLE"}
				</Text>
			)
		}

		it("resets to false and stops cycling when connected becomes true mid-cycle", () => {
			const { lastFrame } = render(<ToggleHarness />)

			// Let the welcome nudge appear
			advance(10_000)
			expect(lastFrame() ?? "").toContain("WELCOME")

			// Connect — should reset to false immediately and stop cycling
			const setter = (globalThis as { __setConnected?: (v: boolean) => void }).__setConnected
			expect(setter).toBeDefined()
			flushCallback(() => setter?.(true))
			expect(lastFrame() ?? "").toContain("IDLE")

			// Advance well past a full cycle; should remain IDLE
			advance(60_000)
			expect(lastFrame() ?? "").toContain("IDLE")
		})
	})

	it("cleans up pending timers on unmount", () => {
		const { unmount } = render(<Harness connected={false} />)
		// Should not throw when timers are pending during unmount
		advance(5_000)
		expect(() => unmount()).not.toThrow()
		// Further time advancement should not trigger any state updates
		// (no setState-after-unmount warnings)
		advance(30_000)
	})
})
