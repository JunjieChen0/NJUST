/**
 * Bun TUI Subprocess Entry
 *
 * Runs inside the Bun runtime and:
 *   1. Creates the OpenTUI renderer (using SolidJS)
 *   2. Reads IPC messages from stdin (from the Node main process)
 *   3. Mounts the App shell with ThemeProvider + DialogProvider + CommandProvider
 *   4. Forwards TuiRuntimeEvents back to stdout
 *
 * Layout structure (top-level providers):
 *   ThemeProvider
 *     └── CommandProvider
 *         └── DialogProvider
 *             ├── App (Home | Session)
 *             └── DialogContainer (modal overlay)
 *
 * Usage: bun subprocess.tsx
 */

import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"

import { IpcProtocol, type IpcMessage } from "./runtime/ipc-protocol.ts"
import type { TuiRuntimeEvent, TuiUiEvent } from "./runtime/types.ts"
import { ThemeProvider } from "./context/theme.tsx"
import { useTheme } from "./context/theme.tsx"
import { ToastProvider } from "./context/toast.tsx"
import { CommandProvider, commandRegistry } from "./context/command.tsx"
import { DialogProvider, DialogContainer, useDialog, Dialog } from "./dialogs/index.tsx"
import { requestPromptClear } from "./lib/prompt-bus.ts"
import { useToast } from "./context/toast.tsx"
import { Splash, LoadingOverlay } from "./components/splash.tsx"
import { Home } from "./routes/home.tsx"
import { Session } from "./routes/session/index.tsx"
import { loadTuiConfig, saveTuiConfig, matchesKeybinding, type TuiConfig } from "./lib/tui-config.ts"

// =============================================================================
// State (mutable, fed by IPC events)
// =============================================================================

interface SubprocessState {
	currentSessionId: string | null
	messages: TuiMessage[]
	isRunning: boolean
	sessions: Array<{
		id: string
		title: string
		createdAt: number
		updatedAt: number
		messageCount: number
	}>
	recentSessions: Array<{
		id: string
		title: string
		createdAt: number
		updatedAt: number
		messageCount: number
	}>
	provider: string
	model: string
	mode: string
	workspacePath: string
	todos: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" }>
	tokenUsage: { total: number; context: number; cost?: number }
	pendingApproval: {
		requestId: string
		ask: string
		toolName?: string
		path?: string
		command?: string
		serverName?: string
	} | null
	pendingQuestion: {
		requestId: string
		question: string
		options?: string[]
	} | null
	autoApprovalEnabled: boolean
	currentPlan: import("./runtime/types.ts").TuiPlan | null
	compact: boolean
	showReasoning: boolean
	config: TuiConfig
}

const state: SubprocessState = {
	currentSessionId: null,
	messages: [],
	isRunning: false,
	sessions: [],
	recentSessions: [],
	provider: "njust-ai",
	model: "default",
	mode: "code",
	workspacePath: "",
	todos: [],
	tokenUsage: { total: 0, context: 0 },
	pendingApproval: null,
	pendingQuestion: null,
	autoApprovalEnabled: false,
	currentPlan: null,
	compact: false,
	showReasoning: true,
	config: loadTuiConfig(),
}

// =============================================================================
// Wire default commands to IPC events
// =============================================================================

commandRegistry.get("session.new")!.run = () => {
	sendEvent({ type: "ui.newSession" })
}

commandRegistry.get("session.interrupt")!.run = () => {
	sendEvent({ type: "ui.cancel" })
}

commandRegistry.get("app.exit")!.run = () => {
	Dialog.confirm("Exit", "Are you sure you want to exit?", (ok) => {
		if (ok) {
			sendEvent({ type: "ui.exit" })
			process.exit(0)
		}
	})
}

commandRegistry.register({
	id: "message.undo",
	label: "Undo Last Message",
	description: "Delete the last user message",
	slashName: "undo",
	category: "Message",
	hidden: true,
	run: () => {
		sendEvent({ type: "ui.undo" })
	},
})

