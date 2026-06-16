/**
 * TuiRuntime Types
 *
 * Core types for the TUI runtime layer. These types define the contract
 * between the TUI (OpenTUI or Ink) and the ExtensionHost.
 *
 * Adapter Version: TuiRuntimeAdapterV1
 */

// =============================================================================
// Adapter Version
// =============================================================================

export const TUI_RUNTIME_ADAPTER_VERSION = "TuiRuntimeAdapterV1" as const

// =============================================================================
// Core Interfaces
// =============================================================================

export interface TuiRuntime {
	activate(): Promise<void>
	dispose(): Promise<void>
	startTask(input: StartTaskInput): Promise<void>
	resumeTask(sessionId: string): Promise<void>
	sendMessage(content: string): Promise<void>
	approve(requestId: string): Promise<void>
	reject(requestId: string): Promise<void>
	answer(requestId: string, answer: string): Promise<void>
	cancel(): Promise<void>
	subscribe(listener: (event: TuiRuntimeEvent) => void): () => void
}

export interface StartTaskInput {
	prompt: string
	sessionId?: string
	configuration?: Record<string, unknown>
	images?: string[]
}

// =============================================================================
// Events
// =============================================================================

export type TuiRuntimeEvent =
	| SessionEvent
	| MessageEvent
	| TextEvent
	| ReasoningEvent
	| ToolEvent
	| ApprovalEvent
	| QuestionEvent
	| TaskEvent
	| StateSnapshotEvent
	| ProviderChangedEvent
	| ModelChangedEvent
	| ModeChangedEvent
	| TodosUpdatedEvent
	| UsageUpdatedEvent

export interface BaseEvent {
	type: string
	timestamp: number
	sessionId: string
}

export interface SessionCreatedEvent extends BaseEvent {
	type: "session.created"
	sessionId: string
	workspacePath: string
}

export interface SessionUpdatedEvent extends BaseEvent {
	type: "session.updated"
	status: TuiTaskStatus
	title?: string
}

export interface SessionResumedEvent extends BaseEvent {
	type: "session.resumed"
	sessionId: string
}

export type SessionEvent = SessionCreatedEvent | SessionUpdatedEvent | SessionResumedEvent

export interface MessageCreatedEvent extends BaseEvent {
	type: "message.created"
	messageId: string
	role: "user" | "assistant" | "system" | "tool"
	content?: string
}

export type MessageEvent = MessageCreatedEvent

export interface TextStartedEvent extends BaseEvent {
	type: "text.started"
	messageId: string
	partId: string
}

export interface TextDeltaEvent extends BaseEvent {
	type: "text.delta"
	messageId: string
	partId: string
	delta: string
}

export interface TextCompletedEvent extends BaseEvent {
	type: "text.completed"
	messageId: string
	partId: string
	text?: string
}

export type TextEvent = TextStartedEvent | TextDeltaEvent | TextCompletedEvent

export interface ReasoningStartedEvent extends BaseEvent {
	type: "reasoning.started"
	messageId: string
	partId: string
}

export interface ReasoningDeltaEvent extends BaseEvent {
	type: "reasoning.delta"
	messageId: string
	partId: string
	delta: string
}

export interface ReasoningCompletedEvent extends BaseEvent {
	type: "reasoning.completed"
	messageId: string
	partId: string
	text?: string
}

export type ReasoningEvent = ReasoningStartedEvent | ReasoningDeltaEvent | ReasoningCompletedEvent

export interface ToolStartedEvent extends BaseEvent {
	type: "tool.started"
	messageId: string
	partId: string
	toolName: string
	params: unknown
}

export interface ToolProgressEvent extends BaseEvent {
	type: "tool.progress"
	messageId: string
	partId: string
	progress: ToolProgressStatus
}

export interface ToolCompletedEvent extends BaseEvent {
	type: "tool.completed"
	messageId: string
	partId: string
	result: unknown
}

export interface ToolFailedEvent extends BaseEvent {
	type: "tool.failed"
	messageId: string
	partId: string
	error: string
}

export type ToolEvent = ToolStartedEvent | ToolProgressEvent | ToolCompletedEvent | ToolFailedEvent

export interface ApprovalRequestedEvent extends BaseEvent {
	type: "approval.requested"
	requestId: string
	messageId: string
	ask: string
}

