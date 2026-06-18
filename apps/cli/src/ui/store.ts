import { create } from "zustand"

import type { TokenUsage, ProviderSettings, TodoItem, ProviderSettingsEntry, QueuedMessage } from "@njust-ai/types"

import type { TUIMessage, PendingAsk, TaskHistoryItem } from "./types.js"
import type { FileResult, SlashCommandResult, ModeResult } from "./components/autocomplete/index.js"

/**
 * Shallow array equality check - compares array length and element references.
 * Used to prevent unnecessary state updates when array content hasn't changed.
 */
function shallowArrayEqual<T>(a: T[], b: T[]): boolean {
	if (a === b) return true
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false
	}
	return true
}

/**
 * Streaming message debounce configuration.
 * Batches rapid partial message updates to reduce re-renders during streaming.
 * Higher values = fewer renders but text appears more "chunky"
 * Lower values = smoother text but more renders
 */
const STREAMING_DEBOUNCE_MS = 150 // 150ms debounce for aggressive batching

// Pending streaming updates - batched and flushed after debounce interval
interface PendingStreamUpdate {
	id: string
	content: string
	partial: boolean
	timestamp: number
}

const pendingStreamUpdates: Map<string, PendingStreamUpdate> = new Map()
let streamingDebounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * RouterModels type for context window lookup.
 * Simplified version - we only need contextWindow from ModelInfo.
 */
export type RouterModels = Record<string, Record<string, { contextWindow?: number }>>

/**
 * CLI application state.
 *
 * Note: Autocomplete picker UI state (isOpen, selectedIndex) is now managed
 * by the useAutocompletePicker hook. The store only holds data that needs
 * to be shared between components or persisted (like search results from API).
 */
interface CLIState {
	// Message history
	messages: TUIMessage[]
	pendingAsk: PendingAsk | null

	// Task state
	isLoading: boolean
	isComplete: boolean
	hasStartedTask: boolean
	error: string | null

	// Task resumption flag - true when resuming a task from history
	// Used to modify message processing behavior (e.g., don't skip first text message)
	isResumingTask: boolean

	// Autocomplete data (from API/extension)
	fileSearchResults: FileResult[]
	allSlashCommands: SlashCommandResult[]
	availableModes: ModeResult[]

	// Task history (for resuming previous tasks)
	taskHistory: TaskHistoryItem[]

	// Current task ID (for detecting same-task reselection)
	currentTaskId: string | null

	// Current mode (updated reactively when mode changes)
	currentMode: string | null

	// Token usage metrics (from getApiMetrics)
	tokenUsage: TokenUsage | null

	// Model info for context window lookup
	routerModels: RouterModels | null
	apiConfiguration: ProviderSettings | null

	// API configuration profile management
	currentApiConfigName: string | null
	listApiConfigMeta: ProviderSettingsEntry[]

	// Auto-approve settings mirror
	autoApprovalEnabled: boolean
	alwaysAllowReadOnly: boolean
	alwaysAllowWrite: boolean
	alwaysAllowExecute: boolean
	alwaysAllowMcp: boolean
	alwaysAllowModeSwitch: boolean
	alwaysAllowSubtasks: boolean
	alwaysAllowFollowupQuestions: boolean

	// Web search toggle
	enableWebSearch: boolean

	// Allowed commands for auto-approval
	allowedCommands: string[]

	// Available models per provider
	availableModels: Record<string, string[]>

	// Todo list tracking
	currentTodos: TodoItem[]
	previousTodos: TodoItem[]

	// MCP server state
	mcpServers: import("@njust-ai/types").McpServer[]

	// Context condensation state
	condenseTaskContextInProgress: boolean

	// Queued messages while task is running
	queuedMessages: QueuedMessage[]

	// Commit search results for @git mentions
	commitSearchResults: import("@njust-ai/types").GitCommit[]

	// Current checkpoint for diff/restore
	currentCheckpoint: { ts: number; commitHash: string } | null

	// Message edit/delete tracking
	/** Timestamp of the message being edited (edit mode). Null when not editing. */
	editingMessageTs: number | null
	/** Timestamp of the message pending deletion confirmation. Null when not deleting. */
	deletingMessageTs: number | null
}

