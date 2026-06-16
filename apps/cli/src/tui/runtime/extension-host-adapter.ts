import { EventEmitter } from "events"

import type { ExtensionHost } from "@/agent/extension-host.js"
import type {
	TuiRuntime,
	StartTaskInput,
	TuiRuntimeEvent,
	TuiSession,
	TuiMessage,
	TuiPart,
	TuiAction,
} from "./types.ts"
import { TUI_RUNTIME_ADAPTER_VERSION } from "./types.ts"

import type { ClineMessage, ClineSay, ExtensionMessage, WebviewMessage } from "@njust-ai/types"

// =============================================================================
// TuiRuntimeAdapter
// =============================================================================

export interface TuiRuntimeAdapterOptions {
	extensionHost: ExtensionHost
}

/**
 * TuiRuntimeAdapter bridges ExtensionHost events to structured TUI events.
 *
 * Adapter Version: TuiRuntimeAdapterV1
 *
 * This adapter:
 * 1. Subscribes to ExtensionHost raw message stream (not ClientEventMap)
 * 2. Maps ClineMessage events to TuiRuntimeEvent structured events
 * 3. Maintains session state, message grouping, and part tracking
 * 4. Provides TuiRuntime interface for TUI consumption
 */
export class TuiRuntimeAdapter extends EventEmitter implements TuiRuntime {
	public readonly version = TUI_RUNTIME_ADAPTER_VERSION

	private extensionHost: ExtensionHost
	private sessionId: string | null = null
	private messageGroupId: string | null = null
	private partCounter = 0
	private seenMessageIds = new Set<string>()
	private pendingApprovals = new Map<string, string>() // requestId -> messageId
	private pendingQuestions = new Map<string, string>() // requestId -> messageId

	constructor(options: TuiRuntimeAdapterOptions) {
		super()
		this.extensionHost = options.extensionHost
	}

	// ==========================================================================
	// TuiRuntime Interface
	// ==========================================================================

	async activate(): Promise<void> {
		await this.extensionHost.activate()
		this.setupEventHandlers()
	}

	async dispose(): Promise<void> {
		this.removeAllListeners()
		await this.extensionHost.dispose()
	}

	async startTask(input: StartTaskInput): Promise<void> {
		this.sessionId = input.sessionId || this.generateSessionId()
		this.emitEvent({
			type: "session.created",
			timestamp: Date.now(),
			sessionId: this.sessionId,
			workspacePath: process.cwd(),
		})

		await this.extensionHost.runTask(input.prompt, input.sessionId, input.configuration, input.images)
	}

	async resumeTask(sessionId: string): Promise<void> {
		this.sessionId = sessionId
		this.emitEvent({
			type: "session.resumed",
			timestamp: Date.now(),
			sessionId,
		})
		await this.extensionHost.resumeTask(sessionId)
	}

	async sendMessage(content: string): Promise<void> {
		this.extensionHost.sendToExtension({
			type: "askResponse",
			text: content,
		})
	}

	async approve(requestId: string): Promise<void> {
		const messageId = this.pendingApprovals.get(requestId)
		if (!messageId) {
			throw new Error(`Unknown approval request: ${requestId}`)
		}

		this.extensionHost.sendToExtension({
			type: "askResponse",
			ask: "tool" as const,
			yesButtonClicked: true,
		} as WebviewMessage)

		this.emitEvent({
			type: "approval.resolved",
			timestamp: Date.now(),
			sessionId: this.sessionId!,
			requestId,
			approved: true,
		})
	}

	async reject(requestId: string): Promise<void> {
		const messageId = this.pendingApprovals.get(requestId)
		if (!messageId) {
			throw new Error(`Unknown approval request: ${requestId}`)
		}

		this.extensionHost.sendToExtension({
			type: "askResponse",
			ask: "tool" as const,
			yesButtonClicked: false,
		} as WebviewMessage)

		this.emitEvent({
			type: "approval.resolved",
			timestamp: Date.now(),
			sessionId: this.sessionId!,
			requestId,
			approved: false,
		})
	}

	async answer(requestId: string, answer: string): Promise<void> {
		const messageId = this.pendingQuestions.get(requestId)
		if (!messageId) {
			throw new Error(`Unknown question request: ${requestId}`)
		}

		this.extensionHost.sendToExtension({
			type: "askResponse",
			ask: "followup" as const,
			text: answer,
		} as WebviewMessage)

		this.emitEvent({
			type: "question.resolved",
			timestamp: Date.now(),
			sessionId: this.sessionId!,
			requestId,
			answer,
		})
	}

	async cancel(): Promise<void> {
		this.extensionHost.sendToExtension({
			type: "cancelTask",
		})
	}

	subscribe(listener: (event: TuiRuntimeEvent) => void): () => void {
		this.on("event", listener)
		return () => this.off("event", listener)
	}

	// ==========================================================================
	// Event Handling
	// ==========================================================================

