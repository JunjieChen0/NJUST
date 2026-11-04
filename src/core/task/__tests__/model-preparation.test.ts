import { afterEach, describe, expect, it, vi } from "vitest"
import { TaskExecutor, type TaskExecutorHost } from "../TaskExecutor"
import { asMock } from "../../../__tests__/helpers/asMock"
import { handleMidStreamFailure } from "../TaskRetryHandler"

function setup(prepareModel: (signal?: AbortSignal) => Promise<void>, state = {}) {
	const stop = new Error("stop after prompt construction")
	const prompt = vi.fn().mockRejectedValue(stop)
	const api = {
		prepareModel,
		getModel: vi.fn().mockReturnValue({ id: "new-model", info: { contextWindow: 777777 } }),
		createMessage: vi.fn(),
	}
	const host = asMock<TaskExecutorHost>({
		taskId: "fixture",
		instanceId: "fixture-instance",
		abort: false,
		stateMachine: { force: vi.fn(), state: undefined },
		hostRef: { deref: () => ({ getState: async () => state }) },
		streamProcessor: { maybeWaitForProviderRateLimit: vi.fn() },
		setLastGlobalApiRequestTime: vi.fn(),
		requestBuilder: { prefetchSystemPromptData: vi.fn(), getSystemPromptParts: prompt },
		getTokenUsage: vi.fn().mockReturnValue({ contextTokens: 0 }),
		api,
		apiConversationHistory: [],
		ask: vi.fn().mockResolvedValue({ response: "noButtonClicked" }),
		say: vi.fn().mockResolvedValue(undefined),
	})
	return { host, prompt, stop, iterator: new TaskExecutor(host).attemptApiRequest() }
}
afterEach(() => vi.useRealTimers())

