import { describe, expect, it, vi } from "vitest"
import { TaskExecutor, type TaskExecutorHost } from "../TaskExecutor"
import { asMock } from "../../../__tests__/helpers/asMock"

function setup(prepareModel: (signal?: AbortSignal) => Promise<void>) {
	const stop = new Error("stop after prompt construction")
	const prompt = vi.fn().mockRejectedValue(stop)
	const api = {
		prepareModel,
		getModel: vi.fn().mockReturnValue({ id: "new-model", info: { contextWindow: 777777 } }),
	}
	const host = asMock<TaskExecutorHost>({
		taskId: "fixture",
		instanceId: "fixture-instance",
		abort: false,
		stateMachine: { force: vi.fn(), state: undefined },
		hostRef: { deref: () => ({ getState: async () => ({}) }) },
		streamProcessor: { maybeWaitForProviderRateLimit: vi.fn() },
		setLastGlobalApiRequestTime: vi.fn(),
		requestBuilder: { prefetchSystemPromptData: vi.fn(), getSystemPromptParts: prompt },
		getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 0 }),
		api,
		apiConversationHistory: [],
	})
	return { host, prompt, stop, iterator: new TaskExecutor(host).attemptApiRequest() }
}

describe("task model preparation", () => {
	it("prepares metadata before prompt construction and model snapshotting", async () => {
		let release!: () => void
		const prepare = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve
				}),
		)
		const { host, prompt, stop, iterator } = setup(prepare)
		const result = iterator.next()
		const rejected = expect(result).rejects.toBe(stop)
		await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
		expect(prompt).not.toHaveBeenCalled()
		expect(host.api.getModel).not.toHaveBeenCalled()
		release()
		await rejected
		expect(prompt).toHaveBeenCalledTimes(1)
		expect(host.api.getModel).toHaveBeenCalledTimes(1)
	})
	it("does not construct a prompt after cancellation during model preparation", async () => {
		let release!: () => void
		const prepare = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve
				}),
		)
		const { host, prompt, iterator } = setup(prepare)
		const result = iterator.next()
		const rejected = expect(result).rejects.toThrow()
		await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
		host.currentRequestAbortController?.abort()
		release()
		await rejected
		expect(prompt).not.toHaveBeenCalled()
		expect(host.currentRequestAbortController).toBeUndefined()
	})
	it("discards preparation when the API configuration changes", async () => {
		let release!: () => void
		const prepare = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve
				}),
		)
		const { host, prompt, iterator } = setup(prepare)
		const result = iterator.next()
		const rejected = expect(result).rejects.toThrow()
		await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
		host.api = { ...host.api }
		release()
		await rejected
		expect(prompt).not.toHaveBeenCalled()
	})
})
