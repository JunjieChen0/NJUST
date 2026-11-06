import { beforeEach, describe, expect, it, vi } from "vitest"

const {
	appendFileMock,
	getTaskDirectoryPathMock,
	getSummaryMock,
	getBreaksBySourceMock,
	getTotalBreaksMock,
	clearMcpInstructionsDeltaMock,
	transitionTaskFilesToDetachedMock,
	releaseTerminalsForTaskMock,
	outputCleanupMock,
	disposeScopeMock,
} = vi.hoisted(() => ({
	appendFileMock: vi.fn(),
	getTaskDirectoryPathMock: vi.fn(),
	getSummaryMock: vi.fn(),
	getBreaksBySourceMock: vi.fn(),
	getTotalBreaksMock: vi.fn(),
	clearMcpInstructionsDeltaMock: vi.fn(),
	transitionTaskFilesToDetachedMock: vi.fn(),
	releaseTerminalsForTaskMock: vi.fn(),
	outputCleanupMock: vi.fn(),
	disposeScopeMock: vi.fn(),
}))

vi.mock("fs", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>
	return {
		...actual,
		promises: {
			...(actual.promises as Record<string, unknown>),
			appendFile: appendFileMock,
		},
	}
})

vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [],
		createFileSystemWatcher: vi.fn().mockReturnValue({
			onDidChange: vi.fn(),
			onDidCreate: vi.fn(),
			onDidDelete: vi.fn(),
			dispose: vi.fn(),
		}),
	},
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showInformationMessage: vi.fn(),
	},
	RelativePattern: vi.fn(),
}))

vi.mock("../../../utils/storage", () => ({
	getTaskDirectoryPath: getTaskDirectoryPathMock,
}))

vi.mock("../../../utils/cacheMetrics", () => ({
	globalCacheMetrics: {
		getSummary: getSummaryMock,
	},
}))

vi.mock("../../prompts/promptCacheBreakDetection", () => ({
	globalPromptCacheBreakDetector: {
		getBreaksBySource: getBreaksBySourceMock,
		getTotalBreaks: getTotalBreaksMock,
	},
}))

vi.mock("../../prompts/sections/mcp-instructions-delta", () => ({
	clearMcpInstructionsDelta: clearMcpInstructionsDeltaMock,
}))

vi.mock("../../../services/cangjie-lsp/cangjieGeneratedTestCleanup", () => ({
	transitionTaskFilesToDetached: transitionTaskFilesToDetachedMock,
}))

vi.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		releaseTerminalsForTask: releaseTerminalsForTaskMock,
	},
}))

vi.mock("../../../integrations/terminal/OutputInterceptor", () => ({
	OutputInterceptor: {
		cleanup: outputCleanupMock,
	},
}))

vi.mock("../../../services/sandbox", () => ({
	SandboxExecutionService: {
		getInstance: () => ({ disposeScope: disposeScopeMock }),
	},
	createTaskResourceScopeId: (taskId: string, instanceId: string) => `task:${taskId}:${instanceId}`,
}))

import { TaskLifecycleHandler } from "../TaskLifecycleHandler"

