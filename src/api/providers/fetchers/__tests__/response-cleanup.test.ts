import { describe, expect, it, vi } from "vitest"
import { readBodyWithLimit } from "../safeFetch"

describe("response body limit cleanup", () => {
	it("reports an oversized response even if cancellation never settles", async () => {
		let finishCancel!: () => void
		const cancel = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finishCancel = resolve
				}),
		)
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array(10))
				},
				cancel,
			}),
		)
		let settled = false
		const result = readBodyWithLimit(response, 1).catch((error) => {
			settled = true
			return error
		})
		try {
			await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 })
			expect(await result).toMatchObject({ message: expect.stringContaining("size limit") })
			expect(cancel).toHaveBeenCalledTimes(1)
		} finally {
			finishCancel?.()
			await result
		}
	})
})
