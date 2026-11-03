import { describe, expect, it } from "vitest"
import { analyzeErrorForRetry } from "../ApiErrorClassifier"

describe("AI SDK HTTP error metadata", () => {
	it.each([400, 401, 403, 404])("does not retry SDK statusCode %s", (statusCode) => {
		expect(analyzeErrorForRetry({ statusCode, message: "request failed" }).shouldRetry).toBe(false)
	})
	it("honors SDK responseHeaders Retry-After on rate limiting", () => {
		expect(analyzeErrorForRetry({ statusCode: 429, responseHeaders: { "retry-after": "3" } })).toMatchObject({
			shouldRetry: true,
			retryAfterSeconds: 3,
		})
	})
	it("honors OpenAI plain object headers", () => {
		expect(analyzeErrorForRetry({ status: 429, headers: { "Retry-After": "4" } })).toMatchObject({
			shouldRetry: true,
			retryAfterSeconds: 4,
		})
	})
	it("retries SDK server errors", () => {
		expect(analyzeErrorForRetry({ statusCode: 503 }).shouldRetry).toBe(true)
	})
})