function createHost(overrides: Record<string, unknown> = {}) {
	const provider = { off: vi.fn(), postMessageToWebview: vi.fn() }
	const host: any = {
		taskId: "task-1",
		instanceId: "instance-1",
		globalStoragePath: "D:\\storage",
		hostRef: { deref: () => provider },
		errorRecovery: { resetCompactFailure: vi.fn() },
		messageQueueService: {
			removeListener: vi.fn(),
			dispose: vi.fn(),
		},
		toolExecution: { dispose: vi.fn() },
		fileContextTracker: { dispose: vi.fn() },
		diffViewProvider: {
			isEditing: false,
			revertChanges: vi.fn().mockResolvedValue(undefined),
		},
		abort: false,
		abandoned: false,
		taskCompleted: false,
		abortReason: undefined,
		isInitialized: false,
		isDisposed: false,
		isStreaming: false,
		consecutiveNoToolUseCount: 3,
		consecutiveNoAssistantMessagesCount: 4,
		persistentRetryHandler: { cancel: vi.fn() },
		providerProfileChangeListener: vi.fn(),
		modeHandler: { dispose: vi.fn(), providerProfileChangeListener: vi.fn() },
		messageQueueStateChangedHandler: vi.fn(),
		rooIgnoreController: { dispose: vi.fn() },
		clineMessages: [],
		apiConversationHistory: [],
		refreshWebviewState: vi.fn().mockResolvedValue(undefined),
		say: vi.fn().mockResolvedValue(undefined),
		ask: vi.fn().mockResolvedValue({ response: "yesButtonClicked" }),
		emit: vi.fn(),
		getEnabledMcpToolsCount: vi.fn().mockResolvedValue({ enabledToolCount: 0, enabledServerCount: 0 }),
		getTaskMode: vi.fn().mockResolvedValue("code"),
		initiateCloudAgentLoop: vi.fn().mockResolvedValue(undefined),
		initiateTaskLoop: vi.fn().mockResolvedValue(undefined),
		getSavedClineMessages: vi.fn().mockResolvedValue([]),
		getSavedApiConversationHistory: vi.fn().mockResolvedValue([]),
		overwriteClineMessages: vi.fn().mockResolvedValue(undefined),
		overwriteApiConversationHistory: vi.fn().mockResolvedValue(undefined),
		saveClineMessages: vi.fn().mockResolvedValue(true),
		emitFinalTokenUsageUpdate: vi.fn(),
		dispose: vi.fn(),
		cancelCurrentRequest: vi.fn(),
		removeAllListeners: vi.fn(),
		provider,
		...overrides,
	}
	return host
}