interface CLIActions {
	// Message actions
	addMessage: (msg: TUIMessage) => void
	updateMessage: (id: string, content: string, partial?: boolean) => void

	// Task actions
	setPendingAsk: (ask: PendingAsk | null) => void
	setLoading: (loading: boolean) => void
	setComplete: (complete: boolean) => void
	setHasStartedTask: (started: boolean) => void
	setError: (error: string | null) => void
	reset: () => void
	/** Reset for task switching - preserves global state (taskHistory, modes, commands) */
	resetForTaskSwitch: () => void
	/** Set the isResumingTask flag - used when resuming a task from history */
	setIsResumingTask: (isResuming: boolean) => void

	// Autocomplete data actions
	setFileSearchResults: (results: FileResult[]) => void
	setAllSlashCommands: (commands: SlashCommandResult[]) => void
	setAvailableModes: (modes: ModeResult[]) => void

	// Task history action
	setTaskHistory: (history: TaskHistoryItem[]) => void

	// Current task ID action
	setCurrentTaskId: (taskId: string | null) => void

	// Current mode action
	setCurrentMode: (mode: string | null) => void

	// Metrics actions
	setTokenUsage: (usage: TokenUsage | null) => void
	setRouterModels: (models: RouterModels | null) => void
	setApiConfiguration: (config: ProviderSettings | null) => void

	// API configuration profile actions
	setCurrentApiConfigName: (name: string | null) => void
	setListApiConfigMeta: (meta: ProviderSettingsEntry[]) => void

	// Auto-approve settings actions
	setAutoApprovalSettings: (
		settings: Partial<
			Pick<
				CLIState,
				| "autoApprovalEnabled"
				| "alwaysAllowReadOnly"
				| "alwaysAllowWrite"
				| "alwaysAllowExecute"
				| "alwaysAllowMcp"
				| "alwaysAllowModeSwitch"
				| "alwaysAllowSubtasks"
				| "alwaysAllowFollowupQuestions"
			>
		>,
	) => void

	// Web search toggle action
	setEnableWebSearch: (enabled: boolean) => void

	// Allowed commands action
	setAllowedCommands: (commands: string[]) => void

	// Available models action
	setAvailableModels: (provider: string, models: string[]) => void

	// Todo actions
	setTodos: (todos: TodoItem[]) => void

	// Context condensation actions
	setCondenseTaskContextInProgress: (inProgress: boolean) => void

	// MCP server actions
	setMcpServers: (servers: import("@njust-ai/types").McpServer[]) => void

	// Queued message actions
	setQueuedMessages: (messages: QueuedMessage[]) => void
	addQueuedMessage: (text: string) => void
	removeQueuedMessage: (id: string) => void
	editQueuedMessage: (id: string, text: string) => void

	// Commit search actions
	setCommitSearchResults: (commits: import("@njust-ai/types").GitCommit[]) => void

	// Checkpoint actions
	setCurrentCheckpoint: (checkpoint: { ts: number; commitHash: string } | null) => void

	// Message edit/delete actions
	setEditingMessageTs: (ts: number | null) => void
	setDeletingMessageTs: (ts: number | null) => void
}

const initialState: CLIState = {
	messages: [],
	pendingAsk: null,
	isLoading: false,
	isComplete: false,
	hasStartedTask: false,
	error: null,
	isResumingTask: false,
	fileSearchResults: [],
	allSlashCommands: [],
	availableModes: [],
	taskHistory: [],
	currentTaskId: null,
	currentMode: null,
	tokenUsage: null,
	routerModels: null,
	apiConfiguration: null,
	currentApiConfigName: null,
	listApiConfigMeta: [],
	autoApprovalEnabled: false,
	alwaysAllowReadOnly: false,
	alwaysAllowWrite: false,
	alwaysAllowExecute: false,
	alwaysAllowMcp: false,
	alwaysAllowModeSwitch: false,
	alwaysAllowSubtasks: false,
	alwaysAllowFollowupQuestions: false,
	enableWebSearch: false,
	allowedCommands: [],
	availableModels: {},
	currentTodos: [],
	previousTodos: [],
	mcpServers: [],
	condenseTaskContextInProgress: false,
	queuedMessages: [],
	commitSearchResults: [],
	currentCheckpoint: null,
	editingMessageTs: null,
	deletingMessageTs: null,
}

