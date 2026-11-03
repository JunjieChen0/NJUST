import * as path from "path"

/**
 * Coordinate foreground cjpm work per project: builds and tests share `target/`, so concurrent runs
 * (save-time compile, system verification, background baseline) corrupt each other's results.
 * A holder may declare itself preemptible (the background baseline): it is asked to stop as soon
 * as any other request for the same project is waiting.
 */
interface ProjectLockState {
	tail: Promise<void>
	waiting: number
	preemptHolder?: () => void
}

const locks = new Map<string, ProjectLockState>()

interface ProjectLockOptions {
	preempt?: () => void
	signal?: AbortSignal
	timeoutMs?: number
}

export class CjpmLockUnavailableError extends Error {
	constructor(readonly reason: "timeout" | "aborted") {
		super(
			reason === "timeout"
				? "Timed out waiting for the cjpm project lock"
				: "Cancelled waiting for the cjpm project lock",
		)
		this.name = "CjpmLockUnavailableError"
	}
}

function keyFor(root: string): string {
	const resolved = path.resolve(root)
	return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/** Acquire a project slot; the idempotent release may be called after a command backgrounds. */
export async function acquireCjpmProjectLock(
	projectRoot: string,
	options: ProjectLockOptions = {},
): Promise<() => void> {
	if (options.signal?.aborted) throw new CjpmLockUnavailableError("aborted")
	const key = keyFor(projectRoot)
	const state = locks.get(key) ?? { tail: Promise.resolve(), waiting: 0 }
	locks.set(key, state)

	state.preemptHolder?.()
	let release!: () => void
	const mine = new Promise<void>((resolve) => (release = resolve))
	const previous = state.tail
	const tail = previous.then(() => mine)
	state.tail = tail
	state.waiting += 1
	void tail.then(() => {
		if (state.tail === tail && state.waiting === 0 && locks.get(key) === state) locks.delete(key)
	})

	let timer: ReturnType<typeof setTimeout> | undefined
	let onAbort: (() => void) | undefined
	let acquired = false
	try {
		await new Promise<void>((resolve, reject) => {
			void previous.then(resolve)
			onAbort = () => reject(new CjpmLockUnavailableError("aborted"))
			options.signal?.addEventListener("abort", onAbort, { once: true })
			if (options.signal?.aborted) onAbort()
			if (options.timeoutMs !== undefined) {
				timer = setTimeout(() => reject(new CjpmLockUnavailableError("timeout")), options.timeoutMs)
			}
		})
		if (options.signal?.aborted) throw new CjpmLockUnavailableError("aborted")
		acquired = true
	} finally {
		clearTimeout(timer)
		if (onAbort) options.signal?.removeEventListener("abort", onAbort)
		state.waiting -= 1
		// Resolve the abandoned slot, but keep its predecessor in the chain so waiters cannot bypass a holder.
		if (!acquired) release()
	}

	state.preemptHolder = options.preempt
	if (options.preempt && state.waiting > 0) options.preempt()
	let released = false
	return () => {
		if (released) return
		released = true
		state.preemptHolder = undefined
		release()
	}
}

export async function withCjpmProjectLock<T>(
	projectRoot: string,
	work: () => Promise<T>,
	options: ProjectLockOptions = {},
): Promise<T> {
	const release = await acquireCjpmProjectLock(projectRoot, options)
	try {
		return await work()
	} finally {
		release()
	}
}
