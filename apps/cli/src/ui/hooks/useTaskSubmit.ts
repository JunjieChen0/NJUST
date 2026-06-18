import { useCallback } from "react"
import { randomUUID } from "crypto"
import fs from "fs"
import path from "path"
import type { WebviewMessage } from "@njust-ai/types"

import { getGlobalCommand } from "../../lib/utils/commands.js"

import { useCLIStore } from "../store.js"
import { useUIStateStore } from "../stores/uiStateStore.js"
import { useThemeStore } from "../theme/store.js"
import { copyToClipboard } from "../utils/clipboard.js"
import { formatTranscript, getLastAssistantMessage } from "../utils/transcript.js"

export interface UseTaskSubmitOptions {
	sendToExtension: ((msg: WebviewMessage) => void) | null
	runTask: ((prompt: string) => Promise<void>) | null
	seenMessageIds: React.MutableRefObject<Set<string>>
	firstTextMessageSkipped: React.MutableRefObject<boolean>
	openSettings?: () => void
	openFileChanges?: () => void
	openHistory?: () => void
	openConnect?: () => void
	openModelPicker?: () => void
	openAgentPicker?: () => void
	openMcpManager?: () => void
	openHelp?: () => void
	openStatus?: () => void
	exitApp?: () => void
	showInfo?: (msg: string, duration?: number) => void
}

export interface UseTaskSubmitReturn {
	handleSubmit: (text: string) => Promise<void>
	handleApprove: () => void
	handleReject: () => void
}

/**
 * Hook to handle task submission, user responses, and approvals.
 *
 * Responsibilities:
 * - Process user message submissions
 * - Detect and handle global commands (like /new)
 * - Handle pending ask responses
 * - Start new tasks or continue existing ones
 * - Handle Y/N approval responses
 */
