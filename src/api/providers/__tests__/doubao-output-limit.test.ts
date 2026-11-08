import { beforeEach, describe, expect, it, vi } from "vitest"

import { doubaoDefaultModelId, doubaoModels } from "@njust-ai/core/providers"
import { DoubaoHandler } from "../doubao"

const { create } = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock("openai", () => ({
	default: vi.fn().mockImplementation(function () {
		return { chat: { completions: { create } } }
	}),
}))

describe("Volcengine output limits", () => {
	beforeEach(() => {
		create.mockReset().mockImplementation(async function* () {
			yield { choices: [{ delta: { content: "Completed" } }] }
		})
	})

	it.each([undefined, 0])("omits estimated limits for unknown models with override %s", async (modelMaxTokens) => {
		const handler = new DoubaoHandler({
			doubaoApiKey: "test-key",
			apiModelId: "unknown-coding-model",
			modelMaxTokens,
		})
		expect(handler.getModel().info.estimatedFields).toContain("maxTokens")
		for await (const chunk of handler.createMessage("Test", [{ role: "user", content: "Hello" }])) {
			void chunk
		}
		expect(create).toHaveBeenCalledOnce()
		expect(create.mock.calls[0][0]).not.toHaveProperty("max_completion_tokens")
	})

	it.each([
		{ apiModelId: "unknown-coding-model", modelMaxTokens: 8192, expected: 8192 },
		{ apiModelId: doubaoDefaultModelId, expected: doubaoModels[doubaoDefaultModelId].maxTokens },
	])("preserves explicit or known limits for $apiModelId", async ({ apiModelId, modelMaxTokens, expected }) => {
		const handler = new DoubaoHandler({ doubaoApiKey: "test-key", apiModelId, modelMaxTokens })
		for await (const chunk of handler.createMessage("Test", [{ role: "user", content: "Hello" }])) {
			void chunk
		}
		expect(create).toHaveBeenCalledOnce()
		expect(create.mock.calls[0][0].max_completion_tokens).toBe(expected)
	})
})
