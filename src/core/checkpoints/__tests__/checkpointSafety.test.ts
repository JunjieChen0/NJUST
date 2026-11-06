import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { checkpointRestore, checkpointSave, getCheckpointService } from "../index"
import { handleCheckpointRestoreOperation } from "../../webview/checkpointRestoreHandler"

const mocks = vi.hoisted(() => ({
	create: vi.fn(),
	errors: vi.fn(),
	saveMessages: vi.fn(),
	terminals: vi.fn(),
	gitInstalled: vi.fn(),
}))
vi.mock("vscode", () => ({
	window: { showErrorMessage: mocks.errors, showWarningMessage: vi.fn(), showInformationMessage: vi.fn() },
	commands: { executeCommand: vi.fn() },
	Uri: { file: vi.fn(), parse: vi.fn() },
}))
vi.mock("../../../shared/logger", () => ({ logger: { info() {}, warn() {}, error() {}, debug() {} } }))
vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: {
		reportError() {},
		instance: { captureCheckpointCreated() {}, captureCheckpointRestored() {}, captureCheckpointDiffed() {} },
	},
}))
vi.mock("../../../utils/git", () => ({ checkGitInstalled: mocks.gitInstalled }))
vi.mock("../../../utils/path", () => ({ getWorkspacePath: () => "fixture-workspace" }))
vi.mock("../../../i18n", () => ({ t: (key: string) => key }))
vi.mock("../../../shared/getApiMetrics", () => ({
	getApiMetrics: () => ({
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheWrites: 0,
		totalCacheReads: 0,
		totalCost: 0,
	}),
}))
vi.mock("../../../services/checkpoints", () => ({ RepoPerTaskCheckpointService: { create: mocks.create } }))
vi.mock("../../task-persistence", () => ({ saveTaskMessages: mocks.saveMessages }))
vi.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: { getTerminals: mocks.terminals },
}))

function deferred() {
	let release!: () => void
	const promise = new Promise<void>((resolve) => {
		release = resolve
	})
	return { promise, release }
}

function fixture() {
	const provider: any = {
		context: { globalStorageUri: { fsPath: "fixture-storage" } },
		contextProxy: { globalStorageUri: { fsPath: "fixture-storage" } },
		log: vi.fn(),
		postMessageToWebview: vi.fn(),
		cancelTask: vi.fn(),
		setPendingEditOperation: vi.fn(),
		getTaskWithId: vi.fn().mockResolvedValue({ historyItem: { id: "fixture-task" } }),
		createTaskWithHistoryItem: vi.fn(),
	}
	const service: any = {
		isInitialized: true,
		saveCheckpoint: vi.fn().mockResolvedValue({ commit: "fake-hash" }),
		restoreCheckpoint: vi.fn(),
		on: vi.fn(),
		initShadowGit: vi.fn(),
	}
	const task: any = {
		taskId: "fixture-task",
		cwd: "fixture-workspace",
		enableCheckpoints: true,
		checkpointTimeout: 10,
		checkpointService: service,
		checkpointServiceInitializing: false,
		providerRef: { deref: () => provider },
		clineMessages: [{ ts: 1, say: "checkpoint_saved", text: "fake-hash" }],
		messageManager: { rewindToTimestamp: vi.fn() },
		combineMessages: () => [],
		say: vi.fn().mockResolvedValue(undefined),
		persistCheckpointConversation: vi.fn().mockResolvedValue(undefined),
		abort: false,
		cancelCurrentRequest: vi.fn(),
		waitForTaskLoopIdle: vi.fn(),
		waitForCheckpointCleanup: vi.fn(),
	}
	task.abortTask = vi.fn(async () => {
		task.abort = true
	})
	task.checkpointRestore = (options: any) => checkpointRestore(task, options)
	provider.getCurrentTask = () => task
	mocks.create.mockReturnValue(service)
	return { provider, service, task }
}

beforeEach(() => {
	vi.clearAllMocks()
	mocks.gitInstalled.mockResolvedValue(true)
	mocks.terminals.mockReturnValue([])
})
afterEach(() => vi.useRealTimers())