describe("task model preparation", () => {
	it.each([400, 401, 403])(
		"prompts for HTTP %s without starting inference or retrying automatically",
		async (status) => {
			const prepare = vi
				.fn()
				.mockRejectedValue(Object.assign(new Error(`Model catalog HTTP ${status}`), { status }))
			const { host, prompt, iterator } = setup(prepare, { autoApprovalEnabled: true })
			await iterator.next().catch(() => undefined)
			expect(host.ask).toHaveBeenCalledWith("api_req_failed", expect.stringContaining(String(status)))
			expect(prepare).toHaveBeenCalledTimes(1)
			expect(prompt).not.toHaveBeenCalled()
			expect(host.api.createMessage).not.toHaveBeenCalled()
		},
	)
	it("bounds automatic preparation retries even when unattended limits are disabled", async () => {
		vi.useFakeTimers()
		const prepare = vi.fn().mockRejectedValue(Object.assign(new Error("Directory unavailable"), { status: 503 }))
		const { host, iterator } = setup(prepare, { autoApprovalEnabled: true, unattendedRetryEnabled: false })
		const failed = iterator.next().catch((error) => error)
		await vi.runAllTimersAsync()
		await failed
		expect(prepare).toHaveBeenCalledTimes(3)
		expect(host.ask).toHaveBeenCalledTimes(1)
		expect(host.api.createMessage).not.toHaveBeenCalled()
	})
	it.each([0, 1])("honors a lower configured retry limit of %s", async (limit) => {
		vi.useFakeTimers()
		const prepare = vi.fn().mockRejectedValue(Object.assign(new Error("Unavailable"), { status: 503 }))
		const { host, iterator } = setup(prepare, {
			autoApprovalEnabled: true,
			unattendedRetryEnabled: true,
			unattendedMaxRetryAttempts: limit,
		})
		const pending = iterator.next().catch((error) => error)
		await vi.runAllTimersAsync()
		await pending
		expect(prepare).toHaveBeenCalledTimes(limit + 1)
		expect(host.ask).toHaveBeenCalledTimes(1)
	})
	it("does not treat a synchronous configuration failure as retryable", async () => {
		const prepare = vi.fn(() => {
			throw Object.assign(new TypeError("Invalid URL"), { code: "ERR_INVALID_URL" })
		})
		const { host, iterator } = setup(prepare, { autoApprovalEnabled: true })
		await iterator.next().catch(() => undefined)
		expect(prepare).toHaveBeenCalledTimes(1)
		expect(host.ask).toHaveBeenCalledWith("api_req_failed", expect.stringContaining("Invalid URL"))
	})
	it("allows another preparation only after an explicit retry decision", async () => {
		const prepare = vi.fn().mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }))
		const { host, iterator } = setup(prepare)
		vi.mocked(host.ask)
			.mockResolvedValueOnce({ response: "yesButtonClicked" })
			.mockResolvedValueOnce({ response: "noButtonClicked" })
		await iterator.next().catch(() => undefined)
		expect(prepare).toHaveBeenCalledTimes(2)
		expect(host.ask).toHaveBeenCalledTimes(2)
		expect(host.api.createMessage).not.toHaveBeenCalled()
	})
	it("can retry with a corrected profile after a preparation failure", async () => {
		const prepare = vi.fn().mockRejectedValue(Object.assign(new Error("Unauthorized"), { status: 401 }))
		const { host, prompt, stop, iterator } = setup(prepare)
		const corrected = { ...host.api, prepareModel: vi.fn().mockResolvedValue(undefined) }
		vi.mocked(host.ask).mockImplementationOnce(async () => {
			host.currentRequestAbortController?.abort()
			host.api = corrected
			return { response: "yesButtonClicked" }
		})
		await expect(iterator.next()).rejects.toBe(stop)
		expect(prepare).toHaveBeenCalledTimes(1)
		expect(corrected.prepareModel).toHaveBeenCalledTimes(1)
		expect(prompt).toHaveBeenCalledTimes(1)
	})
	it("does not start another preparation after cancellation during backoff", async () => {
		vi.useFakeTimers()
		const prepare = vi.fn().mockRejectedValue(Object.assign(new Error("Unavailable"), { status: 503 }))
		const { host, iterator } = setup(prepare, { autoApprovalEnabled: true })
		const failed = iterator.next().catch((error) => error)
		await vi.advanceTimersByTimeAsync(0)
		host.currentRequestAbortController?.abort()
		await vi.runAllTimersAsync()
		expect((await failed).name).toBe("TaskAbortedError")
		expect(prepare).toHaveBeenCalledTimes(1)
		expect(host.ask).not.toHaveBeenCalled()
	})
	it("does not requeue a preparation error after the user declines", async () => {
		const { host, iterator } = setup(vi.fn().mockRejectedValue(new Error("Directory failed")))
		const failure = await iterator.next().catch((error) => error)
		const stack: Array<{ userContent: []; includeFileDetails: boolean; retryAttempt?: number }> = []
		const abortStream = vi.fn().mockResolvedValue(undefined)
		await expect(
			handleMidStreamFailure({
				task: host,
				error: failure,
				currentRetryAttempt: 0,
				currentUserContent: [],
				stack,
				abortStream,
			}),
		).rejects.toBe(failure)
		expect(stack).toEqual([])
		expect(abortStream).toHaveBeenCalledWith("streaming_failed", undefined)
	})
	it("cancels preparation promptly even when a legacy fetch has not settled", async () => {
		let finish!: () => void
		const prepare = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve
				}),
		)
		const { host, prompt, iterator } = setup(prepare)
		let settled = false
		const pending = iterator.next().catch((error) => {
			settled = true
			return error
		})
		await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1))
		host.currentRequestAbortController?.abort()
		try {
			await vi.waitFor(() => expect(settled).toBe(true), { timeout: 100 })
			expect((await pending).name).toBe("TaskAbortedError")
			expect(prompt).not.toHaveBeenCalled()
			expect(host.ask).not.toHaveBeenCalled()
		} finally {
			finish()
			await pending
		}
	})
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
