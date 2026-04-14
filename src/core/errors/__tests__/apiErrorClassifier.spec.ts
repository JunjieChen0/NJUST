import { describe, expect, it } from "vitest"

import { classifyApiError } from "../apiErrorClassifier"

describe("classifyApiError", () => {
	it("classifies prompt too long", () => {
		expect(classifyApiError(new Error("Prompt too long for model context"))).toBe("prompt_too_long")
	})

	it("classifies max output tokens", () => {
		expect(classifyApiError(new Error("stop reason: max_output_tokens"))).toBe("max_output_tokens")
	})

	it("classifies rate limit by status", () => {
		expect(classifyApiError({ status: 429, message: "Too many requests" })).toBe("rate_limit")
	})
})
