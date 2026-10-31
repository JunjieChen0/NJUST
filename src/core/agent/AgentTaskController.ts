import type { ClineMessage } from "@njust-ai/types"

export interface AgentTaskLike {
	taskId: string
	clineMessages?: ClineMessage[]
	didFinishAbortingStream?: boolean
	abandoned?: boolean
	abortTask?: () => Promise<void>
}

export interface AgentTaskController {
	handleModeSwitch(mode: string): Promise<void>
	createTask(message: string): Promise<AgentTaskLike>
}

export interface AgentLogSink {
	appendLine(message: string): void
}