// Register slash commands for mode switching
for (const mode of ["code", "architect", "ask", "debug", "cloud-agent"]) {
	commandRegistry.register({
		id: `mode.switch.${mode}`,
		label: `Switch to ${mode}`,
		description: `Set current mode to ${mode}`,
		slashName: mode,
		category: "Mode",
		hidden: true,
		run: () => {
			state.mode = mode
			sendEvent({ type: "ui.setMode", mode })
			toast.show(`Mode switched to ${mode}`, "info")
		},
	})
}

commandRegistry.register({
	id: "permissions.toggleAutoApprove",
	label: "Toggle Auto-Approve",
	description: "Enable or disable automatic tool approval",
	slashName: "autoapprove",
	category: "Permissions",
	hidden: true,
	run: () => {
		const next = !state.autoApprovalEnabled
		state.autoApprovalEnabled = next
		sendEvent({ type: "ui.setAutoApproval", enabled: next })
		toast.show(`Auto-approve ${next ? "enabled" : "disabled"}`, next ? "success" : "warning")
	},
})

commandRegistry.register({
	id: "session.export",
	label: "Export Session",
	description: "Export the current session to Markdown",
	slashName: "export",
	category: "Session",
	hidden: true,
	run: () => {
		sendEvent({ type: "ui.export" })
	},
})

commandRegistry.register({
	id: "app.compact",
	label: "Toggle Compact Mode",
	description: "Toggle compact output rendering",
	slashName: "compact",
	category: "App",
	hidden: true,
	run: () => {
		state.compact = !state.compact
		state.config.compact = state.compact
		saveTuiConfig(state.config)
		toast.show(`Compact mode ${state.compact ? "enabled" : "disabled"}`, "info")
	},
})

commandRegistry.register({
	id: "app.thinking",
	label: "Toggle Reasoning Visibility",
	description: "Show or hide reasoning blocks",
	slashName: "thinking",
	category: "App",
	hidden: true,
	run: () => {
		state.showReasoning = !state.showReasoning
		state.config.showReasoning = state.showReasoning
		saveTuiConfig(state.config)
		toast.show(`Reasoning ${state.showReasoning ? "visible" : "hidden"}`, "info")
	},
})

function sendEvent(payload: TuiRuntimeEvent | TuiUiEvent) {
	process.stdout.write(IpcProtocol.serialize(IpcProtocol.createEvent("message", payload)))
}

// =============================================================================
// IPC Handler
// =============================================================================

async function handleIpcMessage(message: IpcMessage): Promise<void> {
	if (message.type === "request") {
		const response = await handleRequest(message)
		process.stdout.write(IpcProtocol.serialize(response))
	} else if (message.type === "event") {
		if (message.event === "message") {
			handleTuiEvent(message.data as TuiRuntimeEvent)
		}
	}
}

async function handleRequest(message: IpcMessage): Promise<IpcMessage> {
	try {
		if (message.type !== "request") {
			return IpcProtocol.createResponse("unknown", undefined, {
				code: "BAD_REQUEST",
				message: "handleRequest called with non-request message",
			})
		}
		const { method, id, params } = message
		switch (method) {
			case "init":
				return IpcProtocol.createResponse(id, { ok: true })

			case "startTask": {
				const p = params as { sessionId?: string } | undefined
				state.currentSessionId = p?.sessionId || null
				state.messages = []
				state.isRunning = true
				return IpcProtocol.createResponse(id, { ok: true })
			}

			case "resumeTask": {
				const p = params as { sessionId?: string } | undefined
				state.currentSessionId = p?.sessionId || null
				state.isRunning = true
				return IpcProtocol.createResponse(id, { ok: true })
			}

			case "sendMessage":
				return IpcProtocol.createResponse(id, { ok: true })

			case "approve": {
				const p = params as { requestId: string; always?: boolean } | undefined
				if (p?.requestId) {
					sendEvent({ type: "ui.approve", requestId: p.requestId, always: p.always })
				}
				return IpcProtocol.createResponse(id, { ok: true })
			}

			case "reject": {
				const p = params as { requestId: string } | undefined
				if (p?.requestId) {
					sendEvent({ type: "ui.reject", requestId: p.requestId })
				}
				return IpcProtocol.createResponse(id, { ok: true })
			}

			case "answer": {
				const p = params as { requestId: string; answer: string } | undefined
				if (p?.requestId) {
					sendEvent({ type: "ui.answer", requestId: p.requestId, answer: p.answer })
				}
				return IpcProtocol.createResponse(id, { ok: true })
			}

			case "cancel":
				sendEvent({ type: "ui.cancel" })
				return IpcProtocol.createResponse(id, { ok: true })

			case "dispose":
				return IpcProtocol.createResponse(id, { ok: true })

			default:
				return IpcProtocol.createResponse(id, undefined, {
					code: "UNKNOWN_METHOD",
					message: `Unknown method: ${method}`,
				})
		}
	} catch (error) {
		return IpcProtocol.createResponse("unknown", undefined, {
			code: "INTERNAL_ERROR",
			message: error instanceof Error ? error.message : String(error),
		})
	}
}

