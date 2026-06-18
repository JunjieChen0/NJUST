import { Box, Text, useApp, useInput } from "ink"
import { Select } from "@inkjs/ui"
import { useState, useEffect, useCallback, useRef, useMemo, type ReactNode } from "react"

import { ExtensionHostInterface, ExtensionHostOptions } from "@/agent/index.js"
import type { SupportedProvider } from "@/types/index.js"

import { getGlobalCommandsForAutocomplete } from "@/lib/utils/commands.js"
import { arePathsEqual } from "@/lib/utils/path.js"
import { getContextWindow, getModelIdForProvider } from "@/lib/utils/context-window.js"
import { getProviderSettings } from "@/lib/utils/provider.js"

import { useTheme } from "./theme.js"
import { useCLIStore } from "./store.js"
import { useUIStateStore } from "./stores/uiStateStore.js"

// Import extracted hooks.
import {
	TerminalSizeProvider,
	useTerminalSize,
	useToast,
	useExtensionHost,
	useMessageHandlers,
	useTaskSubmit,
	useGlobalInput,
	useFollowupCountdown,
	useFocusManagement,
	usePickerHandlers,
	useCondenseTask,
} from "./hooks/index.js"

// Import extracted utilities.
import { getView } from "./utils/index.ts"

// Import components.
import { NJUST_AI_LOGO } from "@/types/constants.js"
import ChatHistoryItem from "./components/ChatHistoryItem.js"
import LoadingText from "./components/LoadingText.js"
import ToastDisplay from "./components/ToastDisplay.js"
import TodoDisplay from "./components/TodoDisplay.js"
import ModelPicker from "./components/ModelPicker.js"
import MessageQueue from "./components/MessageQueue.js"
import FileChangesPanel from "./components/FileChangesPanel.js"
import HistoryView from "./components/HistoryView.js"
import { CommandPaletteDialog } from "./components/CommandPaletteDialog.js"
import { ConnectDialog } from "./components/ConnectDialog.js"
import { DialogModel } from "./components/DialogModel.js"
import { SettingsOverlay } from "./components/settings/SettingsOverlay.js"
import { DialogHost, useDialog, useHasOpenDialog } from "./dialog/index.js"
import {
	type AutocompleteInputHandle,
	type AutocompleteTrigger,
	type AutocompleteItem,
	AutocompleteInput,
	PickerSelect,
	createFileTrigger,
	createGitTrigger,
	createProblemsTrigger,
	createTerminalTrigger,
	createCommandTrigger,
	createSlashCommandTrigger,
	createModeTrigger,
	createHelpTrigger,
	createHistoryTrigger,
	toFileResult,
	toSlashCommandResult,
	toModeResult,
	toHistoryResult,
} from "./components/autocomplete/index.js"
import { ScrollArea, useScrollToBottom } from "./components/ScrollArea.js"
import ScrollIndicator from "./components/ScrollIndicator.js"
import SessionFooter from "./components/SessionFooter.js"
import ContextSidebar from "./components/ContextSidebar.js"

const PICKER_HEIGHT = 10

export interface TUIAppProps extends ExtensionHostOptions {
	initialPrompt?: string
	initialTaskId?: string
	initialSessionId?: string
	continueSession?: boolean
	version: string
	needsApiKey?: boolean
	// Create extension host factory for dependency injection.
	createExtensionHost: (options: ExtensionHostOptions) => ExtensionHostInterface
}

/**
 * AppContent - Main TUI content with all hooks and rendering
 */
