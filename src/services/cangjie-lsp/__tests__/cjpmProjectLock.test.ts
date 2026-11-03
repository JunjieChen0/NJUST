import { describe, it, expect, vi } from "vitest"

import * as path from "path"

import { acquireCjpmProjectLock, CjpmLockUnavailableError, withCjpmProjectLock } from "../cjpmProjectLock"

function deferred() {
	let resolve!: () => void
	const promise = new Promise<void>((r) => (resolve = r))
	return { promise, resolve }
}

describe("withCjpmProjectLock", () => {
	const root = path.resolve("/ws/app")

	it.each(["timeout", "aborted"] as const)(
		"removes a waiter after %s without bypassing the holder or blocking successors",
		async (reason) => {
			vi.useFakeTimers()
			const releaseHolder = await acquireCjpmProjectLock(root)
			const controller = new AbortController()
			const abandoned = acquireCjpmProjectLock(root, { signal: controller.signal, timeoutMs: 10 })
			const failure = expect(abandoned).rejects.toMatchObject({ name: "CjpmLockUnavailableError", reason })
			let acquiredNext = false
			const next = acquireCjpmProjectLock(root).then((release) => {
				acquiredNext = true
				return release
			})
			let releaseNext: (() => void) | undefined
			let releaseLast: (() => void) | undefined
			try {
				if (reason === "aborted") controller.abort()
				else await vi.advanceTimersByTimeAsync(10)
				await failure
				expect(acquiredNext).toBe(false)
				// A request queued AFTER the abandonment must still wait behind the existing successor.
				let acquiredLast = false
				const last = acquireCjpmProjectLock(root).then((release) => {
					acquiredLast = true
					return release
				})
				releaseHolder()
				releaseNext = await next
				expect(acquiredLast).toBe(false)
				releaseNext()
				releaseLast = await last
				releaseLast()
				const preemptWhenFree = vi.fn()
				await expect(withCjpmProjectLock(root, async () => "free", { preempt: preemptWhenFree })).resolves.toBe(
					"free",
				)
				expect(preemptWhenFree).not.toHaveBeenCalled()
			} finally {
				releaseHolder()
				releaseNext?.()
				releaseLast?.()
				vi.useRealTimers()
			}
		},
	)

	it("rejects an already-aborted request without preempting the holder", async () => {
		const preempt = vi.fn()
		const release = await acquireCjpmProjectLock(root, { preempt })
		const controller = new AbortController()
		controller.abort()
		try {
			await expect(acquireCjpmProjectLock(root, { signal: controller.signal })).rejects.toBeInstanceOf(
				CjpmLockUnavailableError,
			)
			expect(preempt).not.toHaveBeenCalled()
		} finally {
			release()
		}
	})

	it("clears timeout and abort listeners after acquiring the lock", async () => {
		vi.useFakeTimers()
		const controller = new AbortController()
		const release = await acquireCjpmProjectLock(root, { signal: controller.signal, timeoutMs: 10 })
		let acquiredNext = false
		const next = acquireCjpmProjectLock(root).then((releaseNext) => {
			acquiredNext = true
			return releaseNext
		})
		try {
			controller.abort()
			await vi.advanceTimersByTimeAsync(20)
			expect(vi.getTimerCount()).toBe(0)
			expect(acquiredNext).toBe(false)
		} finally {
			release()
			;(await next)()
			vi.useRealTimers()
		}
	})

	it("releases an acquired slot only once without releasing the next holder", async () => {
		const release = await acquireCjpmProjectLock(root)
		const next = acquireCjpmProjectLock(root)
		release()
		const releaseNext = await next
		release()
		let acquired = false
		const third = withCjpmProjectLock(root, async () => {
			acquired = true
		})
		await Promise.resolve()
		expect(acquired).toBe(false)
		releaseNext()
		await third
		expect(acquired).toBe(true)
	})

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
