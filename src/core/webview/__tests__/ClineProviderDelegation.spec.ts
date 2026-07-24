import { describe, expect, it } from "vitest"

import { appendDelegationCompletionToApiMessages } from "../ClineProviderDelegation"

describe("appendDelegationCompletionToApiMessages", () => {
	it("adds a matching result when delegation is the latest assistant call", () => {
		const messages: any[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "agent-1", name: "agent", input: {} }],
			},
		]

		appendDelegationCompletionToApiMessages(messages, "child-1", "exploration complete")

		expect(messages.at(-1)).toMatchObject({
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "agent-1",
					content: expect.stringContaining("exploration complete"),
				},
			],
		})
	})

	it("updates an interrupted delegation result in place", () => {
		const messages: any[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "agent-1", name: "agent", input: {} }],
			},
			{
				role: "user",
				content: [{ type: "tool_result", tool_use_id: "agent-1", content: "interrupted" }],
			},
		]

		appendDelegationCompletionToApiMessages(messages, "child-1", "exploration complete")

		expect(messages).toHaveLength(2)
		expect(messages[1].content[0].content).toContain("exploration complete")
	})

	it("does not attach a late delegation result to a newer tool call", () => {
		const messages: any[] = [
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "agent-1", name: "agent", input: {} }],
			},
			{
				role: "assistant",
				content: [{ type: "tool_use", id: "read-1", name: "read_file", input: {} }],
			},
		]

		appendDelegationCompletionToApiMessages(messages, "child-1", "exploration complete")

		expect(messages.at(-1)).toMatchObject({
			role: "user",
			content: [{ type: "text", text: expect.stringContaining("exploration complete") }],
		})
	})
})