function AppContent({
	createExtensionHost,
	onBackToSetup,
	...extensionHostOptions
}: TUIAppProps & { onBackToSetup: () => void }) {
	const {
		initialPrompt,
		initialTaskId,
		initialSessionId,
		continueSession,
		workspacePath,
		extensionPath,
		user,
		provider,
		apiKey,
		model,
		mode,
		nonInteractive = false,
		debug,
		exitOnComplete,
		reasoningEffort,
		ephemeral,
		version,
		needsApiKey,
	} = extensionHostOptions

	const { exit } = useApp()
	const theme = useTheme()

	const {
		messages,
		pendingAsk,
		isLoading,
		isComplete,
		hasStartedTask: _hasStartedTask,
		error,
		fileSearchResults,
		allSlashCommands,
		availableModes,
		taskHistory,
		currentMode,
		tokenUsage,
		routerModels,
		apiConfiguration,
		currentTodos,
		condenseTaskContextInProgress,
		currentApiConfigName,
		listApiConfigMeta,
		queuedMessages: _queuedMessages,
		mcpServers,
	} = useCLIStore()

	// Access UI state from the UI store
	const {
		showExitHint,
		countdownSeconds,
		showCustomInput,
		isTransitioningToCustomInput,
		showTodoViewer,
		showModelPicker,
		showSettings,
		showFileChanges,
		showHistory,
		showCommandPalette,
		pickerState,
		setIsTransitioningToCustomInput,
		setShowModelPicker,
		setShowSettings,
		setShowFileChanges,
		setShowHistory,
		setShowCommandPalette,
	} = useUIStateStore()

	// Compute context window from router models and API configuration
	const contextWindow = useMemo(() => {
		return getContextWindow(routerModels, apiConfiguration)
	}, [routerModels, apiConfiguration])

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteRef = useRef<AutocompleteInputHandle<any>>(null)
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const followupAutocompleteRef = useRef<AutocompleteInputHandle<any>>(null)

	const [commitSearchResults, _setCommitSearchResults] = useState<
		import("./components/autocomplete/index.js").GitResult[]
	>([])

	// Derive problems from recent tool outputs (best effort)
	const problemResults = useMemo(() => {
		const problems: import("./components/autocomplete/index.js").ProblemResult[] = []
		const errorPatterns = /error|fail|exception|warning/gi

		for (let i = messages.length - 1; i >= Math.max(0, messages.length - 50); i--) {
			const msg = messages[i]
			if (!msg || msg.role !== "tool") continue

			const content = msg.content || msg.toolDisplayOutput || ""
			const matches = content.match(errorPatterns)
			if (matches && matches.length > 0) {
				const preview = content.substring(0, 80).replace(/\n/g, " ")
				problems.push({
					key: `problem-${msg.id}`,
					summary: preview,
					source: msg.toolDisplayName || msg.toolName || "tool",
				})
			}
		}

		return problems.slice(0, 20)
	}, [messages])

	// Derive terminal outputs from recent command_output messages (best effort)
	const terminalResults = useMemo(() => {
		const terminals: import("./components/autocomplete/index.js").TerminalResult[] = []
		let index = 0

		for (let i = messages.length - 1; i >= Math.max(0, messages.length - 50); i--) {
			const msg = messages[i]
			if (!msg || msg.role !== "tool" || msg.toolName !== "execute_command") continue

			const command = msg.toolData?.command || "unknown"
			const output = msg.toolDisplayOutput || msg.content || ""
			const preview = output.substring(0, 60).replace(/\n/g, " ")

			terminals.push({
				key: `terminal-${msg.id}`,
				command,
				outputPreview: preview,
				index: index++,
			})
		}

		return terminals.slice(0, 20)
	}, [messages])

	// Derive commands from allowedCommands + history (best effort)
	const commandResults = useMemo(() => {
		const commands: import("./components/autocomplete/index.js").CommandResult[] = []
		const seen = new Set<string>()

		// Add allowed commands from state
		const { allowedCommands } = useCLIStore.getState()
		if (allowedCommands) {
			for (const cmd of allowedCommands) {
				if (!seen.has(cmd)) {
					seen.add(cmd)
					commands.push({ key: `cmd-${cmd}`, command: cmd, source: "allowed" })
				}
			}
		}

		// Add commands from history
		for (let i = messages.length - 1; i >= Math.max(0, messages.length - 50); i--) {
			const msg = messages[i]
			if (!msg || msg.role !== "tool" || msg.toolName !== "execute_command") continue

			const command = msg.toolData?.command
			if (command && !seen.has(command)) {
				seen.add(command)
				commands.push({ key: `cmd-${command}`, command, source: "history" })
			}
		}

		return commands.slice(0, 30)
	}, [messages])

	// Stable refs for autocomplete data - prevents useMemo from recreating triggers on every data change
	const fileSearchResultsRef = useRef(fileSearchResults)
	const allSlashCommandsRef = useRef(allSlashCommands)
	const availableModesRef = useRef(availableModes)
	const taskHistoryRef = useRef(taskHistory)
	const commitSearchResultsRef = useRef(commitSearchResults)
	const problemResultsRef = useRef(problemResults)
	const terminalResultsRef = useRef(terminalResults)
	const commandResultsRef = useRef(commandResults)

	// Keep refs in sync with current state
	useEffect(() => {
		fileSearchResultsRef.current = fileSearchResults
	}, [fileSearchResults])
	useEffect(() => {
		allSlashCommandsRef.current = allSlashCommands
	}, [allSlashCommands])
	useEffect(() => {
		availableModesRef.current = availableModes
	}, [availableModes])
	useEffect(() => {
		taskHistoryRef.current = taskHistory
	}, [taskHistory])
	useEffect(() => {
		commitSearchResultsRef.current = commitSearchResults
	}, [commitSearchResults])
	useEffect(() => {
		problemResultsRef.current = problemResults
	}, [problemResults])
	useEffect(() => {
		terminalResultsRef.current = terminalResults
	}, [terminalResults])
	useEffect(() => {
		commandResultsRef.current = commandResults
	}, [commandResults])

	// Scroll area state
	const { rows, columns } = useTerminalSize()
	// OpenCode V2 reference: max-w-[720px] centered prompt panel.
	// In Ink columns, ~80 columns ≈ 800px. Cap to terminal width with a margin
	// so the prompt panel feels generous but never touches the edges.
	const promptWidth = Math.max(40, Math.min(80, columns - 8))
	// Inner column budget for MultilineTextInput: panel width minus
	// border (2) + paddingLeft(1) + paddingRight(1).
	const inputColumns = Math.max(20, promptWidth - 4)
	const [scrollState, setScrollState] = useState({ scrollTop: 0, maxScroll: 0, isAtBottom: true })
	const { scrollToBottomTrigger, scrollToBottom } = useScrollToBottom()

	// Sidebar visibility: auto-show on wide terminals, manual toggle otherwise
	const wide = columns > 120
	const sidebarVisible = showSidebar || wide

	// RAF-style throttle refs for scroll updates (prevents multiple state updates per event loop tick).
	const rafIdRef = useRef<NodeJS.Immediate | null>(null)
	const pendingScrollRef = useRef<{ scrollTop: number; maxScroll: number; isAtBottom: boolean } | null>(null)

	// Toast notifications for ephemeral messages (e.g., mode changes).
	const { currentToast, showInfo } = useToast()
	const dialog = useDialog()
	const hasOpenDialog = useHasOpenDialog()

	const {
		handleExtensionMessage,
		seenMessageIds,
		pendingCommandRef: _pendingCommandRef,
		firstTextMessageSkipped,
	} = useMessageHandlers({
		nonInteractive,
	})

	const { sendToExtension, runTask, cleanup } = useExtensionHost({
		initialPrompt,
		initialTaskId,
		initialSessionId,
		continueSession,
		mode,
		reasoningEffort,
		user,
		provider,
		apiKey,
		model,
		workspacePath,
		extensionPath,
		debug,
		nonInteractive,
		ephemeral,
		exitOnComplete,
		onExtensionMessage: handleExtensionMessage,
		createExtensionHost,
	})

	// Initialize task submit hook
	const { handleSubmit, handleApprove, handleReject } = useTaskSubmit({
		sendToExtension,
		runTask,
		seenMessageIds,
		firstTextMessageSkipped,
		openSettings: () => useUIStateStore.getState().setShowSettings(true),
		openFileChanges: () => useUIStateStore.getState().setShowFileChanges(true),
		openHistory: () => useUIStateStore.getState().setShowHistory(true),
		openConnect: () => {
			dialog.replace({
				size: "medium",
				render: () => (
					<ConnectDialog
						sendToExtension={sendToExtension}
						onSuccess={(provider) => {
							showInfo?.(`Connected ${provider}. Key saved to cli-settings.json.`, 3000)
						}}
						onCancel={() => dialog.pop()}
					/>
				),
			})
		},
		// /models — open the OpenCode-style model picker dialog.
		openModelPicker: () => {
			const state = useCLIStore.getState()
			dialog.replace({
				size: "large",
				render: () => (
					<DialogModel
						currentProvider={state.apiConfiguration?.apiProvider}
						currentModel={state.apiConfiguration ? getModelIdForProvider(state.apiConfiguration) : undefined}
						onSelect={(providerID, modelID) => {
							// Update the extension host with the new model selection.
							if (sendToExtension) {
								const profileName = `cli-${providerID}`
								const apiConfiguration = {
									apiProvider: providerID as any,
									...getProviderSettings(providerID as any, undefined, modelID),
								}
								sendToExtension({
									type: "upsertApiConfiguration",
									text: profileName,
									apiConfiguration,
								})
								sendToExtension({
									type: "loadApiConfiguration",
									text: profileName,
								})
							}
							showInfo?.(`Switched to ${providerID}/${modelID}`, 3000)
						}}
					/>
				),
			})
		},
		// /agents — alias for `/mode` (cycle modes via Ctrl+M handler).
		// We surface modes in the existing settings panel, so we route
		// `/agents` there for now.
		openAgentPicker: () => useUIStateStore.getState().setShowSettings(true),
		// /mcps — MCP manager isn't a separate panel yet, so we route
		// users to settings (the MCP section lives there). When a
		// dedicated MCP overlay lands, swap this for `setShowMcp(true)`.
		openMcpManager: () => useUIStateStore.getState().setShowSettings(true),
		// /help — concise toast listing the most useful shortcuts.
		openHelp: () =>
			showInfo?.(
				"Shortcuts: tab=focus  ctrl+o=commands  ctrl+m=mode  ctrl+t=todos  esc=cancel  ctrl+c x2=exit",
				6000,
			),
		// /status — toast surfacing workspace + active provider/model.
		openStatus: () => {
			const state = useCLIStore.getState()
			const provider = state.apiConfiguration?.apiProvider ?? "no-provider"
			const profile = state.currentApiConfigName ?? "default"
			const tokens = state.tokenUsage?.contextTokens ?? 0
			showInfo?.(
				`Profile: ${profile} • Provider: ${provider} • Mode: ${state.currentMode ?? mode} • Ctx: ${tokens}`,
				5000,
			)
		},
		// /exit — quit the CLI cleanly. Defer one tick so the toast
		// (if any) has time to flush before Ink unmounts.
		exitApp: () => {
			showInfo?.("Goodbye.", 500)
			setTimeout(() => process.exit(0), 50)
		},
		showInfo,
	})

	// Initialize context condensation hook
	const { requestCondense } = useCondenseTask(sendToExtension)

	// Initialize focus management hook
	const { canToggleFocus, isScrollAreaActive, isInputAreaActive, toggleFocus } = useFocusManagement({
		showApprovalPrompt: Boolean(pendingAsk && pendingAsk.type !== "followup"),
		pendingAsk,
	})

	// Initialize countdown hook for followup auto-accept
	const { cancelCountdown } = useFollowupCountdown({
		pendingAsk,
		onAutoSubmit: handleSubmit,
	})

	// Initialize picker handlers hook
	const { handlePickerStateChange, handlePickerSelect, handlePickerClose, handlePickerIndexChange } =
		usePickerHandlers({
			autocompleteRef,
			followupAutocompleteRef,
			sendToExtension,
			showInfo,
			seenMessageIds,
			firstTextMessageSkipped,
		})

	// Initialize global input hook
	useGlobalInput({
		canToggleFocus,
		isScrollAreaActive,
		pickerIsOpen: pickerState.isOpen,
		availableModes,
		currentMode,
		mode,
		sendToExtension,
		showInfo,
		exit,
		cleanup,
		toggleFocus,
		closePicker: handlePickerClose,
		requestCondense,
		condenseInProgress: condenseTaskContextInProgress,
		disabled: hasOpenDialog,
	})

	// OpenCode-style: auto-open provider dialog when no API key is available
	// on first mount. This overlays the main UI so the user must connect
	// before they can interact with the prompt.
	useEffect(() => {
		if (needsApiKey) {
			dialog.replace({
				size: "medium",
				render: () => (
					<ConnectDialog
						sendToExtension={sendToExtension}
						onSuccess={(provider) => {
							showInfo?.(`Connected ${provider}. Key saved to cli-settings.json.`, 3000)
						}}
						onCancel={() => dialog.pop()}
					/>
				),
			})
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [needsApiKey])
	const view = getView(messages, pendingAsk, isLoading)

	// Determine if we should show the approval prompt (Y/N) instead of text input
	const showApprovalPrompt = pendingAsk && pendingAsk.type !== "followup"

	// Display all messages including partial (streaming) ones
	const displayMessages = useMemo(() => {
		return messages
	}, [messages])

	// Bridge legacy `showCommandPalette` boolean → DialogProvider (single source).
	// Open: replace any current dialog with the palette; close-callback flips
	// the boolean back so existing keymap toggles in `useGlobalInput` still work.
	const paletteDialogIdRef = useRef<number | null>(null)
	useEffect(() => {
		if (showCommandPalette) {
			if (paletteDialogIdRef.current !== null) return
			paletteDialogIdRef.current = dialog.replace({
				size: "medium",
				render: () => (
					<CommandPaletteDialog
						onSelect={(entry) => {
							paletteDialogIdRef.current = null
							setShowCommandPalette(false)
							dialog.clear()
							if (entry.name.startsWith("/")) {
								handleSubmit(entry.name)
							}
						}}
						onCancel={() => {
							paletteDialogIdRef.current = null
							setShowCommandPalette(false)
							dialog.clear()
						}}
					/>
				),
				onClose: () => {
					paletteDialogIdRef.current = null
					setShowCommandPalette(false)
				},
			})
		} else if (paletteDialogIdRef.current !== null) {
			const id = paletteDialogIdRef.current
			paletteDialogIdRef.current = null
			dialog.popById(id)
		}
		// `dialog` is stable (same hook), `handleSubmit` is recreated each
		// render so we read it via closure rather than depending on it.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [showCommandPalette])

	// Scroll to bottom when new messages arrive (if auto-scroll is enabled)
	const prevMessageCount = useRef(messages.length)
	useEffect(() => {
		if (messages.length > prevMessageCount.current && scrollState.isAtBottom) {
			scrollToBottom()
		}
		prevMessageCount.current = messages.length
	}, [messages.length, scrollState.isAtBottom, scrollToBottom])

	// Handle scroll state changes from ScrollArea (RAF-throttled to coalesce rapid updates)
	const handleScroll = useCallback((scrollTop: number, maxScroll: number, isAtBottom: boolean) => {
		// Store the latest scroll values in ref
		pendingScrollRef.current = { scrollTop, maxScroll, isAtBottom }

		// Only schedule one update per event loop tick
		if (rafIdRef.current === null) {
			rafIdRef.current = setImmediate(() => {
				rafIdRef.current = null
				const pending = pendingScrollRef.current
				if (pending) {
					setScrollState(pending)
					pendingScrollRef.current = null
				}
			})
		}
	}, [])

	// Cleanup RAF-style timer on unmount
	useEffect(() => {
		return () => {
			if (rafIdRef.current !== null) {
				clearImmediate(rafIdRef.current)
			}
		}
	}, [])

	// File search handler for the file trigger
	const handleFileSearch = useCallback(
		(query: string) => {
			if (!sendToExtension) {
				return
			}
			sendToExtension({ type: "searchFiles", query })
		},
		[sendToExtension],
	)

	const handleCommitSearch = useCallback(
		(query: string) => {
			if (!sendToExtension) {
				return
			}
			sendToExtension({ type: "searchCommits", query })
		},
		[sendToExtension],
	)

	// Create autocomplete triggers
	// Using 'any' to allow mixing different trigger types (FileResult, SlashCommandResult, ModeResult, HelpShortcutResult, HistoryResult)
	// IMPORTANT: We use refs here to avoid recreating triggers every time data changes.
	// This prevents the UI flash caused by: data change -> memo recreation -> re-render with stale state
	// The getResults/getCommands/getModes/getHistory callbacks always read from refs to get fresh data.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const autocompleteTriggers = useMemo((): AutocompleteTrigger<any>[] => {
		const fileTrigger = createFileTrigger({
			onSearch: handleFileSearch,
			getResults: () => {
				const results = fileSearchResultsRef.current
				return results.map(toFileResult)
			},
		})

		const gitTrigger = createGitTrigger({
			onSearch: handleCommitSearch,
			getResults: () => commitSearchResultsRef.current,
		})

		const problemsTrigger = createProblemsTrigger({
			getResults: () => problemResultsRef.current,
		})

		const terminalTrigger = createTerminalTrigger({
			getResults: () => terminalResultsRef.current,
		})

		const commandTrigger = createCommandTrigger({
			getResults: () => commandResultsRef.current,
		})

		const slashCommandTrigger = createSlashCommandTrigger({
			getCommands: () => {
				// Merge CLI global commands with extension commands
				const extensionCommands = allSlashCommandsRef.current.map(toSlashCommandResult)
				const globalCommands = getGlobalCommandsForAutocomplete().map(toSlashCommandResult)
				// Global commands appear first, then extension commands
				return [...globalCommands, ...extensionCommands]
			},
		})

		const modeTrigger = createModeTrigger({
			getModes: () => availableModesRef.current.map(toModeResult),
		})

		const helpTrigger = createHelpTrigger()

		// History trigger - type # to search and resume previous tasks
		const historyTrigger = createHistoryTrigger({
			getHistory: () => {
				// Filter to only show tasks for the current workspace
				// Use arePathsEqual for proper cross-platform path comparison
				// (handles trailing slashes, separators, and case sensitivity)
				const history = taskHistoryRef.current
				const filtered = history.filter((item) => arePathsEqual(item.workspace, workspacePath))
				return filtered.map(toHistoryResult)
			},
		})

		return [
			fileTrigger,
			gitTrigger,
			problemsTrigger,
			terminalTrigger,
			commandTrigger,
			slashCommandTrigger,
			modeTrigger,
			helpTrigger,
			historyTrigger,
		]
	}, [handleFileSearch, handleCommitSearch, workspacePath]) // Only depend on stable handlers and workspacePath - data accessed via refs

	// Refresh search results when fileSearchResults changes while file picker is open
	// This handles the async timing where API results arrive after initial search
	// IMPORTANT: Only run when fileSearchResults array identity changes (new API response)
	// We use a ref to track this and avoid depending on pickerState in the effect
	const prevFileSearchResultsRef = useRef(fileSearchResults)
	const prevCommitSearchResultsRef = useRef(commitSearchResults)
	const pickerStateRef = useRef(pickerState)
	pickerStateRef.current = pickerState

	useEffect(() => {
		// Only run if fileSearchResults actually changed (different array reference)
		if (fileSearchResults === prevFileSearchResultsRef.current) {
			return
		}

		const currentPickerState = pickerStateRef.current
		const willRefresh =
			currentPickerState.isOpen && currentPickerState.activeTrigger?.id === "file" && fileSearchResults.length > 0

		prevFileSearchResultsRef.current = fileSearchResults

		// Only refresh when file picker is open and we have new results
		if (willRefresh) {
			autocompleteRef.current?.refreshSearch()
			followupAutocompleteRef.current?.refreshSearch()
		}
	}, [fileSearchResults]) // Only depend on fileSearchResults - read pickerState from ref

	// Refresh git results when commitSearchResults changes while git picker is open
	useEffect(() => {
		if (commitSearchResults === prevCommitSearchResultsRef.current) {
			return
		}

		const currentPickerState = pickerStateRef.current
		const willRefresh =
			currentPickerState.isOpen &&
			currentPickerState.activeTrigger?.id === "git" &&
			commitSearchResults.length > 0

		prevCommitSearchResultsRef.current = commitSearchResults

		if (willRefresh) {
			autocompleteRef.current?.refreshSearch()
			followupAutocompleteRef.current?.refreshSearch()
		}
	}, [commitSearchResults])

	// Handle Y/N input for approval prompts
	useInput((input) => {
		if (pendingAsk && pendingAsk.type !== "followup") {
			const lower = input.toLowerCase()

			if (lower === "y") {
				handleApprove()
			} else if (lower === "n") {
				handleReject()
			}
		}
	})

	// Handle back-to-setup key for extension load errors
	useInput((input, _key) => {
		if (error && input === "b") {
			onBackToSetup()
		}
	})

	// Cancel countdown timer when user navigates in the followup suggestion menu
	// This provides better UX - any user interaction cancels the auto-accept timer
	const showFollowupSuggestions =
		pendingAsk?.type === "followup" &&
		pendingAsk.suggestions &&
		pendingAsk.suggestions.length > 0 &&
		!showCustomInput

	useInput((_input, key) => {
		// Only handle when followup suggestions are shown and countdown is active
		if (showFollowupSuggestions && countdownSeconds !== null) {
			// Cancel countdown on any arrow key navigation
			if (key.upArrow || key.downArrow) {
				cancelCountdown()
			}
		}
	})

	// Error display
	if (error) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="red" bold>
					Error: {error}
				</Text>
				<Text color="gray" dimColor>
					Press Ctrl+C to exit
				</Text>
				<Text color="gray" dimColor>
					Press B to go back to setup
				</Text>
			</Box>
		)
	}

	// Status bar content
	// Priority: Toast > Exit hint > Loading > Scroll indicator > Input hint
	// Don't show spinner when waiting for user input (pendingAsk is set).
	// (Toast itself is rendered as a floating overlay near the App root —
	// see the `<ToastDisplay floating={true} />` at the bottom.)
	const _statusBarMessage = showExitHint ? (
		<Text color="yellow">Press Ctrl+C again to exit</Text>
	) : isLoading && !pendingAsk ? (
		<Box>
			<LoadingText>{view === "ToolUse" ? "Using tool" : "Thinking"}</LoadingText>
			<Text color={theme.dimText}> • </Text>
			<Text color={theme.dimText}>Esc to cancel</Text>
			{isScrollAreaActive && (
				<>
					<Text color={theme.dimText}> • </Text>
					<ScrollIndicator
						scrollTop={scrollState.scrollTop}
						maxScroll={scrollState.maxScroll}
						isScrollFocused={true}
					/>
				</>
			)}
		</Box>
	) : isScrollAreaActive ? (
		<ScrollIndicator scrollTop={scrollState.scrollTop} maxScroll={scrollState.maxScroll} isScrollFocused={true} />
	) : isInputAreaActive ? (
		<Text color={theme.dimText}>? for shortcuts • Ctrl+K commands • Ctrl+B sidebar • Tab focus</Text>
	) : null

	const getPickerRenderItem = (): ((item: AutocompleteItem, isSelected: boolean) => ReactNode) => {
		if (pickerState.activeTrigger) {
			return pickerState.activeTrigger.renderItem
		}

		return (item: AutocompleteItem, isSelected: boolean) => (
			<Box paddingLeft={2}>
				<Text color={isSelected ? "cyan" : undefined}>{item.key}</Text>
			</Box>
		)
	}

	const isEmptySession = messages.length === 0 && !isLoading

	const homeDir = process.env.HOME || process.env.USERPROFILE || ""
	const displayPath = workspacePath.startsWith(homeDir)
		? workspacePath.replace(homeDir, "~")
		: workspacePath

		return (
		<Box flexDirection="column" height={rows - 1}>
			{/* Empty home state shows logo+path inline above the prompt panel
			    (see the input area block below). Nothing is rendered here in
			    that case so the prompt sits naturally below `flexGrow` content. */}

			{/* Model picker overlay */}
			{showModelPicker && (
				<Box flexShrink={0}>
					<ModelPicker
						currentApiConfigName={currentApiConfigName}
						listApiConfigMeta={listApiConfigMeta}
						sendToExtension={sendToExtension}
						onClose={() => setShowModelPicker(false)}
					/>
				</Box>
			)}

			{/* Command palette: now driven via DialogProvider (see effect below). */}

			{/* Settings overlay */}
			{showSettings && (
				<Box flexShrink={0}>
					<SettingsOverlay sendToExtension={sendToExtension} onClose={() => setShowSettings(false)} />
				</Box>
			)}

			{/* File changes panel */}
			{showFileChanges && (
				<Box flexShrink={0}>
					<FileChangesPanel messages={messages} onClose={() => setShowFileChanges(false)} />
				</Box>
			)}

			{/* History view - replaces main session view when active */}
			{showHistory ? (
				<Box flexDirection="column" flexGrow={1}>
					<HistoryView
						taskHistory={taskHistory}
						workspacePath={workspacePath}
						sendToExtension={sendToExtension}
						onClose={() => setShowHistory(false)}
						onResumeTask={(taskId) => {
							if (sendToExtension) {
								sendToExtension({ type: "showTaskWithId", text: taskId })
							}
							setShowHistory(false)
						}}
					/>
				</Box>
			) : (
				<>
					{isEmptySession && !pendingAsk ? (
						/* Empty home: logo pinned near the top of the screen,
						   with a flex spacer pushing the prompt panel down to
						   roughly the upper-third (mirrors OpenCode V2
						   `top:25.375%`). The logo lives here (not inside the
						   input area) so it stays visible on short terminals. */
						<Box flexDirection="column" alignItems="center" flexGrow={1} flexShrink={1} paddingTop={2}>
							<Box flexDirection="column" alignItems="center" marginBottom={1}>
								{NJUST_AI_LOGO.map((line, i) => (
									<Text key={i} color="black">
										{line}
									</Text>
								))}
								<Text color={theme.dimText}>{displayPath}</Text>
							</Box>
							<Box flexGrow={1} flexShrink={1} />
						</Box>
					) : (
						/* Active session: scrollable message history on the left
						   and an OpenCode-style ContextSidebar on the right when
						   the terminal is wide enough (≥ 100 columns). */
						<Box flexDirection="row" flexGrow={1} flexShrink={1}>
							<ScrollArea
								isActive={isScrollAreaActive}
								onScroll={handleScroll}
								scrollToBottomTrigger={scrollToBottomTrigger}>
								{displayMessages.map((message, index) => (
									<ChatHistoryItem
										key={message.id}
										message={message}
										sendToExtension={sendToExtension}
										workspacePath={workspacePath}
										isStreamingTarget={
											isLoading &&
											index === displayMessages.length - 1 &&
											message.role === "assistant"
										}
									/>
								))}
							</ScrollArea>
							{columns >= 100 && (
								<ContextSidebar
									contextFraction={
										tokenUsage && contextWindow && contextWindow > 0
											? tokenUsage.contextTokens / contextWindow
											: undefined
									}
									mcpCount={mcpServers.filter((s) => s.status === "connected").length}
									mcpHasError={mcpServers.some((s) => s.status === "disconnected" && s.error)}
								/>
							)}
						</Box>
					)}

					{/* Thinking status — shown above the prompt while the model
					    is responding (OpenCode-style). Hidden when waiting on
					    user input (pendingAsk) so it doesn't compete with the
					    Y/N prompt or followup picker. */}
					{isLoading && !pendingAsk ? (
						<Box flexDirection="row" paddingLeft={3} flexShrink={0}>
							<Text color={theme.accent}>: </Text>
							<LoadingText>{view === "ToolUse" ? "Using tool" : "Thinking"}</LoadingText>
						</Box>
					) : null}

					{/* Inline queued messages */}
					{isLoading && <MessageQueue sendToExtension={sendToExtension} />}

					{/* Input area — centered prompt panel (OpenCode V2 alignment).
					    The outer column owns horizontal centering; the inner Box
					    owns the panel width. The bg-fill Box gives the prompt the
					    visual edge against the terminal background. SessionFooter
					    is rendered directly under the panel, same width. */}
					<Box flexDirection="column" alignItems="center" flexShrink={0}>
						<Box width={promptWidth} flexDirection="column">
							{/* Logo lives in the top spacer (see empty-state
							    branch above) so it stays pinned near the top
							    on short terminals instead of being squeezed
							    above the prompt panel. */}
							<Box
								flexDirection="column"
								backgroundColor={theme.backgroundElement}
								borderStyle="round"
								borderColor={isInputAreaActive ? theme.accent : theme.borderColor}
								paddingLeft={1}
								paddingRight={1}
								paddingTop={1}
								paddingBottom={1}
							>
								{pendingAsk?.type === "followup" ? (
								<Box flexDirection="column">
									<Text color={theme.rooHeader}>{pendingAsk.content}</Text>
									{pendingAsk.suggestions && pendingAsk.suggestions.length > 0 && !showCustomInput ? (
										<Box flexDirection="row" marginTop={1}>
											<Text color={theme.primary}>┃ </Text>
											<Box flexDirection="column" flexGrow={1}>
												<Select
													options={[
														...pendingAsk.suggestions.map((s) => ({
															label: s.answer,
															value: s.answer,
														})),
														{ label: "Type something...", value: "__CUSTOM__" },
													]}
													onChange={(value) => {
														if (!value || typeof value !== "string") return
														if (showCustomInput || isTransitioningToCustomInput) return

														if (value === "__CUSTOM__") {
															// Clear countdown timer and switch to custom input
															cancelCountdown()
															setIsTransitioningToCustomInput(true)
															useUIStateStore.getState().setShowCustomInput(true)
														} else if (value.trim()) {
															handleSubmit(value)
														}
													}}
												/>
												<Text color={theme.dimText}>
													↑↓ navigate • Enter select
													{countdownSeconds !== null && (
														<Text color={theme.warningColor}>
															{" "}
															• Auto-select in {countdownSeconds}s
														</Text>
													)}
												</Text>
											</Box>
										</Box>
									) : (
									<Box flexDirection="row" marginTop={1}>
										<Text color={theme.primary}>┃ </Text>
										<Box flexDirection="column" flexGrow={1}>
											<AutocompleteInput
												ref={followupAutocompleteRef}
												placeholder="Type your response..."
												onSubmit={(text: string) => {
													if (text && text.trim()) {
														handleSubmit(text)
														useUIStateStore.getState().setShowCustomInput(false)
														setIsTransitioningToCustomInput(false)
													}
												}}
												isActive={!hasOpenDialog}
												triggers={autocompleteTriggers}
												onPickerStateChange={handlePickerStateChange}
												prompt="› "
												columnOverride={inputColumns}
											/>
												{pickerState.isOpen ? (
													<Box flexDirection="column" height={PICKER_HEIGHT}>
														<PickerSelect
															results={pickerState.results}
															selectedIndex={pickerState.selectedIndex}
															maxVisible={PICKER_HEIGHT - 1}
															onSelect={handlePickerSelect}
															onEscape={handlePickerClose}
															onIndexChange={handlePickerIndexChange}
															renderItem={getPickerRenderItem()}
															emptyMessage={pickerState.activeTrigger?.emptyMessage}
															isActive={isInputAreaActive && pickerState.isOpen}
															isLoading={pickerState.isLoading}
														/>
													</Box>
												) : (
													<Box height={1}>
														<Text color={theme.dimText}>
															↑↓ navigate • Enter select
															{countdownSeconds !== null && (
																<Text color={theme.warningColor}>
																	{" "}
																	• Auto-select in {countdownSeconds}s
																</Text>
															)}
														</Text>
													</Box>
												)}
											</Box>
										</Box>
									)}
								</Box>
							) : showApprovalPrompt ? (
								<Box flexDirection="row" marginTop={1}>
									<Text color={theme.primary}>┃ </Text>
									<Box flexDirection="column">
										{pendingAsk?.type === "api_req_failed" ? (
											<Text bold color={theme.errorColor}>
												✗ {pendingAsk.content}
											</Text>
										) : pendingAsk?.type === "mistake_limit_reached" ? (
											<Text bold color={theme.warningColor}>
												⚠ {pendingAsk.content}
											</Text>
										) : pendingAsk?.type === "auto_approval_max_req_reached" ? (
											<Text bold color={theme.warningColor}>
												⏸ {pendingAsk.content}
											</Text>
										) : (
											<Text color={theme.rooHeader}>{pendingAsk?.content}</Text>
										)}
										<Text color={theme.dimText}>
											Press <Text color={theme.successColor}>Y</Text> to approve,{" "}
											<Text color={theme.errorColor}>N</Text> to reject
										</Text>
									</Box>
								</Box>
							) : (
								<Box flexDirection="row" marginTop={1}>
									<Text color={isInputAreaActive ? theme.primary : theme.borderColor}>┃ </Text>
									<Box flexDirection="column" flexGrow={1}>
										<AutocompleteInput
											ref={autocompleteRef}
											placeholder={
											isComplete
												? "Type to continue..."
												: 'Ask anything, / for commands, @ for context...'
										}
											onSubmit={handleSubmit}
											isActive={isInputAreaActive && !hasOpenDialog}
											triggers={autocompleteTriggers}
											onPickerStateChange={handlePickerStateChange}
											prompt="› "
											columnOverride={inputColumns}
										/>
										{showTodoViewer ? (
											<Box flexDirection="column" height={PICKER_HEIGHT}>
												<TodoDisplay todos={currentTodos} showProgress={true} title="TODO List" />
												<Box height={1}>
													<Text color={theme.dimText}>Ctrl+T to close</Text>
												</Box>
											</Box>
										) : pickerState.isOpen ? (
											<Box flexDirection="column" height={PICKER_HEIGHT}>
												<PickerSelect
													results={pickerState.results}
													selectedIndex={pickerState.selectedIndex}
													maxVisible={PICKER_HEIGHT - 1}
													onSelect={handlePickerSelect}
													onEscape={handlePickerClose}
													onIndexChange={handlePickerIndexChange}
													renderItem={getPickerRenderItem()}
													emptyMessage={pickerState.activeTrigger?.emptyMessage}
													isActive={isInputAreaActive && pickerState.isOpen}
													isLoading={pickerState.isLoading}
												/>
											</Box>
										) : (
											<Box flexDirection="column">
												{/* Row 1: mode · provider/model on the left,
												    keyboard hints (right-aligned) on the right.
												    Mirrors OpenCode V2 prompt footer layout.
												    Reads `apiConfiguration` and `currentApiConfigName`
												    from the live store so the row updates after
												    /connect, /models, or any extension-side profile
												    change — not the constants captured at launch. */}
												<Box height={1} flexDirection="row" justifyContent="space-between">
													<Text color={theme.textMuted}>
														{currentMode || mode} <Text color={theme.border}>·</Text>{" "}
														{(apiConfiguration?.apiProvider ?? provider)}/
														{(apiConfiguration && getModelIdForProvider(apiConfiguration)) ?? model}
													</Text>
													<Text color={theme.textMuted}>
														<Text bold>tab</Text> agents{"  "}
														<Text bold>ctrl+o</Text> commands
													</Text>
												</Box>
												{/* Row 2: token usage (left) — only shown when
												    we have data, otherwise hide the row. */}
												{tokenUsage && contextWindow && contextWindow > 0 ? (
													<Box height={1}>
														<Text color={theme.textMuted}>
															<Text>
																{Math.round((tokenUsage.contextTokens / contextWindow) * 100)}%
															</Text>
															<Text color={theme.border}> · </Text>
															<Text>${tokenUsage.totalCost.toFixed(2)}</Text>
														</Text>
													</Box>
												) : null}
											</Box>
										)}
									</Box>
								</Box>
							)}
							</Box>
						</Box>
					</Box>
					{isEmptySession && !pendingAsk ? (
						/* Bottom spacer in the empty state — works with the top
						   spacer above to position the prompt at roughly
						   1/3 from the top (OpenCode V2 ≈ `top:25.375%`). */
						<Box flexGrow={2} flexShrink={1} />
					) : null}
					{/* SessionFooter — full-width status bar pinned to the
					    bottom of the terminal (OpenCode V2 layout). */}
					<Box flexShrink={0}>
						<SessionFooter
							workspacePath={workspacePath}
							showStatusHint
							connected={Boolean(
							apiKey ||
								apiConfiguration?.apiKey ||
								apiConfiguration?.apiProvider ||
								currentApiConfigName,
						)}
						/>
					</Box>
				</>
			)}
		</Box>
	)
}

