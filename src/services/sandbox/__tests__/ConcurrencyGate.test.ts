import { describe, it, expect } from "vitest"
import { ConcurrencyGate } from "../ConcurrencyGate"

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

describe("ConcurrencyGate", () => {
	it("allows multiple shared leases concurrently", async () => {
		const gate = new ConcurrencyGate()
		const release1 = await gate.acquireShared()
		const release2 = await gate.acquireShared()

		expect(gate.metrics.activeShared).toBe(2)
		release1()
		release2()
		expect(gate.metrics.activeShared).toBe(0)
	})

	it("exclusive waits for shared to release", async () => {
		const gate = new ConcurrencyGate()
		const releaseShared = await gate.acquireShared()

		let exclusiveAcquired = false
		const exclusivePromise = gate.acquireExclusive().then((release) => {
			exclusiveAcquired = true
			return release
		})

		await delay(10)
		expect(exclusiveAcquired).toBe(false)

		releaseShared()
		const releaseExclusive = await exclusivePromise
		expect(exclusiveAcquired).toBe(true)
		expect(gate.metrics.exclusiveActive).toBe(true)
		releaseExclusive()
	})

	it("shared waits for exclusive to release", async () => {
		const gate = new ConcurrencyGate()
		const releaseExclusive = await gate.acquireExclusive()

		let sharedAcquired = false
		const sharedPromise = gate.acquireShared().then((release) => {
			sharedAcquired = true
			return release
		})

		await delay(10)
		expect(sharedAcquired).toBe(false)

		releaseExclusive()
		const releaseShared = await sharedPromise
		expect(sharedAcquired).toBe(true)
		releaseShared()
	})

	it("exclusive/exclusive are FIFO serialized", async () => {
		const gate = new ConcurrencyGate()
		const release1 = await gate.acquireExclusive()

		const order: number[] = []
		const p2 = gate.acquireExclusive().then((release) => {
			order.push(2)
			return release
		})
		const p3 = gate.acquireExclusive().then((release) => {
			order.push(3)
			return release
		})

		await delay(10)
		expect(order).toEqual([])

		release1()
		const release2 = await p2
		expect(order).toEqual([2])

		release2()
		const release3 = await p3
		expect(order).toEqual([2, 3])

		release3()
	})

	it("writer fairness: exclusive queue blocks new shared", async () => {
		const gate = new ConcurrencyGate()
		const releaseShared1 = await gate.acquireShared()

		let exclusiveAcquired = false
		const exclusivePromise = gate.acquireExclusive().then((release) => {
			exclusiveAcquired = true
			return release
		})

		await delay(5)

		let shared2Acquired = false
		const shared2Promise = gate.acquireShared().then((release) => {
			shared2Acquired = true
			return release
		})

		await delay(10)
		expect(exclusiveAcquired).toBe(false)
		expect(shared2Acquired).toBe(false)

		releaseShared1()
		const releaseExclusive = await exclusivePromise
		expect(exclusiveAcquired).toBe(true)
		expect(shared2Acquired).toBe(false)

		releaseExclusive()
		const releaseShared2 = await shared2Promise
		expect(shared2Acquired).toBe(true)
		releaseShared2()
	})

	it("abort removes waiter from queue", async () => {
		const gate = new ConcurrencyGate()
		const releaseExclusive = await gate.acquireExclusive()

		const controller = new AbortController()
		const sharedPromise = gate.acquireShared(controller.signal)

		await delay(5)
		expect(gate.metrics.sharedWaiting).toBe(1)

		controller.abort()
		await expect(sharedPromise).rejects.toThrow("aborted")
		expect(gate.metrics.sharedWaiting).toBe(0)

		releaseExclusive()
	})

	it("abort on already-aborted signal rejects immediately", async () => {
		const gate = new ConcurrencyGate()
		const controller = new AbortController()
		controller.abort()

		await expect(gate.acquireShared(controller.signal)).rejects.toThrow("aborted")
		await expect(gate.acquireExclusive(controller.signal)).rejects.toThrow("aborted")
	})

	it("duplicate release is safe (idempotent)", async () => {
		const gate = new ConcurrencyGate()
		const release = await gate.acquireShared()
		release()
		release()
		expect(gate.metrics.activeShared).toBe(0)
	})

	it("duplicate exclusive release is safe", async () => {
		const gate = new ConcurrencyGate()
		const release = await gate.acquireExclusive()
		release()
		release()
		expect(gate.metrics.exclusiveActive).toBe(false)
	})

	it("dispose rejects waiting acquires", async () => {
		const gate = new ConcurrencyGate()
		const releaseExclusive = await gate.acquireExclusive()

		const sharedPromise = gate.acquireShared()
		await delay(5)

		gate.dispose()
		await expect(sharedPromise).rejects.toThrow("disposed")
		releaseExclusive()
	})

	it("dispose prevents new acquires", async () => {
		const gate = new ConcurrencyGate()
		gate.dispose()
		await expect(gate.acquireShared()).rejects.toThrow("disposed")
		await expect(gate.acquireExclusive()).rejects.toThrow("disposed")
	})

	it("exception in shared block does not permanently hold lock", async () => {
		const gate = new ConcurrencyGate()
		const release = await gate.acquireShared()

		try {
			release()
			throw new Error("test error")
		} catch {
			// expected
		}

		const release2 = await gate.acquireExclusive()
		expect(gate.metrics.exclusiveActive).toBe(true)
		release2()
	})
})
