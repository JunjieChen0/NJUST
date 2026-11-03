/**
 * Factory for building an ICloudAgentHost from a Task instance.
 * Extracted from Task.initiateCloudAgentLoop to reduce file size.
 */
import { EventEmitter } from "events"
import type { ICloudAgentHost } from "./interfaces/ICloudAgentHost"
import type { ITaskHost } from "./interfaces/ITaskHost"
import { NJUST_AIEventName, type TokenUsage, type ToolUsage, type VerificationSummary } from "@njust-ai/types"
import { TelemetryService } from "@njust-ai/telemetry"
import { t } from "../../i18n"
import type { CangjieTaskVerification } from "../verification/CangjieTaskVerification"

/** Minimal shape of Task needed to build a cloud agent host. */
interface CloudAgentTaskRef {
	readonly taskId: string
	readonly instanceId: string
	readonly cwd: string
	abort: boolean
	rooIgnoreController?: ICloudAgentHost["rooIgnoreController"]
	rooProtectedController?: ICloudAgentHost["rooProtectedController"]
	currentRequestAbortController?: AbortController
	say(
		type: ICloudAgentHost["say"] extends (...args: infer A) => unknown ? A[0] : never,
		text?: string,
		images?: string[],
		partial?: boolean,
		checkpoint?: Record<string, unknown>,
		progressStatus?: import("@njust-ai/types").ToolProgressStatus,
		options?: { verification?: VerificationSummary },
	): Promise<void>
	cangjieVerification?: CangjieTaskVerification
	cangjieRuntimePolicy?: { noteDelegatedWrites(paths: string[]): void }
	permissionRuleEngine?: { getMode(): string }
	ask: ICloudAgentHost["ask"]
	hostRef: { deref(): ITaskHost | undefined }
	readonly parentTaskId?: string
	toolUsage: ToolUsage
	getTokenUsage(): TokenUsage
	emitFinalTokenUsageUpdate(): void
	markTaskCompleted(): void
	markCloudRunStarted?(): void
}

export function createCloudAgentHost(task: CloudAgentTaskRef & EventEmitter): ICloudAgentHost {
	const host: ICloudAgentHost = {
		taskId: task.taskId,
		instanceId: task.instanceId,
		cwd: task.cwd,
		get abort() {
			return task.abort
		},
		rooIgnoreController: task.rooIgnoreController,
		rooProtectedController: task.rooProtectedController,
		say: (type, text?, imgs?, verification?) =>
			verification
				? task.say(type, text, imgs, undefined, undefined, undefined, { verification })
				: task.say(type, text, imgs),
		verifyLocally: async (writtenPaths) => {
			if (!task.cangjieVerification) return undefined
			task.cangjieRuntimePolicy?.noteDelegatedWrites(writtenPaths)
			const outcome = await task.cangjieVerification.verifyForCompletion(async (command) => {
				if (task.permissionRuleEngine?.getMode() === "bypass") return true
				return (await task.ask("command", command)).response === "yesButtonClicked"
			})
			return outcome.action === "allow" ? outcome.summary : task.cangjieVerification.currentSummary()
		},
		ask: (type, text?, partial?) => task.ask(type, text, partial),
		emit: (event, ...args) => EventEmitter.prototype.emit.call(task, event, ...args) as boolean,
		setCurrentRequestAbortController: (ctrl) => {
			task.currentRequestAbortController = ctrl
		},
		markCompleted: () => {
			// Same sequence as AttemptCompletionTool.emitTaskCompleted.
			task.emitFinalTokenUsageUpdate()
			TelemetryService.instance.captureTaskCompleted(task.taskId)
			EventEmitter.prototype.emit.call(
				task,
				NJUST_AIEventName.TaskCompleted,
				task.taskId,
				task.getTokenUsage(),
				task.toolUsage,
				{ isSubtask: !!task.parentTaskId },
			)
			task.markTaskCompleted()
		},
		beginRun: () => task.markCloudRunStarted?.(),
		compileLocal: async (cwd) => {
			const provider = task.hostRef.deref()
			if (!provider?.compileLocal) {
				throw new Error(t("common:errors.cangjieCompileGuard.notConfigured"))
			}
			return provider.compileLocal(cwd)
		},
	}
	return host
}
