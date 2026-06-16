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
import type { TuiRuntimeEvent, TuiMessage } from "./runtime/types.ts"
import { ThemeProvider } from "./context/theme.tsx"
import { CommandProvider, commandRegistry } from "./context/command.tsx"
import { DialogProvider, DialogContainer, useDialog } from "./dialogs/index.tsx"
import { CommandPalette } from "./dialogs/command-palette.tsx"
import { Home } from "./routes/home.tsx"
import { Session } from "./routes/session/index.tsx"

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
	provider: string
	model: string
	mode: string
	workspacePath: string
	todos: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" }>
	tokenUsage: { total: number; context: number; cost?: number }
}

const state: SubprocessState = {
	currentSessionId: null,
	messages: [],
	isRunning: false,
	sessions: [],
	provider: "njust-ai",
	model: "default",
	mode: "code",
	workspacePath: "",
	todos: [],
	tokenUsage: { total: 0, context: 0 },
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
	sendEvent({ type: "ui.exit" })
	process.exit(0)
}

type UiEvent =
	| { type: "ui.newSession" }
	| { type: "ui.resumeSession"; sessionId: string }
	| { type: "ui.sendMessage"; text: string }
	| { type: "ui.cancel" }
	| { type: "ui.exit" }

function sendEvent(payload: TuiRuntimeEvent | UiEvent) {
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
			case "approve":
			case "reject":
			case "answer":
			case "cancel":
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
			"provider",
			"model",
			"mode",
			"workspacePath",
			"todos",
			"tokenUsage",
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
			<ThemeProvider>
				<CommandProvider>
					<DialogProvider>
						<App />
						<DialogContainer />
					</DialogProvider>
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

	if (!state.currentSessionId) {
		return (
			<Home
				sessions={state.sessions}
				onNewSession={() => sendEvent({ type: "ui.newSession" })}
				onResumeSession={(sessionId: string) => sendEvent({ type: "ui.resumeSession", sessionId })}
				onOpenCommandPalette={openCommandPalette}
				currentProvider={state.provider}
				currentModel={state.model}
				currentMode={state.mode}
				workspacePath={state.workspacePath}
				version="0.1.17"
			/>
		)
	}

	return (
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
			isRunning={state.isRunning}
			currentProvider={state.provider}
			currentModel={state.model}
			currentMode={state.mode}
			tokenUsage={state.tokenUsage}
			todos={state.todos}
		/>
	)
}

// Start
main().catch((err) => {
	process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`)
	process.exit(1)
})
