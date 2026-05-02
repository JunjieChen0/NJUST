/**
 * Benchmark: Context compaction throughput.
 *
 * Measures how quickly different message sizes are processed through
 * the context management pipeline. Run with vitest benchmark:
 *   vitest run __tests__/benchmarks/ --reporter=benchmark
 */

import { describe, bench } from "vitest"
import { getEffectiveApiHistory, getMessagesSinceLastSummary } from "../../src/core/condense/index"

function makeMessages(count: number, withSummary: boolean) {
	const msgs: any[] = []
	for (let i = 0; i < count; i++) {
		msgs.push({
			role: i % 2 === 0 ? "user" : "assistant",
			content: `Message ${i}: ${"content ".repeat(20)}`,
			ts: i * 100,
		})
	}
	if (withSummary) {
		const condenseId = "bench-summary"
		// Tag all but last 3 as condensed
		for (let i = 0; i < msgs.length - 3; i++) {
			msgs[i].condenseParent = condenseId
		}
		// Insert summary before last 3
		msgs.splice(msgs.length - 3, 0, {
			role: "user",
			content: "Summary of all messages",
			ts: (msgs.length - 3) * 100 - 1,
			isSummary: true,
			condenseId,
		})
	}
	return msgs
}

describe("getEffectiveApiHistory", () => {
	bench("10 messages, no summary", () => {
		getEffectiveApiHistory(makeMessages(10, false))
	})

	bench("100 messages, no summary", () => {
		getEffectiveApiHistory(makeMessages(100, false))
	})

	bench("100 messages, with summary", () => {
		getEffectiveApiHistory(makeMessages(100, true))
	})

	bench("1000 messages, no summary", () => {
		getEffectiveApiHistory(makeMessages(1000, false))
	})

	bench("1000 messages, with summary", () => {
		getEffectiveApiHistory(makeMessages(1000, true))
	})
})

describe("getMessagesSinceLastSummary", () => {
	bench("100 messages, no summary", () => {
		getMessagesSinceLastSummary(makeMessages(100, false))
	})

	bench("1000 messages, with summary", () => {
		getMessagesSinceLastSummary(makeMessages(1000, true))
	})
})