describe("checkpoint failure and cancellation boundaries", () => {
	it("awaits the snapshot before completing a save", async () => {
		const { task, service } = fixture(),
			gate = deferred()
		service.saveCheckpoint.mockImplementation(() => gate.promise)
		let finished = false
		const pending = checkpointSave(task, true).then(() => {
			finished = true
		})
		await Promise.resolve()
		await Promise.resolve()
		expect(finished).toBe(false)
		gate.release()
		await pending
		expect(finished).toBe(true)
	})

	it("bounds the first initialization and shared waiters, aborts it and ignores late completion", async () => {
		vi.useFakeTimers()
		const { task, service, provider } = fixture(),
			gate = deferred()
		task.checkpointService = undefined
		service.initShadowGit.mockImplementation(() => gate.promise)
		const first = getCheckpointService(task),
			second = getCheckpointService(task)
		await vi.advanceTimersByTimeAsync(10_001)
		expect(await first).toBeUndefined()
		expect(await second).toBeUndefined()
		expect(service.initShadowGit).toHaveBeenCalledOnce()
		expect(service.initShadowGit.mock.calls[0][1].aborted).toBe(true)
		expect(provider.postMessageToWebview).toHaveBeenCalledWith({
			type: "checkpointInitWarning",
			checkpointWarning: { type: "INIT_TIMEOUT", timeout: 10 },
		})
		gate.release()
		await vi.advanceTimersByTimeAsync(1)
		expect(task.checkpointService).toBeUndefined()
		expect(task.checkpointServiceInitializing).toBe(false)
		expect(task.enableCheckpoints).toBe(false)
	})

	it("includes Git availability checking in the initialization deadline", async () => {
		vi.useFakeTimers()
		const { task, service } = fixture(),
			gate = deferred()
		task.checkpointService = undefined
		mocks.gitInstalled.mockImplementation(() => gate.promise.then(() => true))
		const pending = getCheckpointService(task)
		await vi.advanceTimersByTimeAsync(10_001)
		expect(await pending).toBeUndefined()
		expect(mocks.gitInstalled.mock.calls[0][0].aborted).toBe(true)
		gate.release()
		await vi.advanceTimersByTimeAsync(1)
		expect(service.initShadowGit).not.toHaveBeenCalled()
	})

	it("reports a failed save instead of leaving only a log", async () => {
		const { task, service } = fixture()
		service.saveCheckpoint.mockRejectedValue(new Error("staging failed"))
		await checkpointSave(task)
		expect(mocks.errors).toHaveBeenCalledWith("common:errors.checkpoint_save_failed")
		expect(task.enableCheckpoints).toBe(false)
	})

	it("reports an initial snapshot failure and never publishes the failed service", async () => {
		const { task, service } = fixture()
		task.checkpointService = undefined
		service.initShadowGit.mockRejectedValue(new Error("initial staging failed"))
		expect(await getCheckpointService(task)).toBeUndefined()
		expect(mocks.errors).toHaveBeenCalledWith("common:errors.checkpoint_init_failed")
		expect(task.checkpointService).toBeUndefined()
		expect(task.enableCheckpoints).toBe(false)
		expect(task.checkpointServiceInitializing).toBe(false)
	})

	it("propagates a failed reset without success publication or conversation changes", async () => {
		const { task, service, provider } = fixture()
		service.restoreCheckpoint.mockRejectedValue(new Error("index.lock failure"))
		await expect(checkpointRestore(task, { ts: 1, commitHash: "fake-hash", mode: "restore" })).rejects.toThrow(
			"checkpoint_restore_failed",
		)
		expect(task.messageManager.rewindToTimestamp).not.toHaveBeenCalled()
		expect(provider.postMessageToWebview).not.toHaveBeenCalled()
	})

	it("does not persist, rebuild or schedule an edit after restore failure", async () => {
		const { task, service, provider } = fixture()
		service.restoreCheckpoint.mockRejectedValue(new Error("restore failure"))
		await expect(
			handleCheckpointRestoreOperation({
				provider,
				currentCline: task,
				messageTs: 1,
				messageIndex: 0,
				checkpoint: { hash: "fake-hash" },
				operation: "edit",
				editData: { editedContent: "replacement", apiConversationHistoryIndex: 0 },
			}),
		).rejects.toThrow()
		expect(mocks.saveMessages).not.toHaveBeenCalled()
		expect(provider.createTaskWithHistoryItem).not.toHaveBeenCalled()
		expect(provider.setPendingEditOperation).not.toHaveBeenCalled()
		expect(mocks.errors).toHaveBeenCalledOnce()
	})

	it.each(["delete", "edit"] as const)(
		"waits for abort cleanup before %s restoration, even if the flag is already set",
		async (operation) => {
			const { task, provider, service } = fixture(),
				gate = deferred()
			task.abort = true
			task.abortTask.mockImplementation(() => gate.promise)
			const pending = handleCheckpointRestoreOperation({
				provider,
				currentCline: task,
				messageTs: 1,
				messageIndex: 0,
				checkpoint: { hash: "fake-hash" },
				operation,
			})
			await vi.waitFor(() => expect(task.abortTask).toHaveBeenCalledOnce())
			expect(service.restoreCheckpoint).not.toHaveBeenCalled()
			gate.release()
			await pending
			expect(task.waitForTaskLoopIdle).toHaveBeenCalledOnce()
			expect(task.waitForCheckpointCleanup).toHaveBeenCalledOnce()
			expect(service.restoreCheckpoint).toHaveBeenCalledOnce()
		},
	)

	it("stops on unconfirmed process cleanup", async () => {
		const { task, provider, service } = fixture()
		task.waitForCheckpointCleanup.mockRejectedValue(new Error("process exit unconfirmed"))
		await expect(
			handleCheckpointRestoreOperation({
				provider,
				currentCline: task,
				messageTs: 1,
				messageIndex: 0,
				checkpoint: { hash: "fake-hash" },
				operation: "delete",
			}),
		).rejects.toThrow("unconfirmed")
		expect(service.restoreCheckpoint).not.toHaveBeenCalled()
	})

	it("does not resume restoration after cancellation times out and later completes", async () => {
		vi.useFakeTimers()
		const { task, provider, service } = fixture(),
			gate = deferred()
		task.abortTask.mockImplementation(() => gate.promise)
		const pending = handleCheckpointRestoreOperation({
			provider,
			currentCline: task,
			messageTs: 1,
			messageIndex: 0,
			checkpoint: { hash: "fake-hash" },
			operation: "delete",
		})
		const rejected = expect(pending).rejects.toThrow("checkpoint_cancel_failed")
		await vi.advanceTimersByTimeAsync(10_001)
		await rejected
		gate.release()
		await vi.advanceTimersByTimeAsync(1)
		expect(service.restoreCheckpoint).not.toHaveBeenCalled()
		expect(provider.createTaskWithHistoryItem).not.toHaveBeenCalled()
	})

	it("reports an unconfirmed terminal exit and leaves files untouched", async () => {
		vi.useFakeTimers()
		const { task, provider, service } = fixture()
		const terminal = { busy: true, running: true, process: { abort: vi.fn() } }
		mocks.terminals.mockReturnValue([terminal])
		const pending = handleCheckpointRestoreOperation({
			provider,
			currentCline: task,
			messageTs: 1,
			messageIndex: 0,
			checkpoint: { hash: "fake-hash" },
			operation: "edit",
		})
		const rejected = expect(pending).rejects.toThrow("checkpoint_cancel_failed")
		await vi.advanceTimersByTimeAsync(5_001)
		await rejected
		expect(terminal.process.abort).toHaveBeenCalledOnce()
		expect(service.restoreCheckpoint).not.toHaveBeenCalled()
		expect(provider.createTaskWithHistoryItem).not.toHaveBeenCalled()
	})

	it("reports partial restore and withholds the success hash when history rewind fails", async () => {
		const { task, service, provider } = fixture()
		task.messageManager.rewindToTimestamp.mockRejectedValue(new Error("history persistence failure"))
		await expect(checkpointRestore(task, { ts: 1, commitHash: "fake-hash", mode: "restore" })).rejects.toThrow(
			"checkpoint_partial_restore",
		)
		expect(service.restoreCheckpoint).toHaveBeenCalledOnce()
		expect(provider.postMessageToWebview).not.toHaveBeenCalled()
	})

	it("does not use say() on an aborted task and requires persisted restored history", async () => {
		const { task, provider } = fixture()
		task.abort = true
		task.say.mockRejectedValue(new Error("TaskAbortedError"))
		task.persistCheckpointConversation.mockRejectedValue(new Error("disk write failed"))
		await expect(checkpointRestore(task, { ts: 1, commitHash: "fake-hash", mode: "restore" })).rejects.toThrow(
			"checkpoint_partial_restore",
		)
		expect(task.say).not.toHaveBeenCalled()
		expect(provider.postMessageToWebview).not.toHaveBeenCalled()
	})
})
