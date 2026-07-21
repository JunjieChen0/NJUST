import { logger } from "../../shared/logger"

type ReleaseFn = () => void

interface Waiter {
	resolve: (release: ReleaseFn) => void
	reject: (error: Error) => void
	signal?: AbortSignal
	abortHandler?: () => void
}

export class ConcurrencyGate {
	private activeShared = 0
	private exclusiveActive = false
	private sharedQueue: Waiter[] = []
	private exclusiveQueue: Waiter[] = []
	private disposed = false

	async acquireShared(signal?: AbortSignal): Promise<ReleaseFn> {
		this.assertNotDisposed()
		if (signal?.aborted) throw new Error("ConcurrencyGate: acquireShared aborted")

		if (!this.exclusiveActive && this.exclusiveQueue.length === 0) {
			this.activeShared++
			return this.makeSharedRelease()
		}

		return this.enqueue("shared", signal)
	}

	async acquireExclusive(signal?: AbortSignal): Promise<ReleaseFn> {
		this.assertNotDisposed()
		if (signal?.aborted) throw new Error("ConcurrencyGate: acquireExclusive aborted")

		if (!this.exclusiveActive && this.activeShared === 0) {
			this.exclusiveActive = true
			return this.makeExclusiveRelease()
		}

		return this.enqueue("exclusive", signal)
	}

	get metrics(): {
		activeShared: number
		exclusiveActive: boolean
		sharedWaiting: number
		exclusiveWaiting: number
	} {
		return {
			activeShared: this.activeShared,
			exclusiveActive: this.exclusiveActive,
			sharedWaiting: this.sharedQueue.length,
			exclusiveWaiting: this.exclusiveQueue.length,
		}
	}

	dispose(): void {
		this.disposed = true
		const allWaiters = [...this.sharedQueue, ...this.exclusiveQueue]
		this.sharedQueue.length = 0
		this.exclusiveQueue.length = 0
		for (const w of allWaiters) {
			this.cleanupListener(w)
			w.reject(new Error("ConcurrencyGate disposed"))
		}
	}

	private assertNotDisposed(): void {
		if (this.disposed) throw new Error("ConcurrencyGate is disposed")
	}

	private enqueue(type: "shared" | "exclusive", signal?: AbortSignal): Promise<ReleaseFn> {
		return new Promise<ReleaseFn>((resolve, reject) => {
			const waiter: Waiter = { resolve, reject, signal }

			if (signal) {
				waiter.abortHandler = () => {
					const queue = type === "shared" ? this.sharedQueue : this.exclusiveQueue
					const idx = queue.indexOf(waiter)
					if (idx >= 0) {
						queue.splice(idx, 1)
						this.cleanupListener(waiter)
						reject(new Error(`ConcurrencyGate: ${type} aborted while waiting`))
						// Re-drain: cancelling an exclusive waiter may unblock shared waiters
						this.drainQueue()
					}
				}
				signal.addEventListener("abort", waiter.abortHandler, { once: true })
			}

			const queue = type === "shared" ? this.sharedQueue : this.exclusiveQueue
			queue.push(waiter)
		})
	}

	private cleanupListener(waiter: Waiter): void {
		if (waiter.abortHandler && waiter.signal) {
			waiter.signal.removeEventListener("abort", waiter.abortHandler)
			waiter.abortHandler = undefined
		}
	}

	private makeSharedRelease(): ReleaseFn {
		let released = false
		return () => {
			if (released) {
				logger.warn("ConcurrencyGate", "duplicate shared release ignored")
				return
			}
			released = true
			this.activeShared--
			if (this.activeShared < 0) {
				logger.error("ConcurrencyGate", "shared count went negative", { activeShared: this.activeShared })
				this.activeShared = 0
			}
			this.drainQueue()
		}
	}

	private makeExclusiveRelease(): ReleaseFn {
		let released = false
		return () => {
			if (released) {
				logger.warn("ConcurrencyGate", "duplicate exclusive release ignored")
				return
			}
			released = true
			this.exclusiveActive = false
			this.drainQueue()
		}
	}

	private drainQueue(): void {
		if (this.exclusiveActive) return

		if (this.activeShared === 0 && this.exclusiveQueue.length > 0) {
			const waiter = this.exclusiveQueue.shift()!
			this.cleanupListener(waiter)
			this.exclusiveActive = true
			waiter.resolve(this.makeExclusiveRelease())
			return
		}

		while (this.sharedQueue.length > 0 && !this.exclusiveActive && this.exclusiveQueue.length === 0) {
			const waiter = this.sharedQueue.shift()!
			this.cleanupListener(waiter)
			this.activeShared++
			waiter.resolve(this.makeSharedRelease())
		}
	}
}
