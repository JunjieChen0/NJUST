import { describe, expect, it } from "vitest"

import { TOKEN_BUFFER_TOKENS, willManageContext } from "../index"

describe("context-management dynamic threshold", () => {
	it("uses contextWindow - maxTokens - buffer for hard trigger", () => {
		const contextWindow = 100_000
		const maxTokens = 20_000
		const allowedTokens = contextWindow - maxTokens - TOKEN_BUFFER_TOKENS

		const below = willManageContext({
			totalTokens: allowedTokens - 1,
			contextWindow,
			maxTokens,
			autoCondenseContext: false,
			autoCondenseContextPercent: 95,
			profileThresholds: {},
			currentProfileId: "default",
			lastMessageTokens: 0,
		})
		expect(below).toBe(false)

		const above = willManageContext({
			totalTokens: allowedTokens + 1,
			contextWindow,
			maxTokens,
			autoCondenseContext: false,
			autoCondenseContextPercent: 95,
			profileThresholds: {},
			currentProfileId: "default",
			lastMessageTokens: 0,
		})
		expect(above).toBe(true)
	})
})