export const useCLIStore = create<CLIState & CLIActions>((set, get) => ({
	...initialState,

	addMessage: (msg) => {
		const state = get()
		// Check if message already exists (by ID).
		const existingIndex = state.messages.findIndex((m) => m.id === msg.id)

		// For NEW messages (not updates) - always apply immediately
		if (existingIndex === -1) {
			set({ messages: [...state.messages, msg] })
			return
		}

		// For UPDATES to existing messages:
		// If partial (streaming) and message exists, debounce the update
		if (msg.partial) {
			// Queue the update
			pendingStreamUpdates.set(msg.id, {
				id: msg.id,
				content: msg.content,
				partial: true,
				timestamp: Date.now(),
			})

			// Schedule flush if not already scheduled
			if (!streamingDebounceTimer) {
				streamingDebounceTimer = setTimeout(() => {
					// Flush all pending updates as a single batch
					const currentState = get()
					const updates = Array.from(pendingStreamUpdates.values())
					pendingStreamUpdates.clear()
					streamingDebounceTimer = null

					if (updates.length === 0) return

					// Apply all pending updates in one state change
					const newMessages = [...currentState.messages]
					let hasChanges = false

					for (const update of updates) {
						const idx = newMessages.findIndex((m) => m.id === update.id)
						if (idx !== -1 && newMessages[idx]) {
							const existing = newMessages[idx]
							// For reasoning messages, stamp the start time on the
							// first streamed chunk (OpenCode-style "Thought: Xs"
							// duration label). Already-set value is preserved.
							const thinkingStartTs =
								existing.thinkingStartTs ??
								(existing.role === "thinking" ? update.timestamp : existing.thinkingStartTs)
							newMessages[idx] = {
								...existing,
								content: update.content,
								partial: update.partial,
								thinkingStartTs,
							}
							hasChanges = true
						}
					}

					if (hasChanges) {
						set({ messages: newMessages })
					}
				}, STREAMING_DEBOUNCE_MS)
			}
			return
		}

		// Non-partial update (final message) - apply immediately and clear any pending
		// This ensures the final complete message is always shown
		pendingStreamUpdates.delete(msg.id)

		const updated = [...state.messages]
		updated[existingIndex] = msg
		set({ messages: updated })
	},

	updateMessage: (id, content, partial) =>
		set((state) => {
			const index = state.messages.findIndex((m) => m.id === id)

			if (index === -1) {
				return state
			}

			const existing = state.messages[index]

			if (!existing) {
				return state
			}

			const updated = [...state.messages]

			updated[index] = {
				...existing,
				content,
				partial: partial !== undefined ? partial : existing.partial,
			}

			return { messages: updated }
		}),

	setPendingAsk: (ask) => set({ pendingAsk: ask }),
	setLoading: (loading) => set({ isLoading: loading }),
	setComplete: (complete) => set({ isComplete: complete }),
	setHasStartedTask: (started) => set({ hasStartedTask: started }),
	setError: (error) => set({ error }),
	reset: () => set(initialState),
	resetForTaskSwitch: () =>
		set((state) => ({
			// Clear task-specific state
			messages: [],
			pendingAsk: null,
			isLoading: false,
			isComplete: false,
			hasStartedTask: false,
			error: null,
			isResumingTask: false,
			tokenUsage: null,
			currentTodos: [],
			previousTodos: [],
			// currentTaskId is preserved - will be updated to new task ID by caller
			currentTaskId: state.currentTaskId,
			// PRESERVE global state - don't clear these
			taskHistory: state.taskHistory,
			availableModes: state.availableModes,
			allSlashCommands: state.allSlashCommands,
			fileSearchResults: state.fileSearchResults,
			currentMode: state.currentMode,
			routerModels: state.routerModels,
			apiConfiguration: state.apiConfiguration,
			currentApiConfigName: state.currentApiConfigName,
			listApiConfigMeta: state.listApiConfigMeta,
			autoApprovalEnabled: state.autoApprovalEnabled,
			alwaysAllowReadOnly: state.alwaysAllowReadOnly,
			alwaysAllowWrite: state.alwaysAllowWrite,
			alwaysAllowExecute: state.alwaysAllowExecute,
			alwaysAllowMcp: state.alwaysAllowMcp,
			alwaysAllowModeSwitch: state.alwaysAllowModeSwitch,
			alwaysAllowSubtasks: state.alwaysAllowSubtasks,
			alwaysAllowFollowupQuestions: state.alwaysAllowFollowupQuestions,
			mcpServers: state.mcpServers,
			queuedMessages: state.queuedMessages,
			commitSearchResults: state.commitSearchResults,
			currentCheckpoint: state.currentCheckpoint,
		})),
	setIsResumingTask: (isResuming) => set({ isResumingTask: isResuming }),
	// Use shallow equality to prevent unnecessary re-renders when array content is the same
	setFileSearchResults: (results) =>
		set((state) => (shallowArrayEqual(state.fileSearchResults, results) ? state : { fileSearchResults: results })),
	setAllSlashCommands: (commands) =>
		set((state) => (shallowArrayEqual(state.allSlashCommands, commands) ? state : { allSlashCommands: commands })),
	setAvailableModes: (modes) =>
		set((state) => (shallowArrayEqual(state.availableModes, modes) ? state : { availableModes: modes })),
	setTaskHistory: (history) =>
		set((state) => (shallowArrayEqual(state.taskHistory, history) ? state : { taskHistory: history })),
	setCurrentTaskId: (taskId) => set({ currentTaskId: taskId }),
	setCurrentMode: (mode) => set({ currentMode: mode }),
	setTokenUsage: (usage) => set({ tokenUsage: usage }),
	setRouterModels: (models) => set({ routerModels: models }),
	setApiConfiguration: (config) => set({ apiConfiguration: config }),
	setCurrentApiConfigName: (name) => set({ currentApiConfigName: name }),
	setListApiConfigMeta: (meta) =>
		set((state) => (shallowArrayEqual(state.listApiConfigMeta, meta) ? state : { listApiConfigMeta: meta })),
	setAutoApprovalSettings: (settings) => set((state) => ({ ...state, ...settings })),
	setEnableWebSearch: (enabled) => set({ enableWebSearch: enabled }),
	setAllowedCommands: (commands) =>
		set((state) => (shallowArrayEqual(state.allowedCommands, commands) ? state : { allowedCommands: commands })),
	setAvailableModels: (provider, models) =>
		set((state) => ({
			availableModels: { ...state.availableModels, [provider]: models },
		})),
	setTodos: (todos) => set((state) => ({ previousTodos: state.currentTodos, currentTodos: todos })),
	setCondenseTaskContextInProgress: (inProgress) => set({ condenseTaskContextInProgress: inProgress }),
	setMcpServers: (servers) =>
		set((state) => (shallowArrayEqual(state.mcpServers, servers) ? state : { mcpServers: servers })),
	setQueuedMessages: (messages) => set({ queuedMessages: messages }),
	addQueuedMessage: (text) =>
		set((state) => ({
			queuedMessages: [...state.queuedMessages, { id: crypto.randomUUID(), text, timestamp: Date.now() }],
		})),
	removeQueuedMessage: (id) =>
		set((state) => ({
			queuedMessages: state.queuedMessages.filter((m) => m.id !== id),
		})),
	editQueuedMessage: (id, text) =>
		set((state) => ({
			queuedMessages: state.queuedMessages.map((m) => (m.id === id ? { ...m, text } : m)),
		})),
	setCommitSearchResults: (commits) =>
		set((state) =>
			shallowArrayEqual(state.commitSearchResults, commits) ? state : { commitSearchResults: commits },
		),
	setCurrentCheckpoint: (checkpoint) => set({ currentCheckpoint: checkpoint }),
	setEditingMessageTs: (ts) => set({ editingMessageTs: ts }),
	setDeletingMessageTs: (ts) => set({ deletingMessageTs: ts }),
}))
