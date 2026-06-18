import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { Text } from "ink"
import { render } from "ink-testing-library"
import { act as reactAct } from "react"

import { StreamingText } from "../StreamingText.js"

function frameFor(content: string, isStreaming: boolean) {
	const { lastFrame } = render(<StreamingText content={content} isStreaming={isStreaming} />)
	return lastFrame() ?? ""
}

describe("StreamingText", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("renders the full content immediately when isStreaming=false", () => {
		const out = frameFor("hello world", false)
		expect(out).toBe("hello world")
	})

	it("starts empty (or partial) and reveals text progressively while streaming", () => {
		const { lastFrame } = render(<StreamingText content="hello world" isStreaming={true} intervalMs={24} />)
		// At t=0, no timer has fired yet → empty.
		expect(lastFrame() ?? "").toBe("")

		// After one step, some prefix should be visible.
		reactAct(() => {
			vi.advanceTimersByTime(24)
		})
		const after1 = lastFrame() ?? ""
		expect(after1.length).toBeGreaterThan(0)
		expect("hello world".startsWith(after1)).toBe(true)

		// Step through until the whole string is visible.
		reactAct(() => {
			vi.advanceTimersByTime(24 * 100)
		})
		expect(lastFrame() ?? "").toBe("hello world")
	})

	it("never reveals more than the current content (no overflow)", () => {
		const { lastFrame } = render(<StreamingText content="ab" isStreaming={true} intervalMs={10} />)
		reactAct(() => {
			vi.advanceTimersByTime(10_000)
		})
		expect(lastFrame() ?? "").toBe("ab")
	})

	it("continues from the current position when content grows (no rewind)", () => {
		const { lastFrame, rerender } = render(
			<StreamingText content="hello world" isStreaming={true} intervalMs={10} />,
		)

		// Reveal some prefix of the first chunk.
		reactAct(() => {
			vi.advanceTimersByTime(10)
		})
		const afterFirstStep = (lastFrame() ?? "").length
		expect(afterFirstStep).toBeGreaterThan(0)

		// Extend content — visible chars should only grow, not shrink.
		rerender(<StreamingText content="hello world and more" isStreaming={true} intervalMs={10} />)
		expect((lastFrame() ?? "").length).toBeGreaterThanOrEqual(afterFirstStep)

		// Step through to the end of the longer content.
		reactAct(() => {
			vi.advanceTimersByTime(10_000)
		})
		expect(lastFrame() ?? "").toBe("hello world and more")
	})

	it("reveals the full remaining tail when streaming ends", () => {
		const { lastFrame, rerender } = render(
			<StreamingText content="the quick brown fox" isStreaming={true} intervalMs={10} />,
		)
		// Partial reveal
		reactAct(() => {
			vi.advanceTimersByTime(10)
		})
		const partial = lastFrame() ?? ""
		expect(partial.length).toBeLessThan("the quick brown fox".length)

		// Flip isStreaming to false — full content should appear at once.
		// Wrap in act() so the synchronous setVisibleChars flush re-renders.
		reactAct(() => {
			rerender(<StreamingText content="the quick brown fox" isStreaming={false} intervalMs={10} />)
		})
		expect(lastFrame() ?? "").toBe("the quick brown fox")
	})

	it("honors a custom color prop via the underlying <Text>", () => {
		// We can't assert ANSI escape codes reliably across terminals, but
		// we can confirm the component renders without error when color is set.
		const { lastFrame } = render(
			<StreamingText content="ok" isStreaming={false} color="#ff0000" />,
		)
		expect(lastFrame() ?? "").toContain("ok")
	})

	it("stops stepping on unmount without throwing", () => {
		const { unmount } = render(<StreamingText content="hello" isStreaming={true} intervalMs={10} />)
		reactAct(() => {
			vi.advanceTimersByTime(5)
		})
		expect(() => unmount()).not.toThrow()
		// Further time advance should not raise.
		reactAct(() => {
			vi.advanceTimersByTime(10_000)
		})
	})
})
