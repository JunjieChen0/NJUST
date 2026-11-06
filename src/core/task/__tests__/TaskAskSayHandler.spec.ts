import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { pWaitForMock, checkAutoApprovalMock } = vi.hoisted(() => ({
	pWaitForMock: vi.fn(),
	checkAutoApprovalMock: vi.fn(),
}))

vi.mock("p-wait-for", () => ({
	default: pWaitForMock,
}))

vi.mock("../../auto-approval", () => ({
	checkAutoApproval: checkAutoApprovalMock,
}))

import { TaskAskSayHandler } from "../TaskAskSayHandler"

function createQueue(messages: Array<{ text?: string; images?: string[] }> = []) {
	return {
		messages,
		isEmpty: vi.fn(() => messages.length === 0),
		dequeueMessage: vi.fn(() => messages.shift()),
	}
}

function createHost(overrides: Record<string, unknown> = {}) {
	const host: any = {
		taskId: "task-1",
		instanceId: "instance-1",
		abort: false,
		lastMessageTs: 0,
		askResponse: undefined,
		askResponseText: undefined,
		askResponseImages: undefined,
		autoApprovalTimeoutRef: undefined,
		clineMessages: [],
		messageQueueService: createQueue(),
		emit: vi.fn(),
		hostRef: { deref: () => undefined },
		addToClineMessages: vi.fn(async function (message) {
			host.clineMessages.push(message)
		}),
		updateClineMessage: vi.fn().mockResolvedValue(undefined),
		saveClineMessages: vi.fn().mockResolvedValue(true),
		findMessageByTimestamp: vi.fn((ts: number) => host.clineMessages.find((m: any) => m.ts === ts)),
		checkpointSave: vi.fn().mockResolvedValue(undefined),
		cancelAutoApprovalTimeout: vi.fn(),
		approveAsk: vi.fn(function () {
			host.askResponse = "yesButtonClicked"
		}),
		denyAsk: vi.fn(function () {
			host.askResponse = "noButtonClicked"
		}),
		supersedePendingAsk: vi.fn(),
		formatResponse: {
			toolError: (error: string) => `Error: ${error}`,
			missingToolParameterError: (paramName: string) => `Missing ${paramName}`,
		},
		...overrides,
	}
	return host
}