function handleTuiEvent(event: TuiRuntimeEvent): void {
	if (event.type === "message.created") {
		state.messages.push({
			id: event.messageId,
			sessionId: event.sessionId,
			role: event.role,
			content: event.content,
			createdAt: event.timestamp,
			updatedAt: event.timestamp,
		})
		return
	}
	if (event.type === "text.delta") {
		const msg = state.messages.find((m) => m.id === event.messageId)
		if (msg) {
			msg.content = (msg.content || "") + event.delta
			msg.updatedAt = event.timestamp
		}
		return
	}
	if (event.type === "task.completed" || event.type === "task.failed" || event.type === "task.cancelled") {
		state.isRunning = false
		return
	}
	if (event.type === "state.snapshot") {
		// Replace state with the snapshot from the Node side, but only allow
		// known safe fields to prevent arbitrary state injection.
		const allowed: Array<keyof SubprocessState> = [
			"currentSessionId",
			"messages",
			"isRunning",
			"sessions",
			"recentSessions",
			"provider",
			"model",
			"mode",
			"workspacePath",
			"todos",
			"tokenUsage",
			"pendingApproval",
			"pendingQuestion",
			"autoApprovalEnabled",
			"currentPlan",
			"compact",
			"showReasoning",
		]
		const snapshot: Partial<SubprocessState> = {}
		for (const key of allowed) {
			if (key in event.data) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				snapshot[key] = (event.data as Record<string, unknown>)[key] as any
			}
		}
		Object.assign(state, snapshot)
		return
	}
	if (event.type === "provider.changed") {
		state.provider = event.provider
		return
	}
	if (event.type === "model.changed") {
		state.model = event.model
		return
	}
	if (event.type === "todos.updated") {
		state.todos = event.todos
		return
	}
	if (event.type === "usage.updated") {
		state.tokenUsage = event.usage
		return
	}
	if (event.type === "approval.requested") {
		state.pendingApproval = {
			requestId: event.requestId,
			ask: event.ask,
			toolName: event.toolName,
			path: event.path,
			command: event.command,
			serverName: event.serverName,
		}
		return
	}
	if (event.type === "approval.resolved") {
		state.pendingApproval = null
		state.autoApprovalEnabled = event.always ? true : state.autoApprovalEnabled
		return
	}
	if (event.type === "question.requested") {
		state.pendingQuestion = {
			requestId: event.requestId,
			question: event.question,
			options: event.options,
		}
		return
	}
	if (event.type === "question.resolved") {
		state.pendingQuestion = null
	}
}

// =============================================================================
// Main
// =============================================================================

