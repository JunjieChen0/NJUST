import * as vscode from "vscode"

import { type ClineApiReqInfo, TelemetryEventName } from "@njust-ai/types"
import { TelemetryService } from "@njust-ai/telemetry"
import { logger } from "../../shared/logger"

import type { Task } from "../task/Task"
import type { ITaskHost } from "../task/interfaces/ITaskHost"

import { getWorkspacePath } from "../../utils/path"
import { checkGitInstalled } from "../../utils/git"
import { t } from "../../i18n"

import { getApiMetrics } from "../../shared/getApiMetrics"

import { DIFF_VIEW_URI_SCHEME } from "../../integrations/editor/diffViewConstants"

import { RepoPerTaskCheckpointService } from "../../services/checkpoints"
import { getErrorMessage } from "../../shared/error-utils"

const WARNING_THRESHOLD_MS = 5000

function sendCheckpointInitWarn(task: Task, type?: "WAIT_TIMEOUT" | "INIT_TIMEOUT", timeout?: number) {
	void task.providerRef.deref()?.postMessageToWebview({
		type: "checkpointInitWarning",
		checkpointWarning: type && timeout ? { type, timeout } : undefined,
	})
}

const initializations = new WeakMap<Task, Promise<RepoPerTaskCheckpointService | undefined>>()

export async function getCheckpointService(task: Task) {
	if (!task.enableCheckpoints) return undefined
	if (task.checkpointService?.isInitialized) return task.checkpointService
	const pending = initializations.get(task)
	if (pending) return pending

	const provider = task.providerRef.deref()
	const controller = new AbortController()
	const timeoutError = new Error(
		t("common:errors.init_checkpoint_fail_long_time", { timeout: task.checkpointTimeout }),
	)
	timeoutError.name = "TimeoutError"
	const timeout = setTimeout(() => controller.abort(timeoutError), task.checkpointTimeout * 1000)
	const warning = setTimeout(
		() => sendCheckpointInitWarn(task, "WAIT_TIMEOUT", WARNING_THRESHOLD_MS / 1000),
		WARNING_THRESHOLD_MS,
	)
	const aborted = new Promise<never>((_, reject) => {
		controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })
	})
	const log = (message: string) => logger.info("Checkpoints", message)
	task.checkpointServiceInitializing = true
	const initialize = async () => {
		const workspaceDir = task.cwd || getWorkspacePath()
		const globalStorageDir = provider?.context.globalStorageUri.fsPath
		if (!workspaceDir || !globalStorageDir)
			throw new Error("Checkpoint workspace or storage directory is unavailable")
		const service = RepoPerTaskCheckpointService.create({
			taskId: task.taskId,
			workspaceDir,
			shadowDir: globalStorageDir,
			log,
		})
		await checkGitInstallation(task, service, log, provider, controller.signal)
		controller.signal.throwIfAborted()
		if (!task.enableCheckpoints) return undefined
		task.checkpointService = service
		sendCheckpointInitWarn(task)
		return service
	}
	const initialization = Promise.race([initialize(), aborted])
		.catch((error: unknown) => {
			if (controller.signal.aborted) sendCheckpointInitWarn(task, "INIT_TIMEOUT", task.checkpointTimeout)
			else
				void vscode.window.showErrorMessage(
					t("common:errors.checkpoint_init_failed", { error: getErrorMessage(error) }),
				)
			logger.error("Checkpoints", "Checkpoint initialization failed", error)
			TelemetryService.reportError(error, TelemetryEventName.CHECKPOINT_ERROR)
			task.enableCheckpoints = false
			return undefined
		})
		.finally(() => {
			clearTimeout(timeout)
			clearTimeout(warning)
			task.checkpointServiceInitializing = false
			initializations.delete(task)
		})
	initializations.set(task, initialization)
	return initialization
}

