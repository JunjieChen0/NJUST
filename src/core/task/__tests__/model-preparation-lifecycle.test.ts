import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ClineMessage } from "@njust-ai/types"
import type { ApiStream } from "../../../api/transform/stream"
import { asMock } from "../../../__tests__/helpers/asMock"
import { NativeToolCallParser } from "../../assistant-message/NativeToolCallParser"
import { TaskExecutor, type TaskExecutorHost } from "../TaskExecutor"
import { TaskAskSayHandler } from "../TaskAskSayHandler"
import type { TaskAskSayHost } from "../interfaces/TaskAskSayHost"
import { consumeApiStream, type StackItem } from "../TaskStreamConsumer"
import { TaskAbortedError, TaskModelPreparationError } from "../TaskErrors"

// Keep the real approval policy, ask handler, preparation loop and stream consumer.
function setup(status: number, retryLimit = 1) {
	const card: ClineMessage = { ts: 1, type: "say", say: "api_req_started", text: '{"apiProtocol":"openai"}' }
	const persisted: ClineMessage[][] = []
	const updates: ClineMessage[] = []
	const stack: StackItem[] = []
	const model = { id: "fixture", info: { contextWindow: 128000, inputPrice: 0, outputPrice: 0 } }
	const prepare = vi.fn(async (): Promise<void> => {
		// Bound the buggy implementation so a regression fails without hanging the suite.
		if (prepare.mock.calls.length > 8) host.abort = true
		throw Object.assign(new Error(`Catalog HTTP ${status}`), { status })
	})
	const host = asMock<TaskExecutorHost & TaskAskSayHost>({
		taskId: "fixture",
		instanceId: "instance",
		abort: false,
		abandoned: false,
		isStreaming: true,
		apiConfiguration: { apiProvider: "openai", openAiModelId: "fixture" },
		api: { prepareModel: prepare, getModel: vi.fn(() => model), createMessage: vi.fn() },
		cachedStreamingModel: model,
		apiConversationHistory: [],
		clineMessages: [card],
		stateMachine: { force: vi.fn() },
		hostRef: {
			deref: () => ({
				getState: async () => ({
					autoApprovalEnabled: true,
					alwaysAllowAll: true,
					mode: "code",
					unattendedRetryEnabled: true,
					unattendedMaxRetryAttempts: retryLimit,
				}),
				postMessageToWebview: vi.fn(),
			}),
		},
		streamProcessor: { maybeWaitForProviderRateLimit: vi.fn() },
		setLastGlobalApiRequestTime: vi.fn(),
		requestBuilder: { prefetchSystemPromptData: vi.fn(), getSystemPromptParts: vi.fn() },
		messageQueueService: { isEmpty: () => true },
		addToClineMessages: vi.fn(async (message: ClineMessage) => {
			host.clineMessages.push(message)
		}),
		saveClineMessages: vi.fn(async () => {
			persisted.push(structuredClone(host.clineMessages))
			return true
		}),
		updateClineMessage: vi.fn(async (message: ClineMessage) => {
			updates.push(structuredClone(message))
		}),
		findMessageByTimestamp: (ts: number) => host.clineMessages.find((message) => message.ts === ts),
		approveAsk: vi.fn(() => {
			host.askResponse = "yesButtonClicked"
		}),
		denyAsk: vi.fn(() => {
			host.askResponse = "noButtonClicked"
		}),
		cancelAutoApprovalTimeout: vi.fn(),
		emit: vi.fn(),
		diffViewProvider: { isEditing: false },
		abortTask: vi.fn(),
	})
	const asks = new TaskAskSayHandler(host)
	host.ask = asks.ask.bind(asks)
	host.say = asks.say.bind(asks)
	const executor = new TaskExecutor(host)
	const run = (stream: ApiStream = executor.attemptApiRequest()) =>
		consumeApiStream({
			task: host,
			stream,
			toolCallParser: new NativeToolCallParser(),
			placeFinalizedStreamingToolUse: (_task, _id, tool) => tool,
			requestProfileId: "fixture",
			lastApiReqIndex: 0,
			requestStartedAt: Date.now(),
			retryAttempt: 0,
			currentUserContent: [],
			stack,
		})
	return { host, asks, prepare, run, card, persisted, updates, stack }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("model preparation lifecycle with real approval and stream handling", () => {
	it.each([
		{ status: 401, attempts: 1 },
		{ status: 503, attempts: 2 },
	])(
		"waits for the user at HTTP $status even with Force Bypass and closes the card after rejection",
		async ({ status, attempts }) => {
			const fixture = setup(status)
			let settled = false
			const result = fixture
				.run()
				.catch((error) => error)
				.finally(() => {
					settled = true
				})
			try {
				await vi.advanceTimersByTimeAsync(5000)
				expect(fixture.prepare).toHaveBeenCalledTimes(attempts)
				expect(fixture.host.approveAsk).not.toHaveBeenCalled()
				expect(settled).toBe(false)
				fixture.asks.handleWebviewAskResponse("noButtonClicked")
				await vi.advanceTimersByTimeAsync(100)
				expect(await result).toBeInstanceOf(TaskModelPreparationError)
				expect(JSON.parse(fixture.card.text!)).toMatchObject({
					cost: 0,
					cancelReason: "streaming_failed",
					streamingFailedMessage: expect.stringContaining(String(status)),
				})
				expect(fixture.persisted.at(-1)?.[0]).toEqual(fixture.card)
				expect(fixture.updates).toContainEqual(fixture.card)
				expect(fixture.stack).toEqual([])
				expect(fixture.host.api.createMessage).not.toHaveBeenCalled()
			} finally {
				fixture.host.abort = true
				await vi.advanceTimersByTimeAsync(2000)
				await result
			}
		},
	)
	it("allows another attempt only after a real user retry", async () => {
		const fixture = setup(401)
		const result = fixture.run().catch((error) => error)
		try {
			await vi.advanceTimersByTimeAsync(5000)
			expect(fixture.prepare).toHaveBeenCalledTimes(1)
			fixture.asks.handleWebviewAskResponse("yesButtonClicked")
			await vi.advanceTimersByTimeAsync(100)
			expect(fixture.prepare).toHaveBeenCalledTimes(2)
			fixture.asks.handleWebviewAskResponse("noButtonClicked")
			await vi.advanceTimersByTimeAsync(100)
			expect(await result).toBeInstanceOf(TaskModelPreparationError)
			expect(fixture.host.approveAsk).not.toHaveBeenCalled()
		} finally {
			fixture.host.abort = true
			await vi.advanceTimersByTimeAsync(2000)
			await result
		}
	})
	it.each([false, true])(
		"closes and broadcasts the cancelled request before stopping (task abort: %s)",
		async (abortTask) => {
			const fixture = setup(401)
			let release!: () => void
			fixture.prepare.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						release = resolve
					}),
			)
			const result = fixture.run().catch((error) => error)
			await vi.advanceTimersByTimeAsync(0)
			fixture.host.abort = abortTask
			fixture.host.currentRequestAbortController!.abort()
			await vi.advanceTimersByTimeAsync(100)
			const stopped = await result
			release()
			if (abortTask) expect(stopped).toMatchObject({ action: "break" })
			else expect(stopped).toBeInstanceOf(TaskAbortedError)
			expect(JSON.parse(fixture.card.text!)).toMatchObject({ cost: 0, cancelReason: "user_cancelled" })
			expect(JSON.parse(fixture.card.text!).streamingFailedMessage).toBeUndefined()
			expect(fixture.persisted.at(-1)?.[0]).toEqual(fixture.card)
			expect(fixture.updates).toContainEqual(fixture.card)
			expect(fixture.host.isStreaming).toBe(false)
			expect(fixture.host.currentRequestAbortController).toBeUndefined()
			expect(fixture.stack).toEqual([])
			expect(fixture.prepare).toHaveBeenCalledTimes(1)
			expect(fixture.host.api.createMessage).not.toHaveBeenCalled()
		},
	)
})