async function main() {
	const renderer = await createCliRenderer({
		externalOutputMode: "passthrough",
		exitOnCtrlC: false,
	})

	await render(
		() => (
			<ThemeProvider initialMode={state.config.theme}>
				<CommandProvider>
					<ToastProvider>
						<DialogProvider>
							<App />
							<DialogContainer />
						</DialogProvider>
					</ToastProvider>
				</CommandProvider>
			</ThemeProvider>
		),
		renderer,
	)

	process.stdout.write(IpcProtocol.serialize(IpcProtocol.createEvent("ready", { ok: true })))

	// Stdin reader
	let stdinBuffer = ""
	process.stdin.setEncoding("utf-8")
	process.stdin.on("data", (chunk: string) => {
		stdinBuffer += chunk
		const lines = stdinBuffer.split("\n")
		stdinBuffer = lines.pop() || ""
		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed) continue
			try {
				const message = JSON.parse(trimmed) as IpcMessage
				handleIpcMessage(message).catch((err) => {
					const errMsg = err instanceof Error ? err.message : String(err)
					process.stderr.write(`IPC error: ${errMsg}\n`)
				})
			} catch {
				// Skip invalid JSON
			}
		}
	})

	const dispose = () => {
		process.stdout.write(IpcProtocol.serialize(IpcProtocol.createEvent("exit", { code: 0 })))
		renderer.dispose?.()
		process.exit(0)
	}
	process.on("SIGINT", dispose)
	process.on("SIGTERM", dispose)
}

// =============================================================================
// App shell
// =============================================================================

