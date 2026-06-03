/**
 * Factory for building an ICloudAgentHost from a Task instance.
 * Extracted from Task.initiateCloudAgentLoop to reduce file size.
 */
import { EventEmitter } from "events"
import type { ICloudAgentHost } from "./interfaces/ICloudAgentHost"

/** Minimal shape of Task needed to build a cloud agent host. */
interface CloudAgentTaskRef {
	readonly taskId: string
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
	hostRef: { deref(): UnsafeAny }
}

export function createCloudAgentHost(task: CloudAgentTaskRef & EventEmitter): ICloudAgentHost {
	const host: ICloudAgentHost = {
		taskId: task.taskId,
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
		compileLocal: async (cwd) => {
			const provider = task.hostRef.deref()
			if (!provider?.compileLocal) {
				throw new Error("本地编译功能未配置，请确认 Cangjie SDK 已安装。")
			}
			return provider.compileLocal(cwd)
		},
	}
	return host
}
