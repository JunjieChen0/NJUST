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
	TuiTaskStatus,
} from "./types.ts"
import { TUI_RUNTIME_ADAPTER_VERSION } from "./types.ts"

import type { ClineMessage, ClineSay, ClineAsk, ExtensionMessage, WebviewMessage } from "@njust-ai/types"

// =============================================================================
// TuiRuntimeAdapter
// =============================================================================

export interface TuiRuntimeAdapterOptions {
	extensionHost: ExtensionHost
	recentSessions?: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }>
}

/**
 * TuiRuntimeAdapter bridges ExtensionHost events to structured TUI events.
 *
 * Adapter Version: TuiRuntimeAdapterV1
 *
 * This adapter:
 * 1. Subscribes to ExtensionHost raw message stream and ExtensionClient events
 * 2. Maps ClineMessage events to TuiRuntimeEvent structured events
 * 3. Maintains session state, message grouping, and part tracking
 * 4. Provides TuiRuntime interface for TUI consumption
 */
export class TuiRuntimeAdapter extends EventEmitter implements TuiRuntime {
	public readonly version = TUI_RUNTIME_ADAPTER_VERSION

	private extensionHost: ExtensionHost
	private sessionId: string | null = null
	private partCounter = 0
	private seenMessageIds = new Set<string>()
	private pendingApprovals = new Map<string, string>() // requestId -> messageId
	private pendingQuestions = new Map<string, string>() // requestId -> messageId
	private messagePartIds = new Map<string, string>() // messageId -> current partId
	private state: TuiState

	private pendingToolByMessageId = new Map<string, { toolName: string; params: unknown }>()
	private lastPendingCommand: string | null = null
	private lastPendingToolName: string | null = null
	private recentSessions: Array<{
		id: string
		title: string
		createdAt: number
		updatedAt: number
		messageCount: number
	}>
	private autoApprovalEnabled = false

	constructor(options: TuiRuntimeAdapterOptions) {
		super()
		this.extensionHost = options.extensionHost
		this.state = createInitialTuiState()
		this.recentSessions = options.recentSessions || []
	}

	private activated = false

	// ==========================================================================
	// TuiRuntime Interface
	// ==========================================================================

	async activate(): Promise<void> {
		if (this.activated) {
			return
		}
		this.activated = true

		// The ExtensionHost may already be activated by the caller (e.g. run.ts).
		// Only call activate() if it is still in initial setup; otherwise just
		// wire up event handlers.
		if (this.extensionHost.isInInitialSetup()) {
			await this.extensionHost.activate()
		}
		this.setupEventHandlers()
	}

	async dispose(): Promise<void> {
		this.removeAllListeners()
		await this.extensionHost.dispose()
	}

	async newSession(): Promise<void> {
		this.extensionHost.sendToExtension({ type: "clearTask" })
		this.sessionId = null
		this.seenMessageIds.clear()
		this.pendingApprovals.clear()
		this.pendingQuestions.clear()
		this.messagePartIds.clear()
		this.partCounter = 0
		this.state = createInitialTuiState()
		this.emitEvent({
			type: "state.snapshot",
			timestamp: Date.now(),
			sessionId: "",
			data: this.serializeState(),
		})
	}

	async startTask(input: StartTaskInput): Promise<void> {
		this.sessionId = input.sessionId || this.generateSessionId()
		this.dispatch({
			type: "session/create",
			payload: { id: this.sessionId, workspacePath: process.cwd() },
		})

		await this.extensionHost.runTask(input.prompt, input.sessionId, input.configuration, input.images)
	}

	async resumeTask(sessionId: string): Promise<void> {
		this.sessionId = sessionId
		this.dispatch({
			type: "session/update",
			payload: { id: sessionId, status: "starting" },
		})
		this.emitEvent({
			type: "session.resumed",
			timestamp: Date.now(),
			sessionId,
		})
		await this.extensionHost.resumeTask(sessionId)
	}

