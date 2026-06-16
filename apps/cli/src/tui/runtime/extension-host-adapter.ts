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

import type { ClineMessage, ClineSay, ClineAsk, ExtensionMessage, WebviewMessage } from "@njust-ai/types"
import { logger } from "@njust-ai/core/shared"
import { readWorkspaceTaskSessions, getDefaultCliTaskStoragePath } from "@/lib/task-history/index.js"
import { exportSessionToMarkdown } from "../lib/export-markdown.js"
import fs from "fs"
import path from "path"

// =============================================================================
// TuiRuntimeAdapter
// =============================================================================

export interface TuiRuntimeAdapterOptions {
	extensionHost: ExtensionHost
	recentSessions?: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }>
	storagePath?: string
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

	private storagePath: string

	constructor(options: TuiRuntimeAdapterOptions) {
		super()
		this.extensionHost = options.extensionHost
		this.state = createInitialTuiState()
		this.recentSessions = options.recentSessions || []
		this.storagePath = options.storagePath || getDefaultCliTaskStoragePath()
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
		void this.refreshRecentSessions()
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
		void this.refreshRecentSessions()
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

	async approve(requestId: string, always?: boolean): Promise<void> {
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
			always,
		})

		if (always) {
			this.autoApprovalEnabled = true
			this.extensionHost.sendToExtension({
				type: "autoApprovalEnabled",
				bool: true,
			} as WebviewMessage)
		}
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

	async exportCurrentTask(): Promise<string> {
		if (!this.sessionId) {
			throw new Error("No active session to export")
		}
		const session = this.state.sessions.get(this.sessionId)
		if (!session) {
			throw new Error("Session not found")
		}
		return exportSessionToMarkdown({
			sessionId: this.sessionId,
			title: session.title || this.sessionId,
			provider: session.provider || "njust-ai",
			model: session.model || "default",
			mode: session.mode || "code",
			workspacePath: session.workspacePath || process.cwd(),
			messages: session.messages,
			parts: this.state.parts,
			tokenUsage: { total: 0, context: 0 },
		})
	}

	async approvePlan(planId: string): Promise<void> {
		this.extensionHost.sendToExtension({
			type: "planAction",
			planId,
			action: "approve",
		} as WebviewMessage)
	}

	async executePlan(planId: string): Promise<void> {
		this.extensionHost.sendToExtension({
			type: "planAction",
			planId,
			action: "execute",
		} as WebviewMessage)
	}

	async pausePlan(planId: string): Promise<void> {
		this.extensionHost.sendToExtension({
			type: "planAction",
			planId,
			action: "pause",
		} as WebviewMessage)
	}

	async cancelPlan(planId: string): Promise<void> {
		this.extensionHost.sendToExtension({
			type: "planAction",
			planId,
			action: "cancel",
		} as WebviewMessage)
	}

	async skipPlanStep(planId: string, stepId: string): Promise<void> {
		this.extensionHost.sendToExtension({
			type: "planAction",
			planId,
			action: "updateStep",
			stepId,
			status: "skipped",
		} as WebviewMessage)
	}

	async regeneratePlanStep(planId: string, stepId: string): Promise<void> {
		this.extensionHost.sendToExtension({
			type: "planAction",
			planId,
			action: "updateStep",
			stepId,
			status: "ready",
		} as WebviewMessage)
	}

	async editPlanStep(planId: string, stepId: string, description: string): Promise<void> {
		this.extensionHost.sendToExtension({
			type: "planAction",
			planId,
			action: "updateStep",
			stepId,
			description,
		} as WebviewMessage)
	}

	async renameSession(sessionId: string, title: string): Promise<void> {
		try {
			const indexPath = path.join(this.storagePath, "tasks", "_index.json")
			if (fs.existsSync(indexPath)) {
				const raw = fs.readFileSync(indexPath, "utf-8")
				const parsed = JSON.parse(raw) as { entries?: Array<{ id: string; task: string }> }
				if (Array.isArray(parsed.entries)) {
					const entry = parsed.entries.find((e) => e.id === sessionId)
					if (entry) {
						entry.task = title
						fs.writeFileSync(indexPath, JSON.stringify(parsed, null, 2), "utf-8")
					}
				}
			}
			const historyPath = path.join(this.storagePath, "tasks", sessionId, "history_item.json")
			if (fs.existsSync(historyPath)) {
				const raw = fs.readFileSync(historyPath, "utf-8")
				const parsed = JSON.parse(raw) as { task?: string }
				parsed.task = title
				fs.writeFileSync(historyPath, JSON.stringify(parsed, null, 2), "utf-8")
			}
		} catch (err) {
			logger.warn("TuiRuntimeAdapter", "Failed to rename session", err as Error)
		}
		await this.refreshRecentSessions()
	}

	async deleteSession(sessionId: string): Promise<void> {
		try {
			const indexPath = path.join(this.storagePath, "tasks", "_index.json")
			if (fs.existsSync(indexPath)) {
				const raw = fs.readFileSync(indexPath, "utf-8")
				const parsed = JSON.parse(raw) as { entries?: Array<{ id: string }> }
				if (Array.isArray(parsed.entries)) {
					parsed.entries = parsed.entries.filter((e) => e.id !== sessionId)
					fs.writeFileSync(indexPath, JSON.stringify(parsed, null, 2), "utf-8")
				}
			}
			const taskDir = path.join(this.storagePath, "tasks", sessionId)
			if (fs.existsSync(taskDir)) {
				fs.rmSync(taskDir, { recursive: true, force: true })
			}
		} catch (err) {
			logger.warn("TuiRuntimeAdapter", "Failed to delete session", err as Error)
		}
		await this.refreshRecentSessions()
	}

	async forkSession(sessionId: string): Promise<string> {
		const newId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
		try {
			const sourceDir = path.join(this.storagePath, "tasks", sessionId)
			const targetDir = path.join(this.storagePath, "tasks", newId)
			if (fs.existsSync(sourceDir)) {
				fs.mkdirSync(targetDir, { recursive: true })
				for (const file of fs.readdirSync(sourceDir)) {
					const src = path.join(sourceDir, file)
					const dst = path.join(targetDir, file)
					if (fs.statSync(src).isFile()) {
						fs.copyFileSync(src, dst)
					}
				}
				const historyPath = path.join(targetDir, "history_item.json")
				if (fs.existsSync(historyPath)) {
					const raw = fs.readFileSync(historyPath, "utf-8")
					const parsed = JSON.parse(raw) as { id?: string; task?: string }
					parsed.id = newId
					parsed.task = `${parsed.task || "Session"} (fork)`
					fs.writeFileSync(historyPath, JSON.stringify(parsed, null, 2), "utf-8")
				}
			}
			const indexPath = path.join(this.storagePath, "tasks", "_index.json")
			if (fs.existsSync(indexPath)) {
				const raw = fs.readFileSync(indexPath, "utf-8")
				const parsed = JSON.parse(raw) as { entries?: Array<{ id: string; task: string; ts: number }> }
				if (Array.isArray(parsed.entries)) {
					const sourceEntry = parsed.entries.find((e) => e.id === sessionId)
					parsed.entries.unshift({
						id: newId,
						task: `${sourceEntry?.task || "Session"} (fork)`,
						ts: Date.now(),
					})
					fs.writeFileSync(indexPath, JSON.stringify(parsed, null, 2), "utf-8")
				}
			}
		} catch (err) {
			logger.warn("TuiRuntimeAdapter", "Failed to fork session", err as Error)
		}
		await this.refreshRecentSessions()
		return newId
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
			if (message.type === "planUpdate") {
				const plan = this.normalizePlan(message.plan)
				this.dispatch({ type: "plan/set", payload: { plan } })
				if (plan) {
					for (const step of plan.steps) {
						this.dispatch({
							type: "plan/updateStep",
							payload: {
								stepId: step.id,
								status: step.status,
								result: step.result,
								error: step.error,
								startedAt: step.startedAt,
								completedAt: step.completedAt,
							},
						})
					}
				}
				this.emitEvent({
					type: "plan.updated",
					timestamp: Date.now(),
					sessionId: this.sessionId ?? "",
					plan,
				})
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
			void this.refreshRecentSessions()
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
						toolName,
						path: typeof toolInfo?.path === "string" ? toolInfo.path : undefined,
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
						command,
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
						serverName: mcpInfo?.serverName,
						toolName: mcpInfo?.toolName,
					})
					break
				}
				case "followup": {
					const question = msg.text || ""
					const options = parseQuestionOptions(question)
					const requestId = this.generateRequestId()
					this.pendingQuestions.set(requestId, msg.id)
					this.emitEvent({
						type: "question.requested",
						timestamp: msg.ts,
						sessionId: this.sessionId,
						requestId,
						messageId: msg.id,
						question,
						options,
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
					this.dispatch({
						type: "message/create",
						payload: {
							id: msg.id,
							sessionId: this.sessionId,
							role: "reasoning",
							createdAt: msg.ts,
							updatedAt: msg.ts,
							content,
							partIds: [partId],
						},
					})
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

	private normalizePlan(raw: unknown): import("./types.ts").TuiPlan | null {
		if (!raw || typeof raw !== "object") return null
		const p = raw as Record<string, unknown>
		const steps = Array.isArray(p.steps)
			? p.steps.map((s: unknown, index: number) => {
					const step = s as Record<string, unknown>
					const dependencies = Array.isArray(step.dependencies)
						? step.dependencies.filter((d): d is string => typeof d === "string")
						: []
					return {
						id: typeof step.id === "string" ? step.id : `step-${index}`,
						index: typeof step.index === "number" ? step.index : index,
						description: typeof step.description === "string" ? step.description : "",
						mode: typeof step.mode === "string" ? step.mode : "code",
						dependencies,
						status: this.normalizeStepStatus(step.status),
						result: typeof step.result === "string" ? step.result : undefined,
						error: typeof step.error === "string" ? step.error : undefined,
						startedAt: typeof step.startedAt === "number" ? step.startedAt : undefined,
						completedAt: typeof step.completedAt === "number" ? step.completedAt : undefined,
						taskId: typeof step.taskId === "string" ? step.taskId : undefined,
						subPlan: step.subPlan ? this.normalizePlan(step.subPlan) : undefined,
					}
				})
			: []
		return {
			id: typeof p.id === "string" ? p.id : "plan-unknown",
			title: typeof p.title === "string" ? p.title : "Execution Plan",
			description: typeof p.description === "string" ? p.description : "",
			status: this.normalizePlanStatus(p.status),
			steps,
			totalSteps: typeof p.totalSteps === "number" ? p.totalSteps : steps.length,
			completedSteps:
				typeof p.completedSteps === "number"
					? p.completedSteps
					: steps.filter((s) => s.status === "completed" || s.status === "skipped").length,
			createdAt: typeof p.createdAt === "number" ? p.createdAt : Date.now(),
			updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : Date.now(),
		}
	}

	private normalizePlanStatus(status: unknown): import("./types.ts").TuiPlan["status"] {
		const valid = ["draft", "approved", "executing", "paused", "completed", "failed", "cancelled"] as const
		return valid.find((s) => s === status) ?? "draft"
	}

	private normalizeStepStatus(status: unknown): import("./types.ts").TuiPlanStep["status"] {
		const valid = ["pending", "ready", "running", "completed", "failed", "skipped", "cancelled"] as const
		return valid.find((s) => s === status) ?? "pending"
	}

	private inferRole(msg: ClineMessage): TuiMessage["role"] {
		if (msg.type === "say" && String(msg.say) === "user") {
			return "user"
		}
		if (msg.type === "say" && msg.say === "reasoning") {
			return "reasoning"
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

	private async refreshRecentSessions(): Promise<void> {
		try {
			const entries = await readWorkspaceTaskSessions(process.cwd())
			const currentSession = this.sessionId ? this.state.sessions.get(this.sessionId) : undefined
			const updated = entries.slice(0, 10).map((entry) => {
				const isCurrent = entry.id === this.sessionId
				const messageCount = isCurrent && currentSession ? currentSession.messages.length : 0
				return {
					id: entry.id,
					title: entry.task || entry.id,
					createdAt: entry.ts,
					updatedAt: entry.ts,
					messageCount,
				}
			})
			this.recentSessions = updated
			this.dispatch({ type: "session/refresh" })
		} catch (_err) {
			// ignore refresh errors
		}
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
			currentPlan: this.state.currentPlan,
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

function parseQuestionOptions(question: string): string[] | undefined {
	const lines = question.split("\n")
	const options: string[] = []
	let inOptions = false
	for (const line of lines) {
		const trimmed = line.trim()
		if (!trimmed) continue
		if (/^\d+[.):]\s+/.test(trimmed) || /^[-*]\s+/.test(trimmed)) {
			options.push(trimmed.replace(/^\d+[.):]\s+/, "").replace(/^[-*]\s+/, ""))
			inOptions = true
		} else if (inOptions) {
			break
		}
	}
	return options.length > 0 ? options : undefined
}

// =============================================================================
// Reducer
// =============================================================================

export interface TuiState {
	sessions: Map<string, TuiSession>
	messages: Map<string, TuiMessage>
	parts: Map<string, TuiPart>
	currentSessionId: string | null
	currentPlan: import("./types.ts").TuiPlan | null
}

export const initialTuiState: TuiState = {
	sessions: new Map(),
	messages: new Map(),
	parts: new Map(),
	currentSessionId: null,
	currentPlan: null,
}

export function createInitialTuiState(): TuiState {
	return {
		sessions: new Map(),
		messages: new Map(),
		parts: new Map(),
		currentSessionId: null,
		currentPlan: null,
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

		case "plan/set": {
			return { ...state, currentPlan: action.payload.plan }
		}

		case "plan/updateStep": {
			if (!state.currentPlan) return state
			const plan = { ...state.currentPlan }
			const steps = plan.steps.map((step) => {
				if (step.id !== action.payload.stepId) return step
				return {
					...step,
					status: action.payload.status,
					result: action.payload.result,
					error: action.payload.error,
					startedAt: action.payload.startedAt ?? step.startedAt,
					completedAt: action.payload.completedAt ?? step.completedAt,
				}
			})
			const completedSteps = steps.filter((s) => s.status === "completed" || s.status === "skipped").length
			return {
				...state,
				currentPlan: {
					...plan,
					steps,
					completedSteps,
					updatedAt: Date.now(),
				},
			}
		}

		default:
			return state
	}
}
