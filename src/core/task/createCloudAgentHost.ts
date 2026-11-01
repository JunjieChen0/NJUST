/**
 * Factory for building an ICloudAgentHost from a Task instance.
 * Extracted from Task.initiateCloudAgentLoop to reduce file size.
 */
import { EventEmitter } from "events"
import type { ICloudAgentHost } from "./interfaces/ICloudAgentHost"
import type { ITaskHost } from "./interfaces/ITaskHost"
import { NJUST_AIEventName, type TokenUsage, type ToolUsage } from "@njust-ai/types"
import { TelemetryService } from "@njust-ai/telemetry"
import { t } from "../../i18n"

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
	): Promise<void>
	ask: ICloudAgentHost["ask"]
	hostRef: { deref(): ITaskHost | undefined }
	readonly parentTaskId?: string
	toolUsage: ToolUsage
	getTokenUsage(): TokenUsage
	emitFinalTokenUsageUpdate(): void
	markTaskCompleted(): void
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
		say: (type, text?, imgs?) => task.say(type, text, imgs),
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