describe("TaskLifecycleHandler", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		getSummaryMock.mockReturnValue({
			totalRequests: 2,
			cacheHitRate: 0.5,
			totalCacheReadTokens: 10,
			totalCacheCreationTokens: 20,
			estimatedSavingsPercent: 0.25,
		})
		getBreaksBySourceMock.mockReturnValue({ system: 1 })
		getTotalBreaksMock.mockReturnValue(1)
		getTaskDirectoryPathMock.mockResolvedValue("D:\\storage\\tasks\\task-1")
		appendFileMock.mockResolvedValue(undefined)
		outputCleanupMock.mockResolvedValue(undefined)
		disposeScopeMock.mockResolvedValue(undefined)
	})

	it("starts default-mode tasks through the cloud agent loop", async () => {
		const host = createHost({ getTaskMode: vi.fn().mockResolvedValue("cloud-agent") })
		const handler = new TaskLifecycleHandler(host)

		await handler.startTask("hello", ["data:image/png;base64,aW1n"])

		expect(host.clineMessages).toEqual([])
		expect(host.apiConversationHistory).toEqual([])
		expect(host.refreshWebviewState).toHaveBeenCalled()
		expect(host.say).toHaveBeenCalledWith("text", "hello", ["data:image/png;base64,aW1n"])
		expect(host.isInitialized).toBe(true)
		expect(host.initiateCloudAgentLoop).toHaveBeenCalledWith("hello", ["data:image/png;base64,aW1n"])
		expect(host.initiateTaskLoop).not.toHaveBeenCalled()
	})

	it("emits a too-many-tools warning during start", async () => {
		const host = createHost({
			getTaskMode: vi.fn().mockResolvedValue("cloud-agent"),
			getEnabledMcpToolsCount: vi.fn().mockResolvedValue({ enabledToolCount: 999, enabledServerCount: 5 }),
		})
		const handler = new TaskLifecycleHandler(host)

		await handler.startTask("hello")

		expect(host.say).toHaveBeenCalledWith(
			"too_many_tools_warning",
			expect.stringContaining('"toolCount":999'),
			undefined,
			undefined,
			undefined,
			undefined,
			{ isNonInteractive: true },
		)
	})

	it("starts non-default-mode tasks through the local task loop", async () => {
		const host = createHost({ getTaskMode: vi.fn().mockResolvedValue("cangjie") })
		const handler = new TaskLifecycleHandler(host)

		await handler.startTask("compile", [])

		expect(host.initiateCloudAgentLoop).not.toHaveBeenCalled()
		expect(host.initiateTaskLoop).toHaveBeenCalledWith([
			{ type: "text", text: "[USER-MESSAGE]\ncompile\n[END USER-MESSAGE]" },
		])
	})

	it("suppresses start errors after user cancellation", async () => {
		const host = createHost({
			abortReason: "user_cancelled",
			initiateCloudAgentLoop: vi.fn().mockRejectedValue(new Error("cancelled")),
			getTaskMode: vi.fn().mockResolvedValue("cloud-agent"),
		})
		const handler = new TaskLifecycleHandler(host)

		await expect(handler.startTask("hello")).resolves.toBeUndefined()
	})

	it("aborts task state and disposes the host", async () => {
		const host = createHost()
		const handler = new TaskLifecycleHandler(host)

		await handler.abortTask(true)

		expect(host.abandoned).toBe(true)
		expect(host.abort).toBe(true)
		expect(host.persistentRetryHandler).toBeUndefined()
		expect(host.consecutiveNoToolUseCount).toBe(0)
		expect(host.consecutiveNoAssistantMessagesCount).toBe(0)
		expect(host.emitFinalTokenUsageUpdate).toHaveBeenCalled()
		expect(host.emit).toHaveBeenCalledWith(expect.any(String))
		expect(host.saveClineMessages).toHaveBeenCalled()
		expect(disposeScopeMock).toHaveBeenCalledWith("task:task-1:instance-1")
		expect(host.dispose).toHaveBeenCalled()
	})

	it("cancels network tools before awaiting cancellation persistence", async () => {
		const controller = new AbortController()
		const host = createHost({ toolAbortController: controller })
		const pending = new TaskLifecycleHandler(host).abortTask()
		expect(controller.signal.aborted).toBe(true)
		await pending
	})

	it("publishes cancellation verification facts after cancelling checks and before disposal", async () => {
		const host = createHost({
			cangjieVerification: { cancel: vi.fn() },
			publishVerificationSummary: vi.fn().mockResolvedValue(undefined),
			persistMemrlEpisode: vi.fn().mockResolvedValue(undefined),
		})
		await new TaskLifecycleHandler(host).abortTask()
		expect(host.publishVerificationSummary).toHaveBeenCalledWith("cancelled")
		expect(host.persistMemrlEpisode).toHaveBeenCalledWith("interrupted")
		expect(host.cangjieVerification.cancel.mock.invocationCallOrder[0]).toBeLessThan(
			host.publishVerificationSummary.mock.invocationCallOrder[0],
		)
		expect(host.publishVerificationSummary.mock.invocationCallOrder[0]).toBeLessThan(
			host.dispose.mock.invocationCallOrder[0],
		)
	})

	it.each([false, true])("does not record cancellation when leaving a task (completed=%s)", async (taskCompleted) => {
		const host = createHost({
			taskCompleted,
			publishVerificationSummary: vi.fn(),
			persistMemrlEpisode: vi.fn(),
		})
		await new TaskLifecycleHandler(host).abortTask(true)
		expect(host.publishVerificationSummary).not.toHaveBeenCalled()
		expect(host.persistMemrlEpisode).not.toHaveBeenCalled()
	})

	it("does not append a cancellation card to an already completed task", async () => {
		const host = createHost({
			taskCompleted: true,
			publishVerificationSummary: vi.fn(),
			persistMemrlEpisode: vi.fn(),
		})
		await new TaskLifecycleHandler(host).abortTask()
		expect(host.publishVerificationSummary).not.toHaveBeenCalled()
		expect(host.persistMemrlEpisode).not.toHaveBeenCalled()
	})

	it.each([false, true])(
		"preserves a verified history task while waiting to resume (abandoned=%s)",
		async (abandoned) => {
			const delivery = { ts: 1, type: "ask", ask: "completion_result" }
			const memory = { overall: "verified" }
			let rejectResume!: (error: Error) => void
			const host = createHost({
				getSavedClineMessages: vi.fn().mockResolvedValue([delivery]),
				ask: vi.fn(
					() =>
						new Promise((_resolve, reject) => {
							rejectResume = reject
						}),
				),
				publishVerificationSummary: vi.fn(async () => host.clineMessages.push({ say: "verification_summary" })),
				persistMemrlEpisode: vi.fn(async () => {
					memory.overall = "incomplete"
				}),
			})
			const handler = new TaskLifecycleHandler(host)
			const resuming = handler.resumeTaskFromHistory()
			await vi.waitFor(() => expect(host.ask).toHaveBeenCalledWith("resume_completed_task"))
			await handler.abortTask(abandoned)
			rejectResume(new Error("Task aborted"))
			await resuming
			expect(host.publishVerificationSummary).not.toHaveBeenCalled()
			expect(host.persistMemrlEpisode).not.toHaveBeenCalled()
			expect(host.clineMessages).toEqual([delivery])
			expect(memory.overall).toBe("verified")
		},
	)

	it("marks streaming errors as errors and still disposes when the summary cannot be written", async () => {
		const host = createHost({
			abortReason: "streaming_failed",
			publishVerificationSummary: vi.fn().mockRejectedValue(new Error("disk full")),
		})
		await new TaskLifecycleHandler(host).abortTask()
		expect(host.publishVerificationSummary).toHaveBeenCalledWith("error")
		expect(host.dispose).toHaveBeenCalled()
	})

	it("waits for sandbox cleanup before emitting abort and disposing", async () => {
		let resolveCleanup: (() => void) | undefined
		disposeScopeMock.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					resolveCleanup = resolve
				}),
		)
		const host = createHost()
		const handler = new TaskLifecycleHandler(host)

		const aborting = handler.abortTask()
		await vi.waitFor(() => expect(disposeScopeMock).toHaveBeenCalled())
		expect(host.emit).not.toHaveBeenCalled()
		expect(host.dispose).not.toHaveBeenCalled()

		resolveCleanup?.()
		await aborting
		expect(host.emit).toHaveBeenCalledWith(expect.any(String))
		expect(host.dispose).toHaveBeenCalled()
	})

	it("emits abort and disposes even when sandbox cleanup fails", async () => {
		disposeScopeMock.mockRejectedValueOnce(new Error("sandbox cleanup failed")).mockResolvedValueOnce(undefined)
		const host = createHost()
		const handler = new TaskLifecycleHandler(host)

		// abortTask resolves (does not reject) even when cleanup fails
		await expect(handler.abortTask()).resolves.toBeUndefined()
		// TaskAborted is always emitted regardless of cleanup outcome
		expect(host.emit).toHaveBeenCalledWith(expect.any(String))
		expect(host.dispose).toHaveBeenCalledOnce()

		// Second call also succeeds (cleanup retry resolves)
		await expect(handler.abortTask()).resolves.toBeUndefined()
		expect(disposeScopeMock).toHaveBeenCalledTimes(2)
		expect(host.emit).toHaveBeenCalledTimes(2)
		expect(host.dispose).toHaveBeenCalledTimes(2)
	})

	it("persists a warning when terminal exit cannot be confirmed", async () => {
		disposeScopeMock.mockRejectedValueOnce(new Error("Terminal process exit could not be confirmed"))
		const reportCommandCleanupFailure = vi.fn().mockResolvedValue(undefined)
		const host = createHost({ reportCommandCleanupFailure })
		await new TaskLifecycleHandler(host).abortTask()
		expect(reportCommandCleanupFailure).toHaveBeenCalledWith(expect.stringContaining("could not be confirmed"))
		expect(reportCommandCleanupFailure.mock.invocationCallOrder[0]).toBeLessThan(
			host.dispose.mock.invocationCallOrder[0],
		)
		expect(host.emit).toHaveBeenCalled()
	})

	it("continues abort cleanup when save and dispose throw", async () => {
		const host = createHost({
			saveClineMessages: vi.fn().mockRejectedValue(new Error("save failed")),
			dispose: vi.fn(function () {
				throw new Error("dispose failed")
			}),
		})
		const handler = new TaskLifecycleHandler(host)

		await expect(handler.abortTask()).resolves.toBeUndefined()

		expect(host.abort).toBe(true)
		expect(host.dispose).toHaveBeenCalled()
		await expect(handler.waitForCheckpointCleanup()).rejects.toThrow("dispose failed")
	})

	it("disposes resources once and writes session metrics", async () => {
		const host = createHost()
		const handler = new TaskLifecycleHandler(host)

		handler.dispose()
		handler.dispose()

		expect(host.isDisposed).toBe(true)
		expect(clearMcpInstructionsDeltaMock).toHaveBeenCalledWith("task-1")
		expect(transitionTaskFilesToDetachedMock).toHaveBeenCalledWith("task-1")
		expect(host.cancelCurrentRequest).toHaveBeenCalledTimes(1)
		expect(host.modeHandler.dispose).toHaveBeenCalled()
		expect(host.messageQueueService.removeListener).toHaveBeenCalledWith("stateChanged", expect.any(Function))
		expect(host.messageQueueService.dispose).toHaveBeenCalled()
		expect(host.removeAllListeners).toHaveBeenCalled()
		await vi.waitFor(() => expect(disposeScopeMock).toHaveBeenCalledTimes(1))
		await vi.waitFor(() => expect(releaseTerminalsForTaskMock).toHaveBeenCalledWith("task-1"))
		expect(host.rooIgnoreController).toBeUndefined()
		expect(host.toolExecution.dispose).toHaveBeenCalled()
		expect(host.fileContextTracker.dispose).toHaveBeenCalled()
		expect(appendFileMock).toHaveBeenCalledWith(
			expect.stringContaining("task-metrics.jsonl"),
			expect.stringContaining('"trigger":"dispose"'),
			"utf8",
		)
	})

	it("reverts an active diff view during streaming dispose", () => {
		const host = createHost({
			isStreaming: true,
			diffViewProvider: { isEditing: true, revertChanges: vi.fn().mockResolvedValue(undefined) },
		})
		const handler = new TaskLifecycleHandler(host)

		handler.dispose()

		expect(host.diffViewProvider.revertChanges).toHaveBeenCalled()
	})

	it("uses abort as metrics trigger when disposed after abort", async () => {
		const host = createHost({ abort: true })
		const handler = new TaskLifecycleHandler(host)

		handler.dispose()
		await Promise.resolve()

		expect(appendFileMock).toHaveBeenCalledWith(
			expect.any(String),
			expect.stringContaining('"trigger":"abort"'),
			"utf8",
		)
	})

	it("resumes history by cleaning stale UI messages and continuing with default resume text", async () => {
		const savedClineMessages = [
			{ ts: 1, type: "say", say: "text", text: "old" },
			{ ts: 2, type: "say", say: "api_req_started", text: "{}" },
			{ ts: 3, type: "say", say: "reasoning", text: "thinking" },
			{ ts: 4, type: "ask", ask: "resume_task" },
		] as any[]
		const savedApi = [{ role: "assistant", content: "done" }] as any[]
		const host = createHost({
			getSavedClineMessages: vi
				.fn()
				.mockResolvedValueOnce(savedClineMessages)
				.mockResolvedValueOnce([{ ts: 1, type: "say", say: "text", text: "old" }]),
			getSavedApiConversationHistory: vi.fn().mockResolvedValueOnce(savedApi).mockResolvedValueOnce(savedApi),
		})
		const handler = new TaskLifecycleHandler(host)

		await handler.resumeTaskFromHistory()

		expect(host.overwriteClineMessages).toHaveBeenCalledWith([{ ts: 1, type: "say", say: "text", text: "old" }])
		expect(host.errorRecovery.resetCompactFailure).toHaveBeenCalled()
		expect(host.ask).toHaveBeenCalledWith("resume_task")
		expect(host.overwriteApiConversationHistory).toHaveBeenCalledWith(savedApi)
		expect(host.initiateTaskLoop).toHaveBeenCalledWith([
			{ type: "text", text: "[TASK RESUMPTION] Resuming task..." },
		])
	})

	it("resumes completed tasks with user feedback and images", async () => {
		const savedClineMessages = [{ ts: 1, type: "ask", ask: "completion_result" }] as any[]
		const savedApi = [{ role: "user", content: "old request" }] as any[]
		const host = createHost({
			getSavedClineMessages: vi.fn().mockResolvedValue(savedClineMessages),
			getSavedApiConversationHistory: vi.fn().mockResolvedValueOnce(savedApi).mockResolvedValueOnce(savedApi),
			ask: vi.fn().mockResolvedValue({
				response: "messageResponse",
				text: "continue",
				images: ["data:image/png;base64,aW1n"],
			}),
		})
		const handler = new TaskLifecycleHandler(host)

		await handler.resumeTaskFromHistory()

		expect(host.ask).toHaveBeenCalledWith("resume_completed_task")
		expect(host.say).toHaveBeenCalledWith("user_feedback", "continue", ["data:image/png;base64,aW1n"])
		expect(host.overwriteApiConversationHistory).toHaveBeenCalledWith([])
		const newUserContent = host.initiateTaskLoop.mock.calls[0][0]
		expect(newUserContent[0]).toEqual({ type: "text", text: "old request" })
		expect(newUserContent[1]).toEqual({ type: "text", text: "[USER-MESSAGE]\ncontinue\n[END USER-MESSAGE]" })
		expect(newUserContent.length).toBeGreaterThan(2)
	})

	it("shows verification changes before resume and includes them in model context alongside user feedback", async () => {
		const notice = "仓颉验证输入已变化：src/main.cj"
		const host = createHost({
			cangjieVerification: { onTaskResumed: vi.fn().mockResolvedValue(notice) },
			getSavedApiConversationHistory: vi.fn().mockResolvedValue([{ role: "user", content: "old request" }]),
			ask: vi.fn().mockResolvedValue({ response: "messageResponse", text: "继续" }),
		})
		await new TaskLifecycleHandler(host).resumeTaskFromHistory()
		expect(host.say).toHaveBeenCalledWith("text", notice)
		expect(host.say.mock.invocationCallOrder[0]).toBeLessThan(host.ask.mock.invocationCallOrder[0])
		expect(host.initiateTaskLoop.mock.calls[0][0]).toEqual(
			expect.arrayContaining([
				{ type: "text", text: `[TASK RESUMPTION]\n${notice}` },
				{ type: "text", text: "[USER-MESSAGE]\n继续\n[END USER-MESSAGE]" },
			]),
		)
	})

	it("continues task resume when verification history cannot be read", async () => {
		const host = createHost({
			cangjieVerification: { onTaskResumed: vi.fn().mockRejectedValue(new Error("corrupt verification")) },
			getSavedApiConversationHistory: vi.fn().mockResolvedValue([{ role: "user", content: "old request" }]),
		})
		await new TaskLifecycleHandler(host).resumeTaskFromHistory()
		expect(host.ask).toHaveBeenCalledWith("resume_task")
		expect(host.initiateTaskLoop).toHaveBeenCalled()
	})

	it("adds interrupted tool results when resuming after assistant tool use", async () => {
		const assistant = {
			role: "assistant",
			content: [{ type: "tool_use", id: "tool-1", name: "read_file", input: {} }],
		}
		const host = createHost({
			getSavedClineMessages: vi.fn().mockResolvedValue([{ ts: 1, type: "say", say: "text" }]),
			getSavedApiConversationHistory: vi
				.fn()
				.mockResolvedValueOnce([assistant])
				.mockResolvedValueOnce([assistant]),
		})
		const handler = new TaskLifecycleHandler(host)

		await handler.resumeTaskFromHistory()

		expect(host.initiateTaskLoop).toHaveBeenCalledWith([
			expect.objectContaining({
				type: "tool_result",
				tool_use_id: "tool-1",
				content: expect.stringContaining("interrupted"),
			}),
		])
	})

	it("suppresses resume errors after abort", async () => {
		const host = createHost({
			abort: true,
			getSavedClineMessages: vi.fn().mockRejectedValue(new Error("read failed")),
		})
		const handler = new TaskLifecycleHandler(host)

		await expect(handler.resumeTaskFromHistory()).resolves.toBeUndefined()
	})
	it("waits for pending editor rollback before checkpoint restore", async () => {
		let finish!: () => void
		const rollback = new Promise<void>((resolve) => {
			finish = resolve
		})
		const host = createHost({ isStreaming: true })
		host.diffViewProvider.isEditing = true
		host.diffViewProvider.revertChanges.mockReturnValue(rollback)
		const handler = new TaskLifecycleHandler(host)
		handler.dispose()
		let done = false
		const pending = handler.waitForCheckpointCleanup().then(() => {
			done = true
		})
		await Promise.resolve()
		expect(done).toBe(false)
		finish()
		await pending
		expect(done).toBe(true)
	})

	it("refuses checkpoint restoration after sandbox cleanup failure", async () => {
		disposeScopeMock.mockRejectedValue(new Error("cleanup failed"))
		const handler = new TaskLifecycleHandler(createHost())
		await handler.abortTask()
		await expect(handler.waitForCheckpointCleanup()).rejects.toThrow("cleanup failed")
	})
})
