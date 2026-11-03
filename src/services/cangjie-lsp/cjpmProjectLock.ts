import * as path from "path"

/**
 * One cjpm process per project at a time: builds and tests share `target/`, so concurrent runs
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

function keyFor(root: string): string {
	const resolved = path.resolve(root)
	return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export async function withCjpmProjectLock<T>(
	projectRoot: string,
	work: () => Promise<T>,
	options: { preempt?: () => void } = {},
): Promise<T> {
	const key = keyFor(projectRoot)
	const state = locks.get(key) ?? { tail: Promise.resolve(), waiting: 0 }
	locks.set(key, state)

	state.preemptHolder?.()
	let release!: () => void
	const mine = new Promise<void>((resolve) => (release = resolve))
	const previous = state.tail
	state.tail = previous.then(() => mine)
	state.waiting += 1
	await previous
	state.waiting -= 1

	state.preemptHolder = options.preempt
	if (options.preempt && state.waiting > 0) options.preempt()
	try {
		return await work()
	} finally {
		state.preemptHolder = undefined
		release()
		if (state.waiting === 0) locks.delete(key)
	}
}