export interface ApprovalResolvedEvent extends BaseEvent {
	type: "approval.resolved"
	requestId: string
	approved: boolean
}

export type ApprovalEvent = ApprovalRequestedEvent | ApprovalResolvedEvent

export interface QuestionRequestedEvent extends BaseEvent {
	type: "question.requested"
	requestId: string
	messageId: string
	question: string
}

export interface QuestionResolvedEvent extends BaseEvent {
	type: "question.resolved"
	requestId: string
	answer: string
}

export type QuestionEvent = QuestionRequestedEvent | QuestionResolvedEvent

export interface TaskCompletedEvent extends BaseEvent {
	type: "task.completed"
	success: boolean
	message?: string
}

export interface TaskCancelledEvent extends BaseEvent {
	type: "task.cancelled"
	reason: "user" | "error" | "system"
}

export interface TaskFailedEvent extends BaseEvent {
	type: "task.failed"
	error: string
}

export type TaskEvent = TaskCompletedEvent | TaskCancelledEvent | TaskFailedEvent

export interface StateSnapshotEvent extends BaseEvent {
	type: "state.snapshot"
	data: Record<string, unknown>
}

export interface ProviderChangedEvent extends BaseEvent {
	type: "provider.changed"
	provider: string
}

export interface ModelChangedEvent extends BaseEvent {
	type: "model.changed"
	model: string
}

export interface ModeChangedEvent extends BaseEvent {
	type: "mode.changed"
	mode: string
}

export interface TodosUpdatedEvent extends BaseEvent {
	type: "todos.updated"
	todos: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" }>
}

export interface UsageUpdatedEvent extends BaseEvent {
	type: "usage.updated"
	usage: { total: number; context: number; cost?: number }
}

// =============================================================================
// Status Types
// =============================================================================

export type TuiTaskStatus =
	| "idle"
	| "starting"
	| "running"
	| "waiting_for_input"
	| "streaming"
	| "completed"
	| "cancelled"
	| "failed"

export interface ToolProgressStatus {
	icon?: string
	text?: string
}

// =============================================================================
// State Types
// =============================================================================

export interface TuiSession {
	id: string
	status: TuiTaskStatus
	title?: string
	workspacePath?: string
	createdAt: number
	updatedAt: number
	messages: TuiMessage[]
	provider?: string
	model?: string
	mode?: string
}

export interface TuiMessage {
	id: string
	sessionId: string
	role: "user" | "assistant" | "system" | "tool"
	createdAt: number
	updatedAt: number
	content?: string
	partIds?: string[]
	/** Tool part payload when role is "tool" */
	part?: TuiPart
	/** Raw tool data from ClineMessage tool info */
	toolData?: unknown
}

export interface TuiPart {
	id: string
	messageId: string
	sessionId: string
	type: "text" | "reasoning" | "tool"
	status: "pending" | "streaming" | "completed" | "failed"
	content?: string
	delta?: string
	toolName?: string
	toolParams?: unknown
	toolResult?: unknown
	toolError?: string
	progress?: ToolProgressStatus
}

// =============================================================================
// Action Types (for Reducer)
// =============================================================================

export type TuiAction =
	| { type: "session/create"; payload: { id: string; workspacePath: string } }
	| { type: "session/update"; payload: { id: string; status: TuiTaskStatus; title?: string } }
	| { type: "message/create"; payload: TuiMessage }
	| { type: "part/create"; payload: TuiPart }
	| { type: "part/update"; payload: { id: string; delta?: string; content?: string; status?: TuiPart["status"] } }
	| { type: "part/complete"; payload: { id: string; content: string } }
	| { type: "part/fail"; payload: { id: string; error: string } }
	| { type: "approval/request"; payload: { requestId: string; messageId: string } }
	| { type: "approval/resolve"; payload: { requestId: string; approved: boolean } }
	| { type: "question/request"; payload: { requestId: string; messageId: string; question: string } }
	| { type: "question/resolve"; payload: { requestId: string; answer: string } }
	| { type: "task/complete"; payload: { success: boolean; message?: string } }
	| { type: "task/cancel"; payload: { reason: "user" | "error" | "system" } }
	| { type: "task/fail"; payload: { error: string } }