	setRecentSessions(
		sessions: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }>,
	): void {
		this.recentSessions = sessions
		this.dispatch({ type: "session/refresh" })
	}

	async sendMessage(content: string): Promise<void> {
		this.extensionHost.sendToExtension({
			type: "askResponse",
			askResponse: "messageResponse",
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
			askResponse: "yesButtonClicked",
		})

		this.pendingApprovals.delete(requestId)
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
			askResponse: "noButtonClicked",
		})

		this.pendingApprovals.delete(requestId)
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
			askResponse: "messageResponse",
			text: answer,
		})

		this.pendingQuestions.delete(requestId)
		this.emitEvent({
			type: "question.resolved",
			timestamp: Date.now(),
			sessionId: this.sessionId!,
			requestId,
			answer,
		})
	}

	async cancel(): Promise<void> {
		this.extensionHost.sendToExtension({ type: "cancelTask" })
	}

	async setMode(mode: string): Promise<void> {
		this.extensionHost.sendToExtension({ type: "mode", text: mode } as WebviewMessage)
	}

	async setAutoApprovalEnabled(enabled: boolean): Promise<void> {
		this.extensionHost.sendToExtension({ type: "autoApprovalEnabled", bool: enabled } as WebviewMessage)
	}

	async undo(): Promise<void> {
		if (!this.sessionId) {
			return
		}
		const session = this.state.sessions.get(this.sessionId)
		if (!session) {
			return
		}
		const lastUser = [...session.messages].reverse().find((m) => m.role === "user")
		if (!lastUser) {
			return
		}
		this.extensionHost.sendToExtension({
			type: "deleteMessageConfirm",
			messageTs: lastUser.createdAt,
		} as WebviewMessage)
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

		// Subscribe to raw message stream for full state snapshots
		host.on("extensionWebviewMessage", (message: ExtensionMessage) => {
			if (message.type === "state" && message.state?.clineMessages) {
				for (const clineMsg of message.state.clineMessages) {
					this.handleClineMessage(clineMsg)
				}
			}
			if (message.type === "state" && typeof message.state?.mode === "string") {
				this.emitEvent({
					type: "mode.changed",
					timestamp: Date.now(),
					sessionId: this.sessionId ?? "",
					mode: message.state.mode,
				})
			}
			if (message.type === "state" && typeof message.state?.autoApprovalEnabled === "boolean") {
				this.autoApprovalEnabled = message.state.autoApprovalEnabled
				this.dispatch({ type: "session/refresh" })
			}
		})

		// Subscribe to ClientEventMap for lifecycle events only.
		// Tool/text/reasoning structured events are derived directly from
		// ClineMessage payloads in handleClineMessage to preserve params/results.
		const client = host.client
		client.on("message", (msg: ClineMessage) => this.handleClineMessage(msg))
		client.on("messageUpdated", (msg: ClineMessage) => this.handleClineMessage(msg))
		client.on("taskCompleted", (event: import("@/agent/events.js").TaskCompletedEvent) => {
			this.dispatch({ type: "task/complete", payload: { success: event.success } })
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
		if (!this.sessionId) {
			return
		}

		if (this.seenMessageIds.has(msg.id)) {
			// Message already seen - check for delta
			if (msg.delta) {
				const partId = this.getPartIdForMessage(msg.id)
				this.dispatch({
					type: "part/update",
					payload: {
						id: partId,
						delta: msg.delta,
						status: "streaming",
					},
				})
				this.emitEvent({
					type: msg.deltaType === "reasoning" ? "reasoning.delta" : "text.delta",
					timestamp: msg.ts,
					sessionId: this.sessionId,
					messageId: msg.id,
					partId,
					delta: msg.delta,
				})
			}
			return
		}

		this.seenMessageIds.add(msg.id)

		const role = this.inferRole(msg)
		const content = msg.text

		this.dispatch({
			type: "message/create",
			payload: {
				id: msg.id,
				sessionId: this.sessionId,
				role,
				createdAt: msg.ts,
				updatedAt: msg.ts,
				content,
			},
		})

		if (msg.type === "ask" && msg.ask) {
			const ask = msg.ask as ClineAsk
			switch (ask) {
				case "tool": {
					const toolInfo = this.parseToolText(msg.text)
					const toolName = ((toolInfo?.tool as string | undefined) || "unknown") as string
					this.pendingToolByMessageId.set(msg.id, { toolName, params: toolInfo || {} })

					const partId = this.assignPartId(msg.id)
					this.createToolPart(msg.id, partId, msg.ts, toolName, toolInfo || {}, undefined, "pending")

					this.emitEvent({
						type: "tool.started",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						messageId: msg.id,
						partId,
						toolName,
						params: toolInfo || {},
					})

					const requestId = this.generateRequestId()
					this.pendingApprovals.set(requestId, msg.id)
					this.emitEvent({
						type: "approval.requested",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						requestId,
						messageId: msg.id,
						ask: "tool",
					})
					break
				}
				case "command": {
					const command = msg.text || ""
					this.lastPendingCommand = command
					this.pendingToolByMessageId.set(msg.id, { toolName: "execute_command", params: { command } })

					const partId = this.assignPartId(msg.id)
					this.createToolPart(msg.id, partId, msg.ts, "execute_command", { command }, undefined, "pending")

					this.emitEvent({
						type: "tool.started",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						messageId: msg.id,
						partId,
						toolName: "execute_command",
						params: { command },
					})

					const requestId = this.generateRequestId()
					this.pendingApprovals.set(requestId, msg.id)
					this.emitEvent({
						type: "approval.requested",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						requestId,
						messageId: msg.id,
						ask: "command",
					})
					break
				}
				case "use_mcp_server": {
					const mcpInfo = this.parseMcpText(msg.text)
					const toolName = mcpInfo ? `${mcpInfo.serverName}/${mcpInfo.toolName || "unknown"}` : "mcp"
					this.lastPendingToolName = toolName
					this.pendingToolByMessageId.set(msg.id, { toolName, params: mcpInfo || {} })

					const partId = this.assignPartId(msg.id)
					this.createToolPart(msg.id, partId, msg.ts, toolName, mcpInfo || {}, undefined, "pending")

					this.emitEvent({
						type: "tool.started",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						messageId: msg.id,
						partId,
						toolName,
						params: mcpInfo || {},
					})

					const requestId = this.generateRequestId()
					this.pendingApprovals.set(requestId, msg.id)
					this.emitEvent({
						type: "approval.requested",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						requestId,
						messageId: msg.id,
						ask: "use_mcp_server",
					})
					break
				}
				case "followup": {
					const question = msg.text || ""
					const requestId = this.generateRequestId()
					this.pendingQuestions.set(requestId, msg.id)
					this.emitEvent({
						type: "question.requested",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						requestId,
						messageId: msg.id,
						question,
					})
					break
				}
				case "completion_result": {
					const resultText = msg.text || ""
					let result: Record<string, unknown> | undefined
					try {
						result = JSON.parse(resultText) as Record<string, unknown>
					} catch {
						result = { result: resultText }
					}
					const partId = this.assignPartId(msg.id)
					this.createToolPart(msg.id, partId, msg.ts, "attempt_completion", {}, result, "completed")
					this.emitEvent({
						type: "tool.completed",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						messageId: msg.id,
						partId,
						result: result || {},
					})
					this.dispatch({ type: "task/complete", payload: { success: true } })
					this.emitEvent({
						type: "task.completed",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						success: true,
						message: typeof result.result === "string" ? result.result : resultText,
					})
					break
				}
			}
		}

		if (msg.type === "say" && msg.say) {
			const say = msg.say as ClineSay | "user"
			switch (say) {
				case "text": {
					const partId = this.assignPartId(msg.id)
					this.createTextPart(msg.id, partId, msg.ts, content, msg.partial ? "streaming" : "completed")
					this.emitEvent({
						type: msg.partial ? "text.started" : "text.completed",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						messageId: msg.id,
						partId,
						text: content,
					})
					break
				}
				case "reasoning": {
					const partId = this.assignPartId(msg.id)
					this.createReasoningPart(msg.id, partId, msg.ts, content, msg.partial ? "streaming" : "completed")
					this.emitEvent({
						type: msg.partial ? "reasoning.started" : "reasoning.completed",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						messageId: msg.id,
						partId,
						text: content,
					})
					break
				}
				case "command_output": {
					const partId = this.assignPartId(msg.id)
					const command = this.lastPendingCommand
					this.lastPendingCommand = null
					const result = { output: content, command }
					this.createToolPart(msg.id, partId, msg.ts, "execute_command", { command }, result, "completed")
					this.emitEvent({
						type: "tool.completed",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						messageId: msg.id,
						partId,
						result,
					})
					break
				}
				case "tool": {
					const toolInfo = this.parseToolText(msg.text)
					const toolName = ((toolInfo?.tool as string | undefined) || "unknown") as string
					const partId = this.assignPartId(msg.id)
					this.createToolPart(msg.id, partId, msg.ts, toolName, toolInfo || {}, toolInfo, "completed")
					this.emitEvent({
						type: "tool.completed",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						messageId: msg.id,
						partId,
						result: toolInfo || {},
					})
					break
				}
				case "error": {
					const partId = this.assignPartId(msg.id)
					this.createToolPart(
						msg.id,
						partId,
						msg.ts,
						"unknown",
						{},
						undefined,
						"failed",
						content || "Unknown error",
					)
					this.emitEvent({
						type: "tool.failed",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						messageId: msg.id,
						partId,
						error: content || "Unknown error",
					})
					break
				}
				case "completion_result": {
					this.dispatch({ type: "task/complete", payload: { success: true } })
					this.emitEvent({
						type: "task.completed",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						success: true,
						message: content,
					})
					break
				}
			}
		}
	}

	private createTextPart(
		messageId: string,
		partId: string,
		ts: number,
		content: string | undefined,
		status: TuiPart["status"],
	): TuiPart {
		const part: TuiPart = {
			id: partId,
			messageId,
			sessionId: this.sessionId!,
			type: "text",
			status,
			content,
		}
		this.dispatch({ type: "part/create", payload: part })
		if (status !== "streaming" && status !== "pending") {
			this.dispatch({ type: "part/complete", payload: { id: partId, content: content || "" } })
		}
		return part
	}

	private createReasoningPart(
		messageId: string,
		partId: string,
		ts: number,
		content: string | undefined,
		status: TuiPart["status"],
	): TuiPart {
		const part: TuiPart = {
			id: partId,
			messageId,
			sessionId: this.sessionId!,
			type: "reasoning",
			status,
			content,
		}
		this.dispatch({ type: "part/create", payload: part })
		if (status !== "streaming" && status !== "pending") {
			this.dispatch({ type: "part/complete", payload: { id: partId, content: content || "" } })
		}
		return part
	}

	private createToolPart(
		messageId: string,
		partId: string,
		ts: number,
		toolName: string,
		toolParams: unknown,
		result: unknown,
		status: TuiPart["status"],
		toolError?: string,
	): TuiPart {
		const part: TuiPart = {
			id: partId,
			messageId,
			sessionId: this.sessionId!,
			type: "tool",
			status,
			content: typeof result === "string" ? result : undefined,
			toolName,
			toolParams,
			toolResult: result,
			toolError,
		}
		this.dispatch({ type: "part/create", payload: part })
		if (status === "completed") {
			this.dispatch({ type: "part/complete", payload: { id: partId, content: "" } })
		} else if (status === "failed" && toolError) {
			this.dispatch({ type: "part/fail", payload: { id: partId, error: toolError } })
		}
		return part
	}

	private parseToolText(text: string | undefined): Record<string, unknown> | null {
		if (!text) return null
		try {
			const parsed = JSON.parse(text) as unknown
			if (typeof parsed === "object" && parsed !== null) {
				return parsed as Record<string, unknown>
			}
		} catch {
			// Not JSON - treat as plain tool output
		}
		return null
	}

	private parseMcpText(
		text: string | undefined,
	): { serverName: string; toolName?: string; arguments?: unknown } | null {
		if (!text) return null
		try {
			const parsed = JSON.parse(text) as Record<string, unknown>
			if (typeof parsed.serverName === "string") {
				return {
					serverName: parsed.serverName,
					toolName: typeof parsed.toolName === "string" ? parsed.toolName : undefined,
					arguments: parsed.arguments,
				}
			}
		} catch {
			// Ignore parse errors
		}
		return null
	}

	private inferRole(msg: ClineMessage): TuiMessage["role"] {
		if (msg.type === "say" && String(msg.say) === "user") {
			return "user"
		}
		if (msg.type === "ask") {
			return "assistant"
		}
		if (msg.type === "say" && (msg.say === "command_output" || msg.say === "tool")) {
			return "tool"
		}
		return "assistant"
	}

	// ==========================================================================
	// Helpers
	// ==========================================================================

	private dispatch(action: TuiAction): void {
		this.state = tuiReducer(this.state, action)
		this.emitEvent({
			type: "state.snapshot",
			timestamp: Date.now(),
			sessionId: this.sessionId ?? "",
			data: this.serializeState(),
		})
	}

	private serializeState(): Record<string, unknown> {
		const currentSession = this.sessionId ? this.state.sessions.get(this.sessionId) : undefined
		return {
			currentSessionId: this.sessionId,
			messages: currentSession ? currentSession.messages : [],
			isRunning: this.isRunning(),
			sessions: Array.from(this.state.sessions.values()).map((s) => ({
				id: s.id,
				title: s.title || s.id,
				createdAt: s.createdAt,
				updatedAt: s.updatedAt,
				messageCount: s.messages.length,
			})),
			recentSessions: this.recentSessions,
			provider: currentSession?.provider || "njust-ai",
			model: currentSession?.model || "default",
			mode: currentSession?.mode || "code",
			workspacePath: currentSession?.workspacePath || process.cwd(),
			todos: [],
			tokenUsage: { total: 0, context: 0 },
			autoApprovalEnabled: this.autoApprovalEnabled,
		}
	}

	private isRunning(): boolean {
		if (!this.sessionId) return false
		const session = this.state.sessions.get(this.sessionId)
		if (!session) return false
		return session.status === "running" || session.status === "starting" || session.status === "streaming"
	}

	private emitEvent(event: TuiRuntimeEvent): void {
		this.emit("event", event)
	}

	private generateSessionId(): string {
		return `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
	}

	private generatePartId(): string {
		return `part_${this.sessionId}_${++this.partCounter}`
	}

	private assignPartId(messageId: string): string {
		const partId = this.generatePartId()
		this.messagePartIds.set(messageId, partId)
		return partId
	}

	private getPartIdForMessage(messageId: string): string {
		return this.messagePartIds.get(messageId) || `part_${messageId}_0`
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

export function createInitialTuiState(): TuiState {
	return {
		sessions: new Map(),
		messages: new Map(),
		parts: new Map(),
		currentSessionId: null,
	}
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

			// Link part to its parent message and set message.part for UI convenience
			const messages = new Map(state.messages)
			const message = messages.get(action.payload.messageId)
			if (message) {
				const updatedMessage = {
					...message,
					partIds: [...(message.partIds || []), action.payload.id],
					part: message.part || action.payload,
				}
				messages.set(action.payload.messageId, updatedMessage)

				const sessions = new Map(state.sessions)
				const session = sessions.get(action.payload.sessionId)
				if (session) {
					const updatedMessages = session.messages.map((m) =>
						m.id === action.payload.messageId ? updatedMessage : m,
					)
					sessions.set(action.payload.sessionId, {
						...session,
						messages: updatedMessages,
						updatedAt: Date.now(),
					})
				}
				return { ...state, parts, messages, sessions }
			}

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

		case "session/refresh": {
			return { ...state }
		}

		default:
			return state
	}
}
