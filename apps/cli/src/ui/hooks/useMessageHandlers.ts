import { useCallback, useRef } from "react"
import type {
	ExtensionMessage,
	ClineMessage,
	ClineAsk,
	ClineSay,
	TodoItem,
	ProviderSettingsEntry,
	McpServer,
	QueuedMessage,
	GitCommit,
} from "@njust-ai/types"
import { consolidateTokenUsage, consolidateApiRequests, consolidateCommands } from "@njust-ai/core/cli"

import type { TUIMessage, ToolData } from "../types.js"
import type { FileResult, SlashCommandResult, ModeResult } from "../components/autocomplete/index.js"
import { useCLIStore } from "../store.js"
import { useUIStateStore } from "../stores/uiStateStore.js"
import { extractToolData, formatToolOutput, formatToolAskMessage, parseTodosFromToolInfo } from "../utils/tools.js"

export interface UseMessageHandlersOptions {
	nonInteractive: boolean
}

export interface UseMessageHandlersReturn {
	handleExtensionMessage: (msg: ExtensionMessage) => void
	seenMessageIds: React.MutableRefObject<Set<string>>
	pendingCommandRef: React.MutableRefObject<string | null>
	firstTextMessageSkipped: React.MutableRefObject<boolean>
}

/**
 * Hook to handle messages from the extension.
 *
 * Processes three types of messages:
 * 1. "say" messages - Information from the agent (text, tool output, reasoning)
 * 2. "ask" messages - Requests for user input (approvals, followup questions)
 * 3. Extension state updates - Mode changes, task history, file search results
 *
 * Transforms ClineMessage format to TUIMessage format and updates the store.
 */