describe("TaskAskSayHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		checkAutoApprovalMock.mockResolvedValue({ decision: "ask" })
		pWaitForMock.mockImplementation(async function (predicate: () => boolean) {
			predicate()
			return undefined
		})
	})

	it("throws when ask is called after abort", async () => {
		const handler = new TaskAskSayHandler(createHost({ abort: true }))

		await expect(handler.ask("followup", "Q?")).rejects.toThrow("aborted")
	})

	describe("completion feedback waiting", () => {
		beforeEach(async () => {
			const { default: pWaitFor } = await vi.importActual<typeof import("p-wait-for")>("p-wait-for")
			pWaitForMock.mockImplementation(pWaitFor)
			vi.useFakeTimers()
		})

		afterEach(() => vi.useRealTimers())

		it.each(["yesButtonClicked", "messageResponse"] as const)(
			"waits beyond two minutes and then accepts %s without retrying",
			async (response) => {
				const host = createHost()
				const handler = new TaskAskSayHandler(host)
				const settled = vi.fn()
				const pending = handler.ask("completion_result", "", false)
				void pending.then(settled, settled)
				try {
					await vi.advanceTimersByTimeAsync(180_000)
					expect(settled).not.toHaveBeenCalled()
					expect(host.clineMessages).toHaveLength(1)
					handler.handleWebviewAskResponse(response, "feedback")
					await vi.advanceTimersByTimeAsync(100)
					expect(await pending).toMatchObject({ response, text: "feedback" })
				} finally {
					host.abort = true
					await vi.advanceTimersByTimeAsync(100)
					await pending.catch(() => undefined)
				}
			},
		)

		it.each(["abort", "abandoned"])("stops waiting when the task is %s", async (flag) => {
			const host = createHost()
			const handler = new TaskAskSayHandler(host)
			const pending = handler.ask("completion_result", "", false)
			const result = pending.catch((error: Error) => error)
			await vi.advanceTimersByTimeAsync(180_000)
			host[flag] = true
			await vi.advanceTimersByTimeAsync(100)
			expect(await result).toMatchObject({ name: "TaskAbortedError" })
		})

		it("stops a superseded completion ask after a long wait", async () => {
			const host = createHost()
			const pending = new TaskAskSayHandler(host).ask("completion_result", "", false)
			const result = pending.catch((error: Error) => error)
			await vi.advanceTimersByTimeAsync(180_000)
			host.lastMessageTs += 1
			await vi.advanceTimersByTimeAsync(100)
			expect(await result).toMatchObject({
				name: "AskIgnoredError",
				message: expect.stringContaining("superseded"),
			})
		})

		it("keeps the timeout for API retry confirmation", async () => {
			const pending = new TaskAskSayHandler(createHost()).ask("api_req_failed", "retry?", false)
			const result = pending.catch((error: Error) => error)
			await vi.advanceTimersByTimeAsync(121_000)
			expect(await result).toMatchObject({ name: "TimeoutError" })
		})

		it.each(["tool", "command", "use_mcp_server", "completion_result"] as const)(
			"returns queued feedback arriving during %s without granting approval",
			async (type) => {
				const queue = createQueue()
				const host = createHost({ messageQueueService: queue })
				const pending = new TaskAskSayHandler(host).ask(type, "waiting", false, undefined, true)
				void pending.catch(() => undefined)
				await vi.advanceTimersByTimeAsync(2_100)
				queue.messages.push({ text: "Do not execute. Explain first.", images: ["feedback.png"] })
				await vi.advanceTimersByTimeAsync(200)
				try {
					expect(queue.dequeueMessage).toHaveBeenCalledOnce()
					expect(await pending).toEqual({
						response: "messageResponse",
						text: "Do not execute. Explain first.",
						images: ["feedback.png"],
					})
					expect(host.approveAsk).not.toHaveBeenCalled()
				} finally {
					host.abort = true
					await vi.advanceTimersByTimeAsync(100)
					await pending.catch(() => undefined)
				}
			},
		)
	})

	it("adds a new partial ask and ignores it", async () => {
		const host = createHost()
		const handler = new TaskAskSayHandler(host)

		await expect(handler.ask("tool", "partial", true)).rejects.toThrow("new partial")

		expect(host.addToClineMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "ask",
				ask: "tool",
				text: "partial",
				partial: true,
			}),
		)
	})

	it("updates the previous partial ask in place", async () => {
		const message = { ts: 1, type: "ask", ask: "tool", text: "old", partial: true } as any
		const host = createHost({ clineMessages: [message] })
		const handler = new TaskAskSayHandler(host)

		await expect(handler.ask("tool", "new", true, { status: "running" } as any, true)).rejects.toThrow(
			"updating existing partial",
		)

		expect(message).toMatchObject({
			text: "new",
			partial: true,
			progressStatus: { status: "running" },
			isProtected: true,
		})
		expect(host.updateClineMessage).toHaveBeenCalledWith(message)
	})

	it("finalizes the previous partial ask and waits for response", async () => {
		const message = { ts: 10, type: "ask", ask: "tool", text: "old", partial: true } as any
		const host = createHost({ clineMessages: [message] })
		pWaitForMock.mockImplementationOnce(async () => {
			host.askResponse = "yesButtonClicked"
		})
		const handler = new TaskAskSayHandler(host)

		const result = await handler.ask("tool", "final", false)

		expect(result.response).toBe("yesButtonClicked")
		expect(message.partial).toBe(false)
		expect(message.text).toBe("final")
		expect(host.saveClineMessages).toHaveBeenCalled()
		expect(host.updateClineMessage).toHaveBeenCalledWith(message)
	})

	it("drains queued user messages for followup asks", async () => {
		const host = createHost({ messageQueueService: createQueue([{ text: "answer", images: ["img"] }]) })
		const handler = new TaskAskSayHandler(host)
		const spy = vi.spyOn(handler, "handleWebviewAskResponse")

		const result = await handler.ask("followup", "Q?", false)

		expect(spy).toHaveBeenCalledWith("messageResponse", "answer", ["img"])
		expect(result).toEqual({ response: "messageResponse", text: "answer", images: ["img"] })
	})

	it.each(["tool", "command", "use_mcp_server", "completion_result"] as const)(
		"drains queued feedback without approving %s",
		async (type) => {
			const host = createHost({ messageQueueService: createQueue([{ text: "Do not execute" }]) })
			const handler = new TaskAskSayHandler(host)
			const spy = vi.spyOn(handler, "handleWebviewAskResponse")

			const result = await handler.ask(type, "run?", false, undefined, true)

			expect(spy).toHaveBeenCalledWith("messageResponse", "Do not execute", undefined)
			expect(result.response).toBe("messageResponse")
		},
	)

	it.each(["approve", "deny"] as const)(
		"does not overwrite a resolved %s decision with queued text",
		async (decision) => {
			const queue = createQueue([{ text: "next request" }])
			checkAutoApprovalMock.mockResolvedValue({ decision })
			const result = await new TaskAskSayHandler(createHost({ messageQueueService: queue })).ask(
				"command",
				"run?",
				false,
			)
			expect(result.response).toBe(decision === "deny" ? "noButtonClicked" : "yesButtonClicked")
			expect(queue.dequeueMessage).not.toHaveBeenCalled()
		},
	)

	it("does not drain queued messages for command_output asks", async () => {
		const queue = createQueue([{ text: "keep" }])
		const host = createHost({ messageQueueService: queue })
		pWaitForMock.mockImplementationOnce(async () => {
			host.askResponse = "yesButtonClicked"
		})
		const handler = new TaskAskSayHandler(host)

		const result = await handler.ask("command_output", "running", false)

		expect(queue.dequeueMessage).not.toHaveBeenCalled()
		expect(result.response).toBe("yesButtonClicked")
	})

	it("throws ignored ask when a newer message supersedes the ask", async () => {
		const host = createHost()
		pWaitForMock.mockImplementationOnce(async () => {
			host.lastMessageTs += 1
		})
		const handler = new TaskAskSayHandler(host)

		await expect(handler.ask("followup", "Q?", false)).rejects.toThrow("superseded")
	})

	it("clears idle/resumable/interactive state after response", async () => {
		const host = createHost()
		host.askResponse = "messageResponse"
		host.idleAsk = { ts: 1 } as any
		host.resumableAsk = { ts: 2 } as any
		host.interactiveAsk = { ts: 3 } as any
		const handler = new TaskAskSayHandler(host)

		await handler.ask("followup", "Q?", false)

		expect(host.idleAsk).toBeUndefined()
		expect(host.resumableAsk).toBeUndefined()
		expect(host.interactiveAsk).toBeUndefined()
		expect(host.emit).toHaveBeenCalledWith(expect.any(String), "task-1")
		expect(host.emit).toHaveBeenCalledWith(expect.any(String))
	})

	it("throws when say is called after abort", async () => {
		const handler = new TaskAskSayHandler(createHost({ abort: true }))

		await expect(handler.say("text", "hello")).rejects.toThrow("aborted")
	})

	it("adds normal say messages and updates lastMessageTs", async () => {
		const host = createHost()
		const handler = new TaskAskSayHandler(host)

		await handler.say("text", "hello", ["img"], undefined, { hash: "abc" })

		expect(host.addToClineMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "say",
				say: "text",
				text: "hello",
				images: ["img"],
				checkpoint: { hash: "abc" },
			}),
		)
		expect(host.lastMessageTs).toBeGreaterThan(0)
	})

	it("keeps lastMessageTs unchanged for non-interactive say messages", async () => {
		const host = createHost({ lastMessageTs: 99 })
		const handler = new TaskAskSayHandler(host)

		await handler.say("text", "background", undefined, undefined, undefined, undefined, { isNonInteractive: true })

		expect(host.lastMessageTs).toBe(99)
	})

	it("adds a new partial say message", async () => {
		const host = createHost()
		const handler = new TaskAskSayHandler(host)

		await handler.say("text", "partial", undefined, true)

		expect(host.addToClineMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "say",
				say: "text",
				text: "partial",
				partial: true,
			}),
		)
	})

	it("updates previous partial say in place", async () => {
		const message = { ts: 1, type: "say", say: "text", text: "old", partial: true } as any
		const host = createHost({ clineMessages: [message] })
		const handler = new TaskAskSayHandler(host)

		await handler.say("text", "new", ["img"], true, undefined, { status: "running" } as any)

		expect(message).toMatchObject({
			text: "new",
			images: ["img"],
			partial: true,
			progressStatus: { status: "running" },
		})
		expect(host.updateClineMessage).toHaveBeenCalledWith(message)
	})

	it("finalizes previous partial say and saves it", async () => {
		const message = { ts: 5, type: "say", say: "text", text: "old", partial: true } as any
		const host = createHost({ clineMessages: [message] })
		const handler = new TaskAskSayHandler(host)

		await handler.say("text", "done", undefined, false)

		expect(message.partial).toBe(false)
		expect(message.text).toBe("done")
		expect(host.saveClineMessages).toHaveBeenCalled()
		expect(host.updateClineMessage).toHaveBeenCalledWith(message)
	})

	it("marks followup ask answered on message response", () => {
		const followup = { ts: 1, type: "ask", ask: "followup", isAnswered: false } as any
		const host = createHost({ clineMessages: [followup] })
		const handler = new TaskAskSayHandler(host)

		handler.handleWebviewAskResponse("messageResponse", "ok", ["img"])

		expect(host.cancelAutoApprovalTimeout).toHaveBeenCalled()
		expect(host.askResponse).toBe("messageResponse")
		expect(host.askResponseText).toBe("ok")
		expect(host.askResponseImages).toEqual(["img"])
		expect(host.checkpointSave).toHaveBeenCalledWith(false, true)
		expect(followup.isAnswered).toBe(true)
		expect(host.saveClineMessages).toHaveBeenCalled()
	})

	it("marks tool ask answered on yes response", () => {
		const toolAsk = { ts: 1, type: "ask", ask: "tool", isAnswered: false } as any
		const host = createHost({ clineMessages: [toolAsk] })
		const handler = new TaskAskSayHandler(host)

		handler.handleWebviewAskResponse("yesButtonClicked")

		expect(toolAsk.isAnswered).toBe(true)
		expect(host.updateClineMessage).toHaveBeenCalledWith(toolAsk)
		expect(host.saveClineMessages).toHaveBeenCalled()
	})

	it("creates missing parameter errors through say and formatResponse", async () => {
		const host = createHost()
		const handler = new TaskAskSayHandler(host)

		const result = await handler.sayAndCreateMissingParamError("read_file" as any, "path", "src/a.ts")

		expect(host.addToClineMessages).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "say",
				say: "error",
				text: expect.stringContaining("without value for required parameter 'path'"),
			}),
		)
		expect(result).toContain("Missing value for required parameter 'path'")
	})

	describe("auto-approval", () => {
		it("calls approveAsk when checkAutoApproval returns approve", async () => {
			checkAutoApprovalMock.mockResolvedValue({ decision: "approve" })
			const host = createHost()
			const handler = new TaskAskSayHandler(host)

			const result = await handler.ask("tool", "run?", false)

			expect(checkAutoApprovalMock).toHaveBeenCalledWith(expect.objectContaining({ ask: "tool", text: "run?" }))
			expect(host.approveAsk).toHaveBeenCalled()
			expect(result.response).toBe("yesButtonClicked")
		})

		it("calls denyAsk when checkAutoApproval returns deny", async () => {
			checkAutoApprovalMock.mockResolvedValue({ decision: "deny" })
			const host = createHost()
			const handler = new TaskAskSayHandler(host)

			const result = await handler.ask("tool", "run?", false)

			expect(host.denyAsk).toHaveBeenCalled()
			expect(result.response).toBe("noButtonClicked")
		})

		it("schedules timeout and resolves via fn when checkAutoApproval returns timeout", async () => {
			vi.useFakeTimers()
			const timeoutFn = vi.fn(function () {
				return {
					askResponse: "messageResponse",
					text: "auto",
					images: ["img"],
				}
			})
			checkAutoApprovalMock.mockResolvedValue({
				decision: "timeout",
				timeout: 500,
				fn: timeoutFn,
			})

			const host = createHost()
			pWaitForMock.mockImplementation(async function (predicate: () => boolean) {
				vi.runOnlyPendingTimers()
				predicate()
			})

			const handler = new TaskAskSayHandler(host)
			const spy = vi.spyOn(handler, "handleWebviewAskResponse")
			const result = await handler.ask("followup", "Q?", false)

			expect(timeoutFn).toHaveBeenCalled()
			expect(spy).toHaveBeenCalledWith("messageResponse", "auto", ["img"])
			expect(result).toEqual({ response: "messageResponse", text: "auto", images: ["img"] })

			vi.useRealTimers()
		})
	})
})