function App() {
	const dialog = useDialog()
	const { theme, toggleMode } = useTheme()
	const toast = useToast()
	const [ready, setReady] = createSignal(false)

	// Listen for IPC ready signal
	const originalHandleIpcMessage = handleIpcMessage
	handleIpcMessage = async (message: IpcMessage) => {
		if (message.type === "event" && message.event === "ready") {
			setReady(true)
		}
		return originalHandleIpcMessage(message)
	}

	function openCommandPalette() {
		dialog.push({
			type: "custom",
			props: {
				component: () => (
					<CommandPalette
						onSelect={(cmd) => {
							dialog.pop()
							void cmd.run()
						}}
						onClose={() => dialog.pop()}
					/>
				),
			},
		})
	}

	const modes = ["code", "architect", "ask", "debug", "cloud-agent"]
	function cycleMode() {
		const currentIndex = modes.indexOf(state.mode)
		const nextMode = modes[(currentIndex + 1) % modes.length]
		if (nextMode) {
			state.mode = nextMode
			sendEvent({ type: "ui.setMode", mode: nextMode })
		}
	}

	function showHelp() {
		Dialog.alert(
			"Keyboard Shortcuts",
			[
				"Ctrl+K  Command palette",
				"Ctrl+B  Toggle sidebar",
				"Ctrl+M  Cycle mode",
				"Ctrl+L  Toggle theme",
				"Ctrl+N  New session",
				"Ctrl+R  Resume session",
				"Esc     Cancel / interrupt",
				"/help   Show this help",
				"/exit   Exit application",
			].join("\n"),
		)
	}

	function showSessionList() {
		const list = state.recentSessions.length > 0 ? state.recentSessions : state.sessions
		if (list.length === 0) {
			Dialog.alert("Resume Session", "No recent sessions found.")
			return
		}
		Dialog.select(
			"Resume Session",
			list.map((s) => ({
				label: s.title,
				description: `${new Date(s.updatedAt).toLocaleString()} · ${s.messageCount} messages`,
				value: s.id,
			})),
			(item) => {
				if (typeof item.value === "string") {
					sendEvent({ type: "ui.resumeSession", sessionId: item.value })
				}
			},
		)
	}

	// Wire command handlers to current context
	commandRegistry.get("theme.toggle")!.run = () => {
		toggleMode()
		const nextTheme = theme.isDark ? "light" : "dark"
		state.config.theme = nextTheme
		saveTuiConfig(state.config)
		sendEvent({ type: "ui.setTheme", theme: nextTheme })
		toast.show(`Theme switched to ${nextTheme}`, "info")
	}
	commandRegistry.get("mode.cycle")!.run = () => {
		cycleMode()
		toast.show(`Mode switched to ${state.mode}`, "info")
	}
	commandRegistry.get("app.compact")!.run = () => {
		state.compact = !state.compact
		state.config.compact = state.compact
		saveTuiConfig(state.config)
		toast.show(`Compact mode ${state.compact ? "enabled" : "disabled"}`, "info")
	}
	commandRegistry.get("app.thinking")!.run = () => {
		state.showReasoning = !state.showReasoning
		state.config.showReasoning = state.showReasoning
		saveTuiConfig(state.config)
		toast.show(`Reasoning ${state.showReasoning ? "visible" : "hidden"}`, "info")
	}
	commandRegistry.get("help.show")!.run = showHelp
	commandRegistry.get("session.resume")!.run = showSessionList
	commandRegistry.get("session.interrupt")!.run = () => sendEvent({ type: "ui.cancel" })
	commandRegistry.get("prompt.clear")!.run = () => {
		requestPromptClear()
		toast.show("Prompt cleared", "info")
	}
	commandRegistry.get("command.palette.show")!.run = openCommandPalette
	commandRegistry.get("agent.showPicker")!.run = openAgentPicker

	const models = ["default", "claude-4-opus", "claude-4-sonnet", "gpt-4o", "o3-mini"]
	function openModelPicker() {
		Dialog.select(
			"Select Model",
			models.map((m) => ({ label: m, value: m, category: "Models" })),
			(item) => {
				if (typeof item.value === "string") {
					state.model = item.value
					sendEvent({ type: "ui.setModel", model: item.value })
					toast.show(`Switched to model ${item.value}`, "info")
				}
			},
		)
	}
	commandRegistry.register({
		id: "model.showPicker",
		label: "Select Model",
		description: "Open the model picker",
		keybinding: "Ctrl+T",
		category: "Model",
		run: openModelPicker,
	})

	function openSettings() {
		const settings = [
			{ label: `Theme: ${state.config.theme}`, value: "theme", category: "Settings" },
			{ label: `Compact: ${state.config.compact ? "on" : "off"}`, value: "compact", category: "Settings" },
			{
				label: `Reasoning: ${state.config.showReasoning ? "on" : "off"}`,
				value: "reasoning",
				category: "Settings",
			},
			{ label: `Diff style: ${state.config.diffStyle}`, value: "diffStyle", category: "Settings" },
		]
		Dialog.select("Settings", settings, (item) => {
			const value = item.value as string
			if (value === "theme") {
				Dialog.select(
					"Theme",
					[
						{ label: "System", value: "system", category: "Theme" },
						{ label: "Light", value: "light", category: "Theme" },
						{ label: "Dark", value: "dark", category: "Theme" },
					],
					(themeItem) => {
						const mode = themeItem.value as "light" | "dark" | "system"
						state.config.theme = mode
						saveTuiConfig(state.config)
						if (mode !== "system") {
							setMode(mode)
							sendEvent({ type: "ui.setTheme", theme: mode })
						}
						toast.show(`Theme set to ${mode}`, "info")
					},
				)
			} else if (value === "compact") {
				state.config.compact = !state.config.compact
				state.compact = state.config.compact
				saveTuiConfig(state.config)
				toast.show(`Compact mode ${state.compact ? "enabled" : "disabled"}`, "info")
			} else if (value === "reasoning") {
				state.config.showReasoning = !state.config.showReasoning
				state.showReasoning = state.config.showReasoning
				saveTuiConfig(state.config)
				toast.show(`Reasoning ${state.showReasoning ? "visible" : "hidden"}`, "info")
			} else if (value === "diffStyle") {
				Dialog.select(
					"Diff Style",
					[
						{ label: "Unified", value: "unified", category: "Diff" },
						{ label: "Split", value: "split", category: "Diff" },
					],
					(styleItem) => {
						const style = styleItem.value as "unified" | "split"
						state.config.diffStyle = style
						saveTuiConfig(state.config)
						toast.show(`Diff style set to ${style}`, "info")
					},
				)
			}
		})
	}

	commandRegistry.register({
		id: "app.settings",
		label: "Settings",
		description: "Open TUI settings",
		slashName: "settings",
		category: "App",
		run: openSettings,
	})

	function handleShortcut(
		key: string,
		modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean },
	): boolean {
		for (const binding of state.config.keybindings ?? []) {
			if (matchesKeybinding(binding, key, modifiers)) {
				const cmd = commandRegistry.get(binding.command)
				if (cmd) {
					void cmd.run()
					return true
				}
			}
		}
		return false
	}

	function openAgentPicker() {
		Dialog.select(
			"Select Agent",
			[
				{ label: "Code", description: "Write and edit code", value: "code", category: "Agents" },
				{ label: "Architect", description: "Plan and design", value: "architect", category: "Agents" },
				{ label: "Ask", description: "Answer questions", value: "ask", category: "Agents" },
				{ label: "Debug", description: "Diagnose issues", value: "debug", category: "Agents" },
			],
			(item) => {
				if (typeof item.value === "string") {
					state.mode = item.value
					sendEvent({ type: "ui.setMode", mode: item.value })
					toast.show(`Switched to ${item.value} mode`, "info")
				}
			},
		)
	}

	if (!state.currentSessionId) {
		return (
			<>
				<Show when={!ready()}>
					<Splash />
				</Show>
				<Home
					sessions={state.recentSessions}
					onNewSession={() => sendEvent({ type: "ui.newSession" })}
					onStartTask={(text) => sendEvent({ type: "ui.startTask", text })}
					onResumeSession={(sessionId: string) => sendEvent({ type: "ui.resumeSession", sessionId })}
					onRenameSession={(sessionId, title) => sendEvent({ type: "ui.renameSession", sessionId, title })}
					onDeleteSession={(sessionId) => sendEvent({ type: "ui.deleteSession", sessionId })}
					onForkSession={(sessionId) => sendEvent({ type: "ui.forkSession", sessionId })}
					onOpenCommandPalette={openCommandPalette}
					onOpenAgentPicker={openAgentPicker}
					currentProvider={state.provider}
					currentModel={state.model}
					currentMode={state.mode}
					workspacePath={state.workspacePath}
					version="0.1.17"
				/>
			</>
		)
	}

	return (
		<>
			<Show when={!ready()}>
				<Splash />
			</Show>
			<Show when={state.isRunning}>
				<LoadingOverlay />
			</Show>
			<Session
				session={{
					id: state.currentSessionId,
					title: "Session",
					status: state.isRunning ? "running" : "idle",
					createdAt: Date.now(),
					updatedAt: Date.now(),
					messages: state.messages,
				}}
				messages={state.messages}
				onSendMessage={(text) => sendEvent({ type: "ui.sendMessage", text })}
				onCancel={() => sendEvent({ type: "ui.cancel" })}
				onApprove={(requestId, always) => sendEvent({ type: "ui.approve", requestId, always })}
				onReject={(requestId) => sendEvent({ type: "ui.reject", requestId })}
				onAnswer={(requestId, answer) => sendEvent({ type: "ui.answer", requestId, answer })}
				pendingApproval={state.pendingApproval}
				pendingQuestion={state.pendingQuestion}
				isRunning={state.isRunning}
				currentProvider={state.provider}
				currentModel={state.model}
				currentMode={state.mode}
				tokenUsage={state.tokenUsage}
				todos={state.todos}
				autoApprovalEnabled={state.autoApprovalEnabled}
				currentPlan={state.currentPlan}
				onApprovePlan={(planId) => sendEvent({ type: "ui.approvePlan", planId })}
				onExecutePlan={(planId) => sendEvent({ type: "ui.executePlan", planId })}
				onPausePlan={(planId) => sendEvent({ type: "ui.pausePlan", planId })}
				onCancelPlan={(planId) => sendEvent({ type: "ui.cancelPlan", planId })}
				onSkipPlanStep={(planId, stepId) => sendEvent({ type: "ui.skipPlanStep", planId, stepId })}
				onRegeneratePlanStep={(planId, stepId) => sendEvent({ type: "ui.regeneratePlanStep", planId, stepId })}
				onEditPlanStep={(planId, stepId, description) =>
					sendEvent({ type: "ui.editPlanStep", planId, stepId, description })
				}
				onShortcut={handleShortcut}
				compact={state.compact}
				showReasoning={state.showReasoning}
			/>
		</>
	)
}

// Start
main().catch((err) => {
	process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`)
	process.exit(1)
})
