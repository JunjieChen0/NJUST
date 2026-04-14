import { beforeEach, describe, expect, it, vi } from "vitest"

const summarizeConversation = vi.fn()

vi.mock("../../condense", () => ({
	summarizeConversation,
	MIN_CONDENSE_THRESHOLD: 30,
	MAX_CONDENSE_THRESHOLD: 95,
}))

describe("context-management cache-aware window", () => {
	beforeEach(() => {
		summarizeConversation.mockReset()
	})

	it("skips auto-condense when cache hit ratio is high using sliding-window denominator", async () => {
		const { manageContext } = await import("../index")

		const apiHandler = {
			countTokens: vi.fn().mockResolvedValue(1),
		} as any

		const result = await manageContext({
			messages: [{ role: "user", content: "hello" } as any],
			totalTokens: 80_000,
			contextWindow: 100_000,
			maxTokens: 8_000,
			apiHandler,
			autoCondenseContext: true,
			autoCondenseContextPercent: 70,
			systemPrompt: "system",
			taskId: "task-1",
			profileThresholds: {},
			currentProfileId: "default",
			cacheReadTokens: 30_000,
			cacheAwareTotalTokens: 35_000,
			enableMicroCompact: true,
		})

		expect(result.error).toBeUndefined()
		expect(summarizeConversation).not.toHaveBeenCalled()
	})
})