	private setupEventHandlers(): void {
		const host = this.extensionHost

		// Subscribe to raw message stream (not ClientEventMap)
		host.on("extensionWebviewMessage", (message: ExtensionMessage) => {
			if (message.type === "state" && message.state?.clineMessages) {
				for (const clineMsg of message.state.clineMessages) {
					this.handleClineMessage(clineMsg)
				}
			}
		})

		// Also subscribe to ClientEventMap for structured events
		const client = host.client
		client.on("message", (msg: ClineMessage) => this.handleClineMessage(msg))
		client.on("messageUpdated", (msg: ClineMessage) => this.handleClineMessage(msg))
		client.on("textStarted", (data: { messageId: string; ts: number }) => {
			this.emitEvent({
				type: "text.started",
				timestamp: data.ts,
				sessionId: this.sessionId!,
				messageId: data.messageId,
				partId: this.generatePartId(),
			})
		})
		client.on("textCompleted", (data: { messageId: string; ts: number; text?: string }) => {
			this.emitEvent({
				type: "text.completed",
				timestamp: data.ts,
				sessionId: this.sessionId!,
				messageId: data.messageId,
				partId: this.getPartIdForMessage(data.messageId),
				text: data.text,
			})
		})
		client.on("reasoningStarted", (data: { messageId: string; ts: number }) => {
			this.emitEvent({
				type: "reasoning.started",
				timestamp: data.ts,
				sessionId: this.sessionId!,
				messageId: data.messageId,
				partId: this.generatePartId(),
			})
		})
		client.on("reasoningCompleted", (data: { messageId: string; ts: number; text?: string }) => {
			this.emitEvent({
				type: "reasoning.completed",
				timestamp: data.ts,
				sessionId: this.sessionId!,
				messageId: data.messageId,
				partId: this.getPartIdForMessage(data.messageId),
				text: data.text,
			})
		})
		client.on("toolStarted", (data: { messageId: string; ts: number }) => {
			this.emitEvent({
				type: "tool.started",
				timestamp: data.ts,
				sessionId: this.sessionId!,
				messageId: data.messageId,
				partId: this.generatePartId(),
				toolName: "unknown",
				params: {},
			})
		})
		client.on("toolCompleted", (data: { messageId: string; ts: number }) => {
			this.emitEvent({
				type: "tool.completed",
				timestamp: data.ts,
				sessionId: this.sessionId!,
				messageId: data.messageId,
				partId: this.getPartIdForMessage(data.messageId),
				result: {},
			})
		})
		client.on("toolFailed", (data: { messageId: string; ts: number; error?: string }) => {
			this.emitEvent({
				type: "tool.failed",
				timestamp: data.ts,
				sessionId: this.sessionId!,
				messageId: data.messageId,
				partId: this.getPartIdForMessage(data.messageId),
				error: data.error || "Unknown error",
			})
		})
		client.on("approvalRequested", (data: { messageId: string; ts: number }) => {
			const requestId = this.generateRequestId()
			this.pendingApprovals.set(requestId, data.messageId)
			this.emitEvent({
				type: "approval.requested",
				timestamp: data.ts,
				sessionId: this.sessionId!,
				requestId,
				messageId: data.messageId,
				ask: "tool",
			})
		})
		client.on("questionRequested", (data: { messageId: string; ts: number }) => {
			const requestId = this.generateRequestId()
			this.pendingQuestions.set(requestId, data.messageId)
			this.emitEvent({
				type: "question.requested",
				timestamp: data.ts,
				sessionId: this.sessionId!,
				requestId,
				messageId: data.messageId,
				question: "",
			})
		})
		client.on("taskCompleted", (event: import("@/agent/events.js").TaskCompletedEvent) => {
			this.emitEvent({
				type: "task.completed",
				timestamp: event.stateInfo?.lastMessageTs || Date.now(),
				sessionId: this.sessionId!,
				success: event.success,
				message: event.message?.text,
			})
		})
	}

	private handleClineMessage(msg: ClineMessage): void {
		if (this.seenMessageIds.has(msg.id)) {
			// Message already seen - check for delta
			if (msg.delta) {
				this.emitEvent({
					type: msg.deltaType === "reasoning" ? "reasoning.delta" : "text.delta",
					timestamp: msg.ts,
					sessionId: this.sessionId!,
					messageId: msg.id,
					partId: this.getPartIdForMessage(msg.id),
					delta: msg.delta,
				})
			}
			return
		}

		this.seenMessageIds.add(msg.id)

		if (msg.type === "say" && msg.say) {
			const say = msg.say as ClineSay | "user"
			switch (say) {
				case "text":
					this.emitEvent({
						type: "message.created",
						timestamp: msg.ts,
						sessionId: this.sessionId!,
						messageId: msg.id,
						role: "assistant",
						content: msg.text,
					})
					break
				case "user":
					// User messages are broadcast as ClineMessage but not part of SayType union
					this.emitEvent({
						type: "message.created",
						timestamp: msg.ts,
						sessionId: this.sessionId!,
						messageId: msg.id,
						role: "user",
						content: msg.text,
					})
					break
				case "error":
					this.emitEvent({
						type: "task.failed",
						timestamp: msg.ts,
						sessionId: this.sessionId!,
						error: msg.text || "Unknown error",
					})
					break
			}
		}
	}

