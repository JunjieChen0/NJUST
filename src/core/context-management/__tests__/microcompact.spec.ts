import { describe, expect, it } from "vitest"

import type { ApiMessage } from "../../task-persistence/apiMessages"
import { microcompactMessages } from "../microcompact"

describe("microcompactMessages", () => {
	it("returns original messages when disabled", () => {
		const messages: ApiMessage[] = [{ role: "user", content: "hello" }]
		const result = microcompactMessages(messages, { enabled: false })
		expect(result).toBe(messages)
	})

	it("keeps empty list unchanged", () => {
		const messages: ApiMessage[] = []
		const result = microcompactMessages(messages)
		expect(result).toBe(messages)
	})

	it("compacts oversized historical tool_result content", () => {
		const huge = Array.from({ length: 1800 }, (_, i) => `line-${i}: ${"x".repeat(40)}`).join("\n")
		const messages: ApiMessage[] = [
			{ role: "user", content: "turn-1" },
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "tool-1", content: huge } as any],
			},
			{ role: "user", content: "turn-current" },
		]

		const result = microcompactMessages(messages)
		const compacted = ((result[1].content as any[])[0]?.content as string) ?? ""
		expect(compacted.length).toBeLessThan(huge.length)
		expect(compacted).toContain("内容已裁剪")
	})
})
