import { describe, expect, it } from "vitest"

import { classifyApiError } from "../apiErrorClassifier.js"

describe("classifyApiError", () => {
	it.each([
		[{ message: "payload too large" }, "media_too_large"],
		[{ message: "blocked by content policy" }, "content_policy"],
		[{ message: "invalid tool schema" }, "invalid_tool_use"],
		[{ message: "prompt is too long" }, "prompt_too_long"],
		[{ message: "max output tokens reached" }, "max_output_tokens"],
		[{ message: "context window exceeded" }, "context_window_exceeded"],
		[{ stop_reason: "max_tokens" }, "partial_response"],
		[{ status: 429 }, "rate_limit"],
		[{ status: 401 }, "auth_error"],
		[{ status: 529 }, "capacity"],
		[{ status: 503 }, "model_overloaded"],
		[{ status: 500 }, "server_error"],
		[{ message: "socket hang up" }, "stale_connection"],
		[{ code: "ETIMEDOUT" }, "timeout"],
		[{ message: "fetch failed" }, "network_error"],
		[null, "unknown"],
	] as const)("classifies %o as %s", (error, kind) => {
		expect(classifyApiError(error)).toBe(kind)
	})
})