async function checkGitInstallation(
	task: Task,
	service: RepoPerTaskCheckpointService,
	log: (message: string) => void,
	provider: ITaskHost | undefined,
	signal: AbortSignal,
) {
	try {
		const gitInstalled = await checkGitInstalled(signal)

		signal.throwIfAborted()
		if (!gitInstalled) {
			log("[Task#getCheckpointService] Git is not installed, disabling checkpoints")
			task.enableCheckpoints = false
			task.checkpointServiceInitializing = false

			// Show user-friendly notification
			void vscode.window
				.showWarningMessage(t("common:errors.git_not_installed"), t("common:buttons.learn_more"))
				.then((selection) => {
					if (selection === t("common:buttons.learn_more"))
						return vscode.env.openExternal(vscode.Uri.parse("https://git-scm.com/downloads"))
					return undefined
				})

			return
		}

		// Git is installed, proceed with initialization
		service.on("initialize", () => {
			log("[Task#getCheckpointService] service initialized")
			task.checkpointServiceInitializing = false
		})

		service.on("checkpoint", ({ fromHash: from, toHash: to, suppressMessage }) => {
			try {
				sendCheckpointInitWarn(task)
				// Always update the current checkpoint hash in the webview, including the suppress flag
				void provider?.postMessageToWebview({
					type: "currentCheckpointUpdated",
					text: to,
					suppressMessage: !!suppressMessage,
				})

				// Always create the chat message but include the suppress flag in the payload
				// so the chatview can choose not to render it while keeping it in history.
				task.say(
					"checkpoint_saved",
					to,
					undefined,
					undefined,
					{ from, to, suppressMessage: !!suppressMessage },
					undefined,
					{ isNonInteractive: true },
				).catch((err) => {
					log("[Task#getCheckpointService] caught unexpected error in say('checkpoint_saved')")
					logger.error("Checkpoints", "say('checkpoint_saved') error:", err)
					TelemetryService.reportError(err, TelemetryEventName.CHECKPOINT_ERROR)
				})
			} catch (err) {
				log("[Task#getCheckpointService] caught unexpected error in on('checkpoint'), disabling checkpoints")
				logger.error("Checkpoints", "on('checkpoint') error:", err)
				TelemetryService.reportError(err, TelemetryEventName.CHECKPOINT_ERROR)
				task.enableCheckpoints = false
			}
		})

		log("[Task#getCheckpointService] initializing shadow git")

		await service.initShadowGit(undefined, signal)
		task.checkpointServiceInitializing = false
	} catch (err) {
		signal.throwIfAborted()
		log(`[Task#getCheckpointService] Unexpected error during Git check: ${getErrorMessage(err)}`)
		logger.error("Checkpoints", "Git check error:", err)
		TelemetryService.reportError(err, TelemetryEventName.CHECKPOINT_ERROR)
		task.enableCheckpoints = false
		task.checkpointServiceInitializing = false
		throw err
	}
}

export async function checkpointSave(task: Task, force = false, suppressMessage = false) {
	const service = await getCheckpointService(task)

	if (!service) {
		return
	}

	TelemetryService.instance.captureCheckpointCreated(task.taskId)

	// Callers that edit files await this snapshot.
	return service
		.saveCheckpoint(`Task: ${task.taskId}, Time: ${Date.now()}`, { allowEmpty: force, suppressMessage })
		.catch((err) => {
			logger.error("Checkpoints", "checkpointSave caught unexpected error, disabling checkpoints:", err)
			TelemetryService.reportError(err, TelemetryEventName.CHECKPOINT_ERROR)
			task.enableCheckpoints = false
			void vscode.window.showErrorMessage(
				t("common:errors.checkpoint_save_failed", { error: getErrorMessage(err) }),
			)
		})
}

export type CheckpointRestoreOptions = {
	ts: number
	commitHash: string
	mode: "preview" | "restore"
	operation?: "delete" | "edit" // Optional to maintain backward compatibility
}

