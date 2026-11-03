import { describe, expect, it, vi } from "vitest"
import { wrapApiHandler } from "../ApiRetryWrapper"

function fixture() {
	const closed = vi.fn()
	const createMessage = vi.fn(async function* () {
		try {
			yield { type: "text" as const, text: "partial" }
			yield { type: "text" as const, text: "rest" }
		} finally {
			closed()
		}
	})
	const handler = wrapApiHandler(
		{
			createMessage,
			getModel: () => ({ id: "fixture", info: { contextWindow: 16384, supportsPromptCache: false } }),
			countTokens: vi.fn().mockResolvedValue(0),
		},
		{ maxAttempts: 2, baseDelayMs: 0, jitterRatio: 0 },
	)
	return { closed, createMessage, stream: handler.createMessage("fixture", []) }
}

describe("stream wrapper disposal", () => {
	it("closes the underlying stream when the consumer returns after the first chunk", async () => {
		const { stream, closed, createMessage } = fixture()
		await stream.next()
		await stream.return(undefined)
		expect(closed).toHaveBeenCalledTimes(1)
		expect(createMessage).toHaveBeenCalledTimes(1)
	})
	it("does not treat a consumer error after the first chunk as a transport retry", async () => {
		const { stream, closed, createMessage } = fixture()
		await stream.next()
		const error = new Error("consumer stopped")
		await expect(stream.throw(error)).rejects.toBe(error)
		expect(closed).toHaveBeenCalledTimes(1)
		expect(createMessage).toHaveBeenCalledTimes(1)
	})
})
