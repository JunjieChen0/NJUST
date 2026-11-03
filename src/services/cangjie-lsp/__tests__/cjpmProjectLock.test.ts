import { describe, it, expect, vi } from "vitest"

import * as path from "path"

import { withCjpmProjectLock } from "../cjpmProjectLock"

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((r) => (resolve = r))
	return { promise, resolve }
}

describe("withCjpmProjectLock", () => {
	const root = path.resolve("/ws/app")

	it("runs cjpm work for the same project one at a time", async () => {
		const order: string[] = []
		const gate = deferred()

		const first = withCjpmProjectLock(root, async () => {
			order.push("first:start")
			await gate.promise
			order.push("first:end")
		})
		const second = withCjpmProjectLock(root, async () => {
			order.push("second")
		})
		await Promise.resolve()
		gate.resolve()
		await Promise.all([first, second])

		expect(order).toEqual(["first:start", "first:end", "second"])
	})

	it("lets different projects run concurrently", async () => {
		const gate = deferred()
		const other = vi.fn(async () => undefined)

		const first = withCjpmProjectLock(root, () => gate.promise)
		await withCjpmProjectLock(path.resolve("/ws/other"), other)

		expect(other).toHaveBeenCalled()
		gate.resolve()
		await first
	})

	it("asks a preemptible holder to stop as soon as someone else needs the project", async () => {
		const gate = deferred()
		const preempt = vi.fn(() => gate.resolve())

		const baseline = withCjpmProjectLock(root, () => gate.promise, { preempt })
		await Promise.resolve()
		await withCjpmProjectLock(root, async () => undefined)
		await baseline

		expect(preempt).toHaveBeenCalledTimes(1)
	})

	it("preempts a preemptible request that only gets the lock while others are waiting", async () => {
		const gate = deferred()
		const preempt = vi.fn()

		const first = withCjpmProjectLock(root, () => gate.promise)
		const baseline = withCjpmProjectLock(root, async () => undefined, { preempt })
		const third = withCjpmProjectLock(root, async () => undefined)
		gate.resolve()
		await Promise.all([first, baseline, third])

		expect(preempt).toHaveBeenCalled()
	})

	it("releases the lock when the work throws", async () => {
		await expect(
			withCjpmProjectLock(root, async () => {
				throw new Error("boom")
			}),
		).rejects.toThrow("boom")

		await expect(withCjpmProjectLock(root, async () => "ok")).resolves.toBe("ok")
	})
})
