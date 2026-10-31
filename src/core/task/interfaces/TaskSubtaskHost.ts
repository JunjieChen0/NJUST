/**
 * TaskSubtaskHost — Interface for TaskSubtaskHandler dependency injection.
 *
 * Defines the minimal surface TaskSubtaskHandler needs from its owning Task.
 * Extracted from Task.ts as part of Phase 1 decomposition.
 */
import type { Anthropic } from "@anthropic-ai/sdk"
import type { ClineMessage, TodoItem } from "@njust-ai/types"
import type { ApiHandler } from "../../../api"
import type { ApiMessage } from "../../task-persistence"
import type { FileContextTracker } from "../../context-tracking/FileContextTracker"
import type { RooIgnoreController } from "../../ignore/RooIgnoreController"
import type { IsolationLevel } from "../SubTaskOptions"
import type { ForkedContextConfig, CacheSafeParams } from "../SubTaskOptions"
import type { ITaskHost } from "./ITaskHost"

export interface TaskSubtaskHost {
	// Identity
	readonly taskId: string
	readonly cwd: string

	// State used when building environment details
	providerRef: WeakRef<ITaskHost>
	rooIgnoreController?: RooIgnoreController
	didEditFile: boolean
	fileContextTracker: FileContextTracker
	clineMessages: ClineMessage[]
	api: ApiHandler
	todoList?: TodoItem[]

	// Mutable state for resumeAfterDelegation
	idleAsk?: ClineMessage
	resumableAsk?: ClineMessage
	interactiveAsk?: ClineMessage
	abort: boolean
	abandoned: boolean
	abortReason?: string
	didFinishAbortingStream: boolean
	isStreaming: boolean
	isWaitingForFirstChunk: boolean
	isPaused: boolean
	skipPrevResponseIdOnce: boolean
	isInitialized: boolean

	// API conversation history
	apiConversationHistory: ApiMessage[]

	// Provider reference
	hostRef: { deref(): ITaskHost | undefined }

	// Task methods
	getSavedApiConversationHistory(): Promise<ApiMessage[]>
	saveApiConversationHistory(): Promise<boolean>
	initiateTaskLoop(userMessage: Anthropic.Messages.ContentBlockParam[]): Promise<void>

	// Event emitter
	emit(event: string, ...args: unknown[]): boolean
}

export type { IsolationLevel, ForkedContextConfig, CacheSafeParams }