export async function checkpointRestore(
	task: Task,
	{ ts, commitHash, mode, operation = "delete" }: CheckpointRestoreOptions,
) {
	const service = await getCheckpointService(task)

	if (!service) throw new Error(t("common:errors.checkpoint_unavailable"))

	const index = task.clineMessages.findIndex((m) => m.ts === ts)

	if (index === -1) throw new Error(t("common:errors.checkpoint_message_missing"))

	const provider = task.providerRef.deref()

	let filesRestored = false
	try {
		await service.restoreCheckpoint(commitHash)
		filesRestored = true
		try {
			await task.cangjieVerification?.onCheckpointRestored()
		} catch (error) {
			logger.debug("Checkpoints", "Verification refresh after checkpoint restore failed", error)
		}

		if (mode === "restore") {
			// Calculate metrics from messages that will be deleted (must be done before rewind)
			const deletedMessages = task.clineMessages.slice(index + 1)

			const { totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, totalCost } = getApiMetrics(
				task.combineMessages(deletedMessages),
			)

			// Use MessageManager to properly handle context-management events
			// This ensures orphaned Summary messages and truncation markers are cleaned up
			await task.messageManager.rewindToTimestamp(ts, {
				includeTargetMessage: operation === "edit",
			})

			// Report the deleted API request metrics
			await task.persistCheckpointConversation(
				JSON.stringify({
					tokensIn: totalTokensIn,
					tokensOut: totalTokensOut,
					cacheWrites: totalCacheWrites,
					cacheReads: totalCacheReads,
					cost: totalCost,
				} satisfies ClineApiReqInfo),
			)
		}

		// Publish success only after both files and requested conversation state are restored.
		await provider?.postMessageToWebview({ type: "currentCheckpointUpdated", text: commitHash })
		TelemetryService.instance.captureCheckpointRestored(task.taskId)
	} catch (error) {
		provider?.log(`[checkpointRestore] disabling checkpoints for this task: ${getErrorMessage(error)}`)
		TelemetryService.reportError(error, TelemetryEventName.CHECKPOINT_ERROR)
		task.enableCheckpoints = false
		throw new Error(
			t(filesRestored ? "common:errors.checkpoint_partial_restore" : "common:errors.checkpoint_restore_failed", {
				error: getErrorMessage(error),
			}),
		)
	}
}

export type CheckpointDiffOptions = {
	ts?: number
	previousCommitHash?: string
	commitHash: string
	/**
	 * from-init: Compare from the first checkpoint to the selected checkpoint.
	 * checkpoint: Compare the selected checkpoint to the next checkpoint.
	 * to-current: Compare the selected checkpoint to the current workspace.
	 * full: Compare from the first checkpoint to the current workspace.
	 */
	mode: "from-init" | "checkpoint" | "to-current" | "full"
}

export async function checkpointDiff(
	task: Task,
	{ ts: _ts, previousCommitHash: _previousCommitHash, commitHash, mode }: CheckpointDiffOptions,
) {
	const service = await getCheckpointService(task)

	if (!service) {
		return
	}

	TelemetryService.instance.captureCheckpointDiffed(task.taskId)

	let fromHash: string | undefined
	let toHash: string | undefined
	let title: string

	const checkpoints = task.clineMessages.filter(({ say }) => say === "checkpoint_saved").map(({ text }) => text!)

	if (["from-init", "full"].includes(mode) && checkpoints.length < 1) {
		vscode.window.showInformationMessage(t("common:errors.checkpoint_no_first"))
		return
	}

	const idx = checkpoints.indexOf(commitHash)
	switch (mode) {
		case "checkpoint":
			fromHash = commitHash
			toHash = idx !== -1 && idx < checkpoints.length - 1 ? checkpoints[idx + 1] : undefined
			title = t("common:errors.checkpoint_diff_with_next")
			break
		case "from-init":
			fromHash = checkpoints[0]
			toHash = commitHash
			title = t("common:errors.checkpoint_diff_since_first")
			break
		case "to-current":
			fromHash = commitHash
			toHash = undefined
			title = t("common:errors.checkpoint_diff_to_current")
			break
		case "full":
			fromHash = checkpoints[0]
			toHash = undefined
			title = t("common:errors.checkpoint_diff_since_first")
			break
	}

	if (!fromHash) {
		vscode.window.showInformationMessage(t("common:errors.checkpoint_no_previous"))
		return
	}

	try {
		const changes = await service.getDiff({ from: fromHash, to: toHash })

		if (!changes?.length) {
			vscode.window.showInformationMessage(t("common:errors.checkpoint_no_changes"))
			return
		}

		await vscode.commands.executeCommand(
			"vscode.changes",
			title,
			changes.map((change) => [
				vscode.Uri.file(change.paths.absolute),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
					query: Buffer.from(change.content.before ?? "").toString("base64"),
				}),
				vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${change.paths.relative}`).with({
					query: Buffer.from(change.content.after ?? "").toString("base64"),
				}),
			]),
		)
	} catch (error) {
		const provider = task.providerRef.deref()
		provider?.log(`[checkpointDiff] disabling checkpoints for this task: ${getErrorMessage(error)}`)
		TelemetryService.reportError(error, TelemetryEventName.CHECKPOINT_ERROR)
		task.enableCheckpoints = false
	}
}