/**
 * AppInner - Manages apiKey state and conditionally renders ApiKeyPrompt or AppContent
 */
function AppInner(props: TUIAppProps) {
	const [apiKey, setApiKey] = useState<string | undefined>(props.apiKey)
	const [provider, setProvider] = useState<SupportedProvider | undefined>(props.provider)
	const [ready, setReady] = useState(Boolean(props.apiKey && props.provider))

	if (!ready) {
		return (
			<WelcomeScreen
				onReady={(selectedProvider, key) => {
					setProvider(selectedProvider)
					setApiKey(key)
					setReady(true)
				}}
				onExit={() => {
					process.exit(0)
				}}
			/>
		)
	}

	return <AppContent {...props} apiKey={apiKey} provider={provider!} onBackToSetup={() => setReady(false)} />
}

/**
 * Main TUI Application Component - wraps with TerminalSizeProvider
 */
export function App(props: TUIAppProps) {
	return (
		<TerminalSizeProvider>
			<AppInner {...props} />
			<FloatingToast />
			<DialogHost />
		</TerminalSizeProvider>
	)
}

/** Reads the current toast from the hook and renders it floating at top-right. */
function FloatingToast() {
	const { currentToast } = useToast()
	if (!currentToast) return null
	return <ToastDisplay toast={currentToast} floating />
}
