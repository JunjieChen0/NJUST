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
	newSession(): Promise<void>
	startTask(input: StartTaskInput): Promise<void>
	resumeTask(sessionId: string): Promise<void>
	sendMessage(content: string): Promise<void>
	renameSession(sessionId: string, title: string): Promise<void>
	deleteSession(sessionId: string): Promise<void>
	forkSession(sessionId: string): Promise<string>
	approve(requestId: string, always?: boolean): Promise<void>
	reject(requestId: string): Promise<void>
	answer(requestId: string, answer: string): Promise<void>
	cancel(): Promise<void>
	setMode(mode: string): Promise<void>
	setAutoApprovalEnabled(enabled: boolean): Promise<void>
	exportCurrentTask(): Promise<string>
	approvePlan(planId: string): Promise<void>
	executePlan(planId: string): Promise<void>
	pausePlan(planId: string): Promise<void>
	cancelPlan(planId: string): Promise<void>
	skipPlanStep(planId: string, stepId: string): Promise<void>
	regeneratePlanStep(planId: string, stepId: string): Promise<void>
	editPlanStep(planId: string, stepId: string, description: string): Promise<void>
	undo(): Promise<void>
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

export interface TuiPlan {
	id: string
	title: string
	description: string
	status: "draft" | "approved" | "executing" | "paused" | "completed" | "failed" | "cancelled"
	steps: TuiPlanStep[]
	totalSteps: number
	completedSteps: number
	createdAt: number
	updatedAt: number
}

export interface TuiPlanStep {
	id: string
	index: number
	description: string
	mode: string
	dependencies: string[]
	status: "pending" | "ready" | "running" | "completed" | "failed" | "skipped" | "cancelled"
	result?: string
	error?: string
	startedAt?: number
	completedAt?: number
	taskId?: string
	/** Optional nested sub-plan for hierarchical plans */
	subPlan?: TuiPlan | null
}

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
	| PlanUpdatedEvent

export interface PlanUpdatedEvent extends BaseEvent {
	type: "plan.updated"
	plan: TuiPlan | null
}

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
	/** Optional tool metadata for richer approval cards */
	toolName?: string
	path?: string
	command?: string
	serverName?: string
}

export interface ApprovalResolvedEvent extends BaseEvent {
	type: "approval.resolved"
	requestId: string
	approved: boolean
	always?: boolean
}

export type ApprovalEvent = ApprovalRequestedEvent | ApprovalResolvedEvent

export interface QuestionRequestedEvent extends BaseEvent {
	type: "question.requested"
	requestId: string
	messageId: string
	question: string
	/** Optional question options for single-select answers */
	options?: string[]
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
	role: "user" | "assistant" | "system" | "tool" | "reasoning"
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
	| { type: "session/refresh" }
	| { type: "message/create"; payload: TuiMessage }
	| { type: "part/create"; payload: TuiPart }
	| { type: "part/update"; payload: { id: string; delta?: string; content?: string; status?: TuiPart["status"] } }
	| { type: "part/complete"; payload: { id: string; content: string } }
	| { type: "part/fail"; payload: { id: string; error: string } }
	| {
			type: "approval/request"
			payload: {
				requestId: string
				messageId: string
				toolName?: string
				path?: string
				command?: string
				serverName?: string
			}
	  }
	| { type: "approval/resolve"; payload: { requestId: string; approved: boolean; always?: boolean } }
	| {
			type: "question/request"
			payload: { requestId: string; messageId: string; question: string; options?: string[] }
	  }
	| { type: "question/resolve"; payload: { requestId: string; answer: string } }
	| { type: "task/complete"; payload: { success: boolean; message?: string } }
	| { type: "task/cancel"; payload: { reason: "user" | "error" | "system" } }
	| { type: "task/fail"; payload: { error: string } }
	| { type: "plan/set"; payload: { plan: TuiPlan | null } }
	| {
			type: "plan/updateStep"
			payload: {
				stepId: string
				status: TuiPlanStep["status"]
				result?: string
				error?: string
				startedAt?: number
				completedAt?: number
			}
	  }

// =============================================================================
// UI Events (Bun subprocess -> Node main process)
// =============================================================================

export type TuiUiEvent =
	| { type: "ui.newSession" }
	| { type: "ui.startTask"; text: string }
	| { type: "ui.resumeSession"; sessionId: string }
	| { type: "ui.sendMessage"; text: string }
	| { type: "ui.approve"; requestId: string; always?: boolean }
	| { type: "ui.reject"; requestId: string }
	| { type: "ui.answer"; requestId: string; answer: string }
	| { type: "ui.cancel" }
	| { type: "ui.exit" }
	| { type: "ui.setTheme"; theme: "light" | "dark" }
	| { type: "ui.setMode"; mode: string }
	| { type: "ui.setModel"; model: string }
	| { type: "ui.renameSession"; sessionId: string; title: string }
	| { type: "ui.deleteSession"; sessionId: string }
	| { type: "ui.forkSession"; sessionId: string }
	| { type: "ui.undo" }
	| { type: "ui.setAutoApproval"; enabled: boolean }
	| { type: "ui.export" }
	| { type: "ui.approvePlan"; planId: string }
	| { type: "ui.executePlan"; planId: string }
	| { type: "ui.pausePlan"; planId: string }
	| { type: "ui.cancelPlan"; planId: string }
	| { type: "ui.skipPlanStep"; planId: string; stepId: string }
	| { type: "ui.regeneratePlanStep"; planId: string; stepId: string }
	| { type: "ui.editPlanStep"; planId: string; stepId: string; description: string }
