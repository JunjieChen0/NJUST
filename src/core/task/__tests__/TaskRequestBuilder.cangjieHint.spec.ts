import { describe, expect, it } from "vitest"

import { resolveLastUserMessageTextForCangjieHint } from "../TaskRequestBuilder"

describe("resolveLastUserMessageTextForCangjieHint", () => {
	it("uses initial task text before first-turn API history exists", () => {
		expect(resolveLastUserMessageTextForCangjieHint([], "only run cjpm build")).toBe("only run cjpm build")
	})

	it("prefers the latest user history text on follow-up turns", () => {
		const history = [
			{ role: "user", content: "initial request" },
			{ role: "assistant", content: "done" },
			{ role: "user", content: [{ type: "text", text: "follow-up request" }] },
		] as never[]

		expect(resolveLastUserMessageTextForCangjieHint(history, "initial task")).toBe("follow-up request")
	})

	it("ignores synthetic delegation results when preserving the parent route", () => {
		const history = [
			{ role: "user", content: [{ type: "text", text: "implement a Cangjie function" }] },
			{ role: "assistant", content: "delegating" },
			{
				role: "user",
				content: [
					{ type: "text", text: "Subtask child-1 completed.\n\nResult:\nexploration complete" },
					{ type: "text", text: "<environment_details>internal</environment_details>" },
				],
			},
		] as never[]

		expect(resolveLastUserMessageTextForCangjieHint(history, "initial task")).toBe("implement a Cangjie function")
	})

	it("normalizes wrapped user messages and ignores runtime-generated reminders", () => {
		const history = [
			{
				role: "user",
				content: [
					{
						type: "text",
						text: "[USER-MESSAGE]\nadd quadrupleValue and build\n[END USER-MESSAGE]",
					},
					{ type: "text", text: "====\n# Environment Details\ninternal" },
				],
			},
			{ role: "assistant", content: "delegating" },
			{
				role: "user",
				content: [
					{ type: "text", text: "Subtask child-1 completed.\n\nResult:\nexploration complete" },
					{
						type: "text",
						text: "[ERROR] You did not use a tool in your previous response! Please retry with a tool use.",
					},
					{ type: "text", text: "====\n# Environment Details\ninternal" },
				],
			},
		] as never[]

		expect(resolveLastUserMessageTextForCangjieHint(history, "initial task")).toBe("add quadrupleValue and build")
	})
})