	// ==========================================================================
	// Helpers
	// ==========================================================================

	private emitEvent(event: TuiRuntimeEvent): void {
		this.emit("event", event)
	}

	private generateSessionId(): string {
		return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
	}

	private generatePartId(): string {
		return `part_${this.sessionId}_${++this.partCounter}`
	}

	private getPartIdForMessage(messageId: string): string {
		// In a real implementation, we'd track partId -> messageId mapping
		return `part_${messageId}_0`
	}

	private generateRequestId(): string {
		return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
	}
}

// =============================================================================
// Reducer
// =============================================================================

export interface TuiState {
	sessions: Map<string, TuiSession>
	messages: Map<string, TuiMessage>
	parts: Map<string, TuiPart>
	currentSessionId: string | null
}

export const initialTuiState: TuiState = {
	sessions: new Map(),
	messages: new Map(),
	parts: new Map(),
	currentSessionId: null,
}

export function tuiReducer(state: TuiState, action: TuiAction): TuiState {
	switch (action.type) {
		case "session/create": {
			const session: TuiSession = {
				id: action.payload.id,
				status: "starting",
				workspacePath: action.payload.workspacePath,
				createdAt: Date.now(),
				updatedAt: Date.now(),
				messages: [],
			}
			return {
				...state,
				sessions: new Map(state.sessions).set(action.payload.id, session),
				currentSessionId: action.payload.id,
			}
		}

		case "session/update": {
			const sessions = new Map(state.sessions)
			const session = sessions.get(action.payload.id)
			if (session) {
				sessions.set(action.payload.id, {
					...session,
					status: action.payload.status,
					title: action.payload.title || session.title,
					updatedAt: Date.now(),
				})
			}
			return { ...state, sessions }
		}

		case "message/create": {
			const messages = new Map(state.messages)
			messages.set(action.payload.id, action.payload)

			const sessions = new Map(state.sessions)
			const session = sessions.get(action.payload.sessionId)
			if (session) {
				sessions.set(action.payload.sessionId, {
					...session,
					messages: [...session.messages, action.payload],
					updatedAt: Date.now(),
				})
			}
			return { ...state, messages, sessions }
		}

		case "part/create": {
			const parts = new Map(state.parts)
			parts.set(action.payload.id, action.payload)
			return { ...state, parts }
		}

		case "part/update": {
			const parts = new Map(state.parts)
			const part = parts.get(action.payload.id)
			if (part) {
				parts.set(action.payload.id, {
					...part,
					...(action.payload.delta !== undefined && { delta: action.payload.delta }),
					...(action.payload.content !== undefined && { content: action.payload.content }),
					...(action.payload.status !== undefined && { status: action.payload.status }),
				})
			}
			return { ...state, parts }
		}

		case "part/complete": {
			const parts = new Map(state.parts)
			const part = parts.get(action.payload.id)
			if (part) {
				parts.set(action.payload.id, {
					...part,
					content: action.payload.content,
					status: "completed",
				})
			}
			return { ...state, parts }
		}

		case "part/fail": {
			const parts = new Map(state.parts)
			const part = parts.get(action.payload.id)
			if (part) {
				parts.set(action.payload.id, {
					...part,
					status: "failed",
					toolError: action.payload.error,
				})
			}
			return { ...state, parts }
		}

		case "task/complete": {
			if (!state.currentSessionId) return state
			const sessions = new Map(state.sessions)
			const session = sessions.get(state.currentSessionId)
			if (session) {
				sessions.set(state.currentSessionId, {
					...session,
					status: action.payload.success ? "completed" : "failed",
					updatedAt: Date.now(),
				})
			}
			return { ...state, sessions }
		}

		case "task/cancel": {
			if (!state.currentSessionId) return state
			const sessions = new Map(state.sessions)
			const session = sessions.get(state.currentSessionId)
			if (session) {
				sessions.set(state.currentSessionId, {
					...session,
					status: "cancelled",
					updatedAt: Date.now(),
				})
			}
			return { ...state, sessions }
		}

		case "task/fail": {
			if (!state.currentSessionId) return state
			const sessions = new Map(state.sessions)
			const session = sessions.get(state.currentSessionId)
			if (session) {
				sessions.set(state.currentSessionId, {
					...session,
					status: "failed",
					updatedAt: Date.now(),
				})
			}
			return { ...state, sessions }
		}

		default:
			return state
	}
}
