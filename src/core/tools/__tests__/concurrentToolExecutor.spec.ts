import { describe, expect, it } from "vitest"

import { ConcurrentToolExecutor } from "../ConcurrentToolExecutor"

describe("ConcurrentToolExecutor", () => {
	it("runs all tasks", async () => {
		const ex = new ConcurrentToolExecutor({ maxConcurrency: 3 })
		const input = [1, 2, 3, 4, 5]
		const out: number[] = []
		await ex.run(input, async (x) => {
			out.push(x)
		})
		expect(out.sort((a, b) => a - b)).toEqual(input)
	})

	it("aborts siblings in fail-fast mode", async () => {
		const ex = new ConcurrentToolExecutor({ maxConcurrency: 3 })
		const input = [1, 2, 3, 4, 5, 6]
		let observedAbortSignal = false

		await expect(
			ex.run(
				input,
				async (x, _idx, ctx) => {
					if (x === 2) {
						throw new Error("boom")
					}

					await Promise.race([
						new Promise<void>((resolve) => setTimeout(resolve, 30)),
						new Promise<void>((resolve) => {
							if (ctx.signal.aborted) {
								observedAbortSignal = true
								resolve()
								return
							}
							ctx.signal.addEventListener(
								"abort",
								() => {
									observedAbortSignal = true
									resolve()
								},
								{ once: true },
							)
						}),
					])
				},
				{ failFast: true },
			),
		).rejects.toThrow("ConcurrentToolExecutor")

		expect(observedAbortSignal).toBe(true)
	})
})