export function useMessageHandlers({ nonInteractive }: UseMessageHandlersOptions): UseMessageHandlersReturn {
	const {
		addMessage,
		setPendingAsk,
		setComplete,
		setLoading,
		setHasStartedTask,
		setFileSearchResults,
		setAllSlashCommands,
		setAvailableModes,
		setCurrentMode,
		setTokenUsage,
		setRouterModels,
		setTaskHistory,
		setCondenseTaskContextInProgress,
		setCurrentApiConfigName,
		setListApiConfigMeta,
		setApiConfiguration,
		setMcpServers,
		setAutoApprovalSettings,
		setEnableWebSearch,
		setAllowedCommands,
		setAvailableModels,
		setQueuedMessages,
		setCommitSearchResults,
		setCurrentCheckpoint,
		currentTodos,
		setTodos,
	} = useCLIStore()

	// Track seen message timestamps to filter duplicates and the prompt echo
	const seenMessageIds = useRef<Set<string>>(new Set())
	const firstTextMessageSkipped = useRef(false)

	// Track pending command for injecting into command_output toolData
	const pendingCommandRef = useRef<string | null>(null)

	/**
	 * Map extension "say" messages to TUI messages
	 */
	const handleSayMessage = useCallback(
		(ts: number, say: ClineSay, text: string, partial: boolean) => {
			const messageId = ts.toString()
			const isResuming = useCLIStore.getState().isResumingTask

			if (say === "checkpoint_saved") {
				const checkpoint = useCLIStore.getState().currentCheckpoint
				if (checkpoint) {
					seenMessageIds.current.add(messageId)
					addMessage({
						id: messageId,
						role: "assistant",
						content: `Checkpoint saved: ${checkpoint.commitHash.slice(0, 7)}`,
						toolName: "checkpoint",
						toolDisplayName: "Checkpoint",
						toolDisplayOutput: `Checkpoint saved: ${checkpoint.commitHash.slice(0, 7)}`,
						originalType: say,
						toolData: {
							tool: "checkpoint",
							commitHash: checkpoint.commitHash,
							ts: checkpoint.ts,
						},
					})
				}
				return
			}

			if (say === "api_req_started") {
				return
			}

			// api_req_finished is handled by the metrics display (token/cost aggregation).
			// Rendering it inline would duplicate the information.
			if (say === "api_req_finished") {
				return
			}

			if (say === "user_feedback" || say === "user_feedback_diff") {
				seenMessageIds.current.add(messageId)
				return
			}

			// Skip first text message ONLY for new tasks, not resumed tasks
			// When resuming, we want to show all historical messages including the first one
			if (say === "text" && !firstTextMessageSkipped.current && !isResuming) {
				firstTextMessageSkipped.current = true
				seenMessageIds.current.add(messageId)
				return
			}

			if (seenMessageIds.current.has(messageId) && !partial) {
				return
			}

			let role: TUIMessage["role"] = "assistant"
			let toolName: string | undefined
			let toolDisplayName: string | undefined
			let toolDisplayOutput: string | undefined
			let toolData: ToolData | undefined
			let thinkingStartTs: number | undefined
			let thinkingEndTs: number | undefined

			if (say === "command_output") {
				role = "tool"
				toolName = "execute_command"
				toolDisplayName = "bash"
				toolDisplayOutput = text
				const trackedCommand = pendingCommandRef.current
				toolData = { tool: "execute_command", command: trackedCommand || undefined, output: text }
				pendingCommandRef.current = null
			} else if (say === "reasoning") {
				role = "thinking"
				// OpenCode-style reasoning timer: capture start on first chunk,
				// end when the final (non-partial) chunk arrives.
				thinkingStartTs = Date.now()
				if (!partial) {
					thinkingEndTs = Date.now()
				}
			} else if (say === "mcp_server_response") {
				// MCP tool response - render like a tool result
				role = "tool"
				toolName = "mcp"
				toolDisplayName = "mcp"
				toolDisplayOutput = text
				toolData = { tool: "mcp", content: text }
			} else if (
				say === "error" ||
				say === "diff_error" ||
				say === "rooignore_error" ||
				say === "shell_integration_warning" ||
				say === "too_many_tools_warning" ||
				say === "condense_context" ||
				say === "condense_context_error" ||
				say === "sliding_window_truncation" ||
				say === "subtask_result"
			) {
				// System events: errors, warnings, context management, subtask results.
				// ChatHistoryItem will apply color/styling based on originalType.
				role = "system"
			}

			// Derive toolStatus from say type (only when message is a tool result).
			let toolStatus: TUIMessage["toolStatus"]
			if (role === "tool") {
				toolStatus = "done"
			} else if (role === "system") {
				if (say === "error" || say === "diff_error" || say === "rooignore_error") {
					toolStatus = "error"
				}
			}

			seenMessageIds.current.add(messageId)

			addMessage({
				id: messageId,
				role,
				content: text || "",
				toolName,
				toolDisplayName,
				toolDisplayOutput,
				partial,
				originalType: say,
				toolData,
				toolStatus,
				thinkingStartTs,
				thinkingEndTs,
			})
		},
		[addMessage],
	)

	/**
	 * Handle extension "ask" messages
	 */
	const handleAskMessage = useCallback(
		(ts: number, ask: ClineAsk, text: string, partial: boolean) => {
			const messageId = ts.toString()

			if (partial) {
				return
			}

			if (seenMessageIds.current.has(messageId)) {
				return
			}

			if (ask === "command_output") {
				seenMessageIds.current.add(messageId)
				return
			}

			// Handle resume_task and resume_completed_task - stop loading and show text input
			// Do not set pendingAsk - just stop loading so user sees normal input to type new message
			if (ask === "resume_task" || ask === "resume_completed_task") {
				seenMessageIds.current.add(messageId)
				setLoading(false)
				// Mark that a task has been started so subsequent messages continue the task
				// (instead of starting a brand new task via runTask)
				setHasStartedTask(true)
				// Clear the resuming flag since we're now ready for interaction
				// Historical messages should already be displayed from state processing
				useCLIStore.getState().setIsResumingTask(false)
				// Do not set pendingAsk - let the normal text input appear
				return
			}

			if (ask === "completion_result") {
				seenMessageIds.current.add(messageId)
				setComplete(true)
				setLoading(false)

				// Parse the completion result and add a message for CompletionTool to render
				try {
					const completionInfo = JSON.parse(text) as Record<string, unknown>
					const toolData: ToolData = {
						tool: "attempt_completion",
						result: completionInfo.result as string | undefined,
						content: completionInfo.result as string | undefined,
					}

					addMessage({
						id: messageId,
						role: "tool",
						content: text,
						toolName: "attempt_completion",
						toolDisplayName: "Task Complete",
						toolDisplayOutput: formatToolOutput({ tool: "attempt_completion", ...completionInfo }),
						originalType: ask,
						toolData,
						toolStatus: "done",
					})
				} catch {
					// If parsing fails, still add a basic completion message
					addMessage({
						id: messageId,
						role: "tool",
						content: text || "Task completed",
						toolName: "attempt_completion",
						toolDisplayName: "Task Complete",
						toolDisplayOutput: "✅ Task completed",
						originalType: ask,
						toolData: {
							tool: "attempt_completion",
							content: text,
						},
						toolStatus: "done",
					})
				}
				return
			}

			// Track pending command BEFORE nonInteractive handling
			// This ensures we capture the command text for later injection into command_output toolData
			if (ask === "command") {
				pendingCommandRef.current = text
			}

			if (nonInteractive && ask !== "followup") {
				seenMessageIds.current.add(messageId)

				if (ask === "tool") {
					let toolName: string | undefined
					let toolDisplayName: string | undefined
					let toolDisplayOutput: string | undefined
					let formattedContent = text || ""
					let toolData: ToolData | undefined
					let todos: TodoItem[] | undefined
					let previousTodos: TodoItem[] | undefined

					try {
						const toolInfo = JSON.parse(text) as Record<string, unknown>
						toolName = toolInfo.tool as string
						toolDisplayName = toolInfo.tool as string
						toolDisplayOutput = formatToolOutput(toolInfo)
						formattedContent = formatToolAskMessage(toolInfo)
						// Extract structured toolData for rich rendering
						toolData = extractToolData(toolInfo)

						// Special handling for update_todo_list tool - extract todos
						if (toolName === "update_todo_list" || toolName === "updateTodoList") {
							const parsedTodos = parseTodosFromToolInfo(toolInfo)
							if (parsedTodos && parsedTodos.length > 0) {
								todos = parsedTodos
								// Capture previous todos before updating global state
								previousTodos = [...currentTodos]
								setTodos(parsedTodos)
							}
						}
					} catch {
						// Use raw text if not valid JSON
					}

					addMessage({
						id: messageId,
						role: "tool",
						content: formattedContent,
						toolName,
						toolDisplayName,
						toolDisplayOutput,
						originalType: ask,
						toolData,
						todos,
						previousTodos,
						// Non-interactive path auto-approves and runs, so the
						// tool is immediately "running" — it will move to
						// "done" when the corresponding command_output /
						// mcp_server_response say arrives.
						toolStatus: "running",
					})
				} else {
					addMessage({
						id: messageId,
						role: "assistant",
						content: text || "",
						originalType: ask,
					})
				}
				return
			}

			let suggestions: Array<{ answer: string; mode?: string | null }> | undefined
			let questionText = text

			if (ask === "followup") {
				try {
					const data = JSON.parse(text)
					questionText = data.question || text
					suggestions = Array.isArray(data.suggest) ? data.suggest : undefined
				} catch {
					// Use raw text
				}
			} else if (ask === "tool") {
				try {
					const toolInfo = JSON.parse(text) as Record<string, unknown>
					questionText = formatToolAskMessage(toolInfo)
				} catch {
					// Use raw text if not valid JSON
				}
			} else if (ask === "api_req_failed") {
				// API request failed — the generic Y/N prompt is misleading.
				// Surface the error clearly; the user can still approve (retry)
				// or reject (abort). The content carries the failure reason.
				questionText = text || "API request failed"
			} else if (ask === "mistake_limit_reached") {
				// Model is repeating mistakes. Show the guidance text from the
				// extension verbatim instead of the raw JSON.
				questionText = text || "Consecutive mistake limit reached"
			} else if (ask === "use_mcp_server") {
				// MCP tool call — format the server/tool info for readability.
				try {
					const mcpInfo = JSON.parse(text) as Record<string, unknown>
					const server = mcpInfo.serverName ?? mcpInfo.server ?? "mcp"
					const tool = mcpInfo.toolName ?? mcpInfo.tool ?? "tool"
					questionText = `MCP [${server}] → ${tool}`
					if (typeof mcpInfo.arguments === "string" && mcpInfo.arguments.length > 0) {
						questionText += `\n${mcpInfo.arguments}`
					}
				} catch {
					questionText = text
				}
			} else if (ask === "auto_approval_max_req_reached") {
				// Auto-approval limit hit — user must manually approve.
				questionText = text || "Auto-approval limit reached. Approve this request manually?"
			}
			// Note: ask === "command" is handled above before the nonInteractive block

			seenMessageIds.current.add(messageId)

			setPendingAsk({
				id: messageId,
				type: ask,
				content: questionText,
				suggestions,
			})
		},
		[addMessage, setPendingAsk, setComplete, setLoading, setHasStartedTask, nonInteractive, currentTodos, setTodos],
	)

	/**
	 * Handle all extension messages
	 */
	const handleExtensionMessage = useCallback(
		(msg: ExtensionMessage) => {
			if (msg.type === "state") {
				const state = msg.state

				if (!state) {
					return
				}

				// Extract and update current mode from state
				const newMode = state.mode

				if (newMode) {
					setCurrentMode(newMode)
				}

				// Extract and update API configuration profile metadata
				if (state.currentApiConfigName !== undefined) {
					setCurrentApiConfigName(state.currentApiConfigName)
				}

				if (state.listApiConfigMeta !== undefined) {
					setListApiConfigMeta((state.listApiConfigMeta as ProviderSettingsEntry[]) || [])
				}

				if (state.apiConfiguration !== undefined) {
					setApiConfiguration(state.apiConfiguration)
				}

				// Extract auto-approve settings
				setAutoApprovalSettings({
					autoApprovalEnabled: state.autoApprovalEnabled ?? false,
					alwaysAllowReadOnly: state.alwaysAllowReadOnly ?? false,
					alwaysAllowWrite: state.alwaysAllowWrite ?? false,
					alwaysAllowExecute: state.alwaysAllowExecute ?? false,
					alwaysAllowMcp: state.alwaysAllowMcp ?? false,
					alwaysAllowModeSwitch: state.alwaysAllowModeSwitch ?? false,
					alwaysAllowSubtasks: state.alwaysAllowSubtasks ?? false,
					alwaysAllowFollowupQuestions: state.alwaysAllowFollowupQuestions ?? false,
				})

				// Extract web search toggle
				if (state.enableWebSearch !== undefined) {
					setEnableWebSearch(state.enableWebSearch)
				}

				// Extract allowed commands
				if (state.allowedCommands !== undefined) {
					setAllowedCommands(state.allowedCommands || [])
				}

				// Extract queued messages
				if (state.messageQueue !== undefined) {
					setQueuedMessages((state.messageQueue as QueuedMessage[]) || [])
				}

				// Extract and update task history from state
				const newTaskHistory = state.taskHistory

				if (newTaskHistory && Array.isArray(newTaskHistory)) {
					setTaskHistory(newTaskHistory)
				}

				const clineMessages = state.clineMessages

				if (clineMessages) {
					for (const clineMsg of clineMessages) {
						const ts = clineMsg.ts
						const type = clineMsg.type
						const say = clineMsg.say
						const ask = clineMsg.ask
						const text = clineMsg.text || ""
						const partial = clineMsg.partial || false

						if (type === "say" && say) {
							handleSayMessage(ts, say, text, partial)
						} else if (type === "ask" && ask) {
							handleAskMessage(ts, ask, text, partial)
						}
					}

					// Compute token usage metrics from clineMessages
					// Skip first message (task prompt) as per webview UI pattern
					if (clineMessages.length > 1) {
						const processed = consolidateApiRequests(
							consolidateCommands(clineMessages.slice(1) as ClineMessage[]),
						)

						const metrics = consolidateTokenUsage(processed)
						setTokenUsage(metrics)
					}
				}

				// After processing state, clear the resuming flag if it was set
				// This ensures the flag is cleared even if no resume_task ask message is received
				if (useCLIStore.getState().isResumingTask) {
					useCLIStore.getState().setIsResumingTask(false)
				}
			} else if (msg.type === "messageUpdated") {
				const clineMessage = msg.clineMessage

				if (!clineMessage) {
					return
				}

				const ts = clineMessage.ts
				const type = clineMessage.type
				const say = clineMessage.say
				const ask = clineMessage.ask
				const text = clineMessage.text || ""
				const partial = clineMessage.partial || false

				if (type === "say" && say) {
					handleSayMessage(ts, say, text, partial)
				} else if (type === "ask" && ask) {
					handleAskMessage(ts, ask, text, partial)
				}
			} else if (msg.type === "fileSearchResults") {
				setFileSearchResults((msg.results as FileResult[]) || [])
			} else if (msg.type === "commitSearchResults") {
				setCommitSearchResults((msg.commits || []).map((c) => ({ ...c, key: c.hash })) as GitCommit[])
			} else if (msg.type === "commands") {
				setAllSlashCommands((msg.commands as SlashCommandResult[]) || [])
			} else if (msg.type === "modes") {
				setAvailableModes((msg.modes as ModeResult[]) || [])
			} else if (msg.type === "listApiConfig") {
				if (msg.listApiConfig) {
					setListApiConfigMeta(msg.listApiConfig)
				}
			} else if (msg.type === "mcpServers") {
				if (msg.mcpServers) {
					setMcpServers(msg.mcpServers as McpServer[])
				}
			} else if (msg.type === "currentCheckpointUpdated") {
				if (msg.checkpointWarning) {
					console.warn(`Checkpoint warning: ${msg.checkpointWarning.type}`)
				}
				if (msg.values?.ts && msg.values?.commitHash) {
					setCurrentCheckpoint({
						ts: msg.values.ts as number,
						commitHash: msg.values.commitHash as string,
					})
				}
			} else if (msg.type === "routerModels") {
				if (msg.routerModels) {
					setRouterModels(msg.routerModels)
				}
			} else if (msg.type === "condenseTaskContextStarted") {
				setCondenseTaskContextInProgress(true)
			} else if (msg.type === "condenseTaskContextResponse") {
				setCondenseTaskContextInProgress(false)
			} else if (msg.type === "enhancedPrompt") {
				if (msg.text) {
					useUIStateStore.getState().setPendingPromptReplacement(msg.text)
				}
			} else if (msg.type === "openAiModels") {
				if (msg.openAiModels) {
					setAvailableModels("openai", msg.openAiModels)
				}
			} else if (msg.type === "ollamaModels") {
				if (msg.ollamaModels) {
					setAvailableModels("ollama", Object.keys(msg.ollamaModels))
				}
			} else if (msg.type === "lmStudioModels") {
				if (msg.lmStudioModels) {
					setAvailableModels("lmstudio", Object.keys(msg.lmStudioModels))
				}
			} else if (msg.type === "vsCodeLmModels") {
				if (msg.vsCodeLmModels) {
					setAvailableModels(
						"vscode-lm",
						msg.vsCodeLmModels.map((m) => m.id || m.family || "unknown"),
					)
				}
			} else if (msg.type === "singleRouterModelFetchResponse") {
				// Single model fetch response - extract provider and models
				if (msg.values?.provider && msg.values?.models) {
					setAvailableModels(msg.values.provider as string, msg.values.models as string[])
				}
			}
		},
		[
			handleSayMessage,
			handleAskMessage,
			setFileSearchResults,
			setAllSlashCommands,
			setAvailableModes,
			setCurrentMode,
			setTokenUsage,
			setRouterModels,
			setTaskHistory,
			setCondenseTaskContextInProgress,
			setCurrentApiConfigName,
			setListApiConfigMeta,
			setApiConfiguration,
			setMcpServers,
			setAutoApprovalSettings,
			setEnableWebSearch,
			setAllowedCommands,
			setAvailableModels,
			setQueuedMessages,
			setCommitSearchResults,
			setCurrentCheckpoint,
		],
	)

	return {
		handleExtensionMessage,
		seenMessageIds,
		pendingCommandRef,
		firstTextMessageSkipped,
	}
}