export function useTaskSubmit({
	sendToExtension,
	runTask,
	seenMessageIds,
	firstTextMessageSkipped,
	openSettings,
	openFileChanges,
	openHistory,
	openConnect,
	openModelPicker,
	openAgentPicker,
	openMcpManager,
	openHelp,
	openStatus,
	exitApp,
	showInfo,
}: UseTaskSubmitOptions): UseTaskSubmitReturn {
	const {
		pendingAsk,
		hasStartedTask,
		isComplete,
		isLoading,
		addMessage,
		addQueuedMessage,
		setPendingAsk,
		setHasStartedTask,
		setLoading,
		setComplete,
		setError,
		messages,
		setEditingMessageTs,
		setDeletingMessageTs,
	} = useCLIStore()

	const { setShowCustomInput, setIsTransitioningToCustomInput } = useUIStateStore()

	/**
	 * Handle user text submission (from input or followup question)
	 */
	const handleSubmit = useCallback(
		async (text: string) => {
			if (!sendToExtension || !text.trim()) {
				return
			}

			const trimmedText = text.trim()

			if (trimmedText === "__CUSTOM__") {
				return
			}

			// If we're in edit mode, submit the edited message to the extension
			const currentEditingTs = useCLIStore.getState().editingMessageTs
			if (currentEditingTs !== null) {
				sendToExtension({
					type: "editMessageConfirm",
					messageTs: currentEditingTs,
					text: trimmedText,
				})
				setEditingMessageTs(null)
				showInfo?.("Message edited", 1500)
				return
			}

			// Check for CLI global action commands (e.g., /new)
			if (trimmedText.startsWith("/")) {
				const commandMatch = trimmedText.match(/^\/(\w+)(?:\s|$)/)

				if (commandMatch && commandMatch[1]) {
					const globalCommand = getGlobalCommand(commandMatch[1])

					if (globalCommand?.action === "clearTask") {
						// Reset CLI state and send clearTask to extension.
						useCLIStore.getState().reset()

						// Reset component-level refs to avoid stale message tracking.
						seenMessageIds.current.clear()
						firstTextMessageSkipped.current = false
						sendToExtension({ type: "clearTask" })

						// Re-request state, commands and modes since reset() cleared them.
						sendToExtension({ type: "requestCommands" })
						sendToExtension({ type: "requestModes" })
						return
					}

					if (globalCommand?.action === "openSettings") {
						openSettings?.()
						return
					}

					if (globalCommand?.action === "connectProvider") {
						openConnect?.()
						return
					}

					if (globalCommand?.action === "openModelPicker") {
						openModelPicker?.()
						return
					}

					if (globalCommand?.action === "openAgentPicker") {
						openAgentPicker?.()
						return
					}

					if (globalCommand?.action === "openMcpManager") {
						openMcpManager?.()
						return
					}

					if (globalCommand?.action === "showHelp") {
						openHelp?.()
						return
					}

					if (globalCommand?.action === "showStatus") {
						openStatus?.()
						return
					}

					if (globalCommand?.action === "exitApp") {
						exitApp?.()
						return
					}

					if (globalCommand?.action === "enhancePrompt") {
						// Extract the text after /enhance
						const enhanceText = trimmedText.replace(/^\/enhance\s*/, "").trim()
						if (enhanceText && sendToExtension) {
							sendToExtension({ type: "enhancePrompt", text: enhanceText })
							showInfo?.("Enhancing prompt...", 2000)
						} else {
							showInfo?.("Usage: /enhance <text>", 2000)
						}
						return
					}

					if (globalCommand?.action === "toggleWebSearch") {
						if (sendToExtension) {
							const currentState = useCLIStore.getState().enableWebSearch
							sendToExtension({
								type: "updateSettings",
								updatedSettings: { enableWebSearch: !currentState },
							})
							showInfo?.(`Web search ${!currentState ? "enabled" : "disabled"}`, 2000)
						}
						return
					}

					if (globalCommand?.action === "openFileChanges") {
						openFileChanges?.()
						return
					}

					if (globalCommand?.action === "openHistory") {
						openHistory?.()
						return
					}

					if (globalCommand?.action === "editMessage") {
						// Extract the message number from /edit <n>
						const numStr = trimmedText.replace(/^\/edit\s*/, "").trim()
						const msgNum = parseInt(numStr, 10)
						if (isNaN(msgNum) || msgNum < 1) {
							showInfo?.("Usage: /edit <number>", 2000)
							return
						}
						// Find the n-th user message (in display order)
						const userMessages = messages.filter((m) => m.role === "user")
						const targetMsg = userMessages[msgNum - 1]
						if (!targetMsg) {
							showInfo?.(`Message #${msgNum} not found (max: ${userMessages.length})`, 2000)
							return
						}
						const ts = parseInt(targetMsg.id, 10)
						if (isNaN(ts)) {
							showInfo?.("Cannot edit this message (no timestamp)", 2000)
							return
						}
						// Enter edit mode: load text into input, set editing flag
						setEditingMessageTs(ts)
						// Use pendingPromptReplacement to inject the text into the input
						useUIStateStore.getState().setPendingPromptReplacement(targetMsg.content)
						showInfo?.(`Editing message #${msgNum} — press Enter to save, Esc to cancel`, 3000)
						return
					}

					if (globalCommand?.action === "deleteMessage") {
						// Extract the message number from /delete <n>
						const numStr = trimmedText.replace(/^\/delete\s*/, "").trim()
						const msgNum = parseInt(numStr, 10)
						if (isNaN(msgNum) || msgNum < 1) {
							showInfo?.("Usage: /delete <number>", 2000)
							return
						}
						const userMessages = messages.filter((m) => m.role === "user")
						const targetMsg = userMessages[msgNum - 1]
						if (!targetMsg) {
							showInfo?.(`Message #${msgNum} not found (max: ${userMessages.length})`, 2000)
							return
						}
						const ts = parseInt(targetMsg.id, 10)
						if (isNaN(ts)) {
							showInfo?.("Cannot delete this message (no timestamp)", 2000)
							return
						}
						// Enter delete confirmation mode
						setDeletingMessageTs(ts)
						return
					}

					if (globalCommand?.action === "toggleTheme") {
						const themeStore = useThemeStore.getState()
						const newMode = themeStore.mode === "dark" ? "light" : "dark"
						themeStore.setMode(newMode)
						showInfo?.(`Theme: ${newMode}`, 1500)
						return
					}

					if (globalCommand?.action === "compactSession") {
						sendToExtension({ type: "condenseTaskContextRequest" })
						showInfo?.("Compacting session...", 2000)
						return
					}

					if (globalCommand?.action === "copyLastMessage") {
						const lastAssistant = getLastAssistantMessage(messages)
						if (lastAssistant) {
							const ok = await copyToClipboard(lastAssistant)
							showInfo?.(ok ? "Copied to clipboard" : "Copy failed", 2000)
						} else {
							showInfo?.("No assistant message to copy", 2000)
						}
						return
					}

					if (globalCommand?.action === "exportSession") {
						const transcript = formatTranscript(messages)
						const filename = `session-${Date.now()}.md`
						const filepath = path.resolve(process.cwd(), filename)
						try {
							fs.writeFileSync(filepath, transcript, "utf-8")
							showInfo?.(`Exported to ${filename}`, 3000)
						} catch {
							showInfo?.("Export failed", 2000)
						}
						return
					}
				}

				// When a task is already running, queue the message instead of sending immediately
				if (isLoading && hasStartedTask) {
					if (sendToExtension) {
						sendToExtension({ type: "queueMessage", text: trimmedText })
						addQueuedMessage(trimmedText)
					}
					return
				}
			}

			if (pendingAsk) {
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

				sendToExtension({
					type: "askResponse",
					askResponse: "messageResponse",
					text: trimmedText,
				})

				setPendingAsk(null)
				setShowCustomInput(false)
				setIsTransitioningToCustomInput(false)
				setLoading(true)
			} else if (!hasStartedTask) {
				setHasStartedTask(true)
				setLoading(true)
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

				try {
					if (runTask) {
						await runTask(trimmedText)
					}
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err))
					setLoading(false)
				}
			} else {
				if (isComplete) {
					setComplete(false)
				}

				setLoading(true)
				addMessage({ id: randomUUID(), role: "user", content: trimmedText })

				sendToExtension({
					type: "askResponse",
					askResponse: "messageResponse",
					text: trimmedText,
				})
			}
		},
		[
			sendToExtension,
			runTask,
			pendingAsk,
			hasStartedTask,
			isComplete,
			isLoading,
			addMessage,
			addQueuedMessage,
			setPendingAsk,
			setHasStartedTask,
			setLoading,
			setComplete,
			setError,
			messages,
			setEditingMessageTs,
			setDeletingMessageTs,
			setShowCustomInput,
			setIsTransitioningToCustomInput,
			seenMessageIds,
			firstTextMessageSkipped,
				openSettings,
				openFileChanges,
				openHistory,
				openConnect,
				openModelPicker,
				openAgentPicker,
				openMcpManager,
				openHelp,
				openStatus,
				exitApp,
				showInfo,
			],
	)

	/**
	 * Handle approval (Y key)
	 */
	const handleApprove = useCallback(() => {
		if (!sendToExtension) {
			return
		}

		sendToExtension({ type: "askResponse", askResponse: "yesButtonClicked" })
		setPendingAsk(null)
		setLoading(true)
	}, [sendToExtension, setPendingAsk, setLoading])

	/**
	 * Handle rejection (N key)
	 */
	const handleReject = useCallback(() => {
		if (!sendToExtension) {
			return
		}

		sendToExtension({ type: "askResponse", askResponse: "noButtonClicked" })
		setPendingAsk(null)
		setLoading(true)
	}, [sendToExtension, setPendingAsk, setLoading])

	return {
		handleSubmit,
		handleApprove,
		handleReject,
	}
}
