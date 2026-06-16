/**
 * OpenTUI Entry - Integrated with Bun IPC and Auto-Fallback
 *
 * This module:
 * 1. Attempts to start Bun subprocess with OpenTUI
 * 2. If Bun/OpenTUI fails, automatically falls back to Ink
 * 3. Provides clear error messages
 */

import { IpcClient } from "./runtime/ipc-protocol.ts"
import type { TuiRuntimeEvent } from "./runtime/types.ts"
import type { ExtensionHost } from "@/agent/extension-host.js"
import type { ClineMessage } from "@njust-ai/types"
import path from "path"
import fs from "fs"

export interface OpenTuiAppOptions {
	extensionHost: ExtensionHost
	workspacePath: string
	provider?: string
	model?: string
	mode?: string
	/**
	 * Optional session/task id. When resuming or creating with a specific id,
	 * pass it here so the TUI can attribute incoming messages to the right session.
	 */
	sessionId?: string
	onExit?: (code: number) => void
	onFallback?: (reason: string) => void
}

export interface OpenTuiResult {
	success: boolean
	ipcClient?: IpcClient
	error?: string
}

/**
 * Attempt to start OpenTUI via Bun subprocess.
 * Returns success/failure with error details for fallback.
 */
export async function createOpenTuiApp(options: OpenTuiAppOptions): Promise<OpenTuiResult> {
	// Step 1: Check if Bun is available
	const bunPath = findBunBinary()
	if (!bunPath) {
		return {
			success: false,
			error: "Bun runtime not found. Install Bun: curl -fsSL https://bun.sh/install | bash",
		}
	}

	// Step 2: Check if OpenTUI native dependencies are available
	// Note: require.resolve may fail due to exports config, so use try/catch
	try {
		// Just check if the package exists in node_modules
		const opentuiPkgPath = path.join(
			path.dirname(require.resolve("@opentui/solid/package.json", { paths: [__dirname] })),
			"..",
			"@opentui",
			"core",
			"package.json",
		)
		if (!fs.existsSync(opentuiPkgPath)) {
			return {
				success: false,
				error: "OpenTUI core package not found",
			}
		}
	} catch {
		// If we can't resolve, assume it's not available
		return {
			success: false,
			error: "OpenTUI packages not found in node_modules",
		}
	}

	// Check platform-specific native package
	const platformPkg = getPlatformOpenTuiPackage()
	if (platformPkg) {
		try {
			const platformPath = path.join(
				path.dirname(require.resolve("@opentui/solid/package.json", { paths: [__dirname] })),
				"..",
				platformPkg,
			)
			if (!fs.existsSync(platformPath)) {
				return {
					success: false,
					error: `OpenTUI native dependency missing: ${platformPkg}`,
				}
			}
		} catch {
			return {
				success: false,
				error: `OpenTUI native dependency check failed: ${platformPkg}`,
			}
		}
	}

	// Step 3: Find the subprocess script
	const scriptPath = path.join(__dirname, "subprocess.tsx")
	if (!fs.existsSync(scriptPath)) {
		// Try compiled path
		const compiledPath = path.join(__dirname, "subprocess.js")
		if (!fs.existsSync(compiledPath)) {
			return {
				success: false,
				error: `TUI subprocess script not found: ${scriptPath}`,
			}
		}
	}

	// Step 4: Start IPC client
	const ipcClient = new IpcClient({
		bunPath,
		tuiScriptPath: fs.existsSync(scriptPath) ? scriptPath : path.join(__dirname, "subprocess.js"),
		workspacePath: options.workspacePath,
	})

	try {
		await ipcClient.start()

		// Step 5: Wire up ExtensionHost events to IPC
		wireExtensionHost(ipcClient, options.extensionHost, {
			provider: options.provider || "njust-ai",
			model: options.model || "default",
			mode: options.mode || "code",
			workspacePath: options.workspacePath,
			sessionId: options.sessionId,
		})

		// Step 6: Wire up IPC events to ExtensionHost
		ipcClient.on("message", (event: UiEvent) => {
			handleUiEvent(event, options.extensionHost)
		})

		ipcClient.on("exit", (data: { code?: number; signal?: string | number }) => {
			options.onExit?.(data.code || 0)
		})

		ipcClient.on("error", (err: Error) => {
			console.error("[CLI] OpenTUI error:", err.message)
			options.onFallback?.(`OpenTUI error: ${err.message}`)
		})

		return { success: true, ipcClient }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return {
			success: false,
			error: `Failed to start OpenTUI: ${message}`,
		}
	}
}

/**
 * Auto-fallback: try OpenTUI, fall back to Ink if it fails.
 */
export async function startTuiWithFallback(
	options: OpenTuiAppOptions & {
		startInk: () => Promise<void>
	},
): Promise<void> {
	const tuiEngine = process.env.NJUST_AI_TUI_ENGINE || "opentui"

	if (tuiEngine === "ink") {
		// Explicitly request Ink fallback
		await options.startInk()
		return
	}

	// Try OpenTUI
	const result = await createOpenTuiApp(options)

	if (result.success && result.ipcClient) {
		// OpenTUI started successfully
		console.log("[CLI] OpenTUI started successfully")
		return
	}

	// OpenTUI failed, fall back to Ink
	console.warn(`[CLI] OpenTUI unavailable: ${result.error}`)
	console.warn("[CLI] Falling back to Ink TUI...")

	if (options.onFallback) {
		options.onFallback(result.error || "Unknown error")
	}

	await options.startInk()
}

// =============================================================================
// Helpers
// =============================================================================

function wireExtensionHost(
	ipcClient: IpcClient,
	host: ExtensionHost,
	snapshot: { provider: string; model: string; mode: string; workspacePath: string; sessionId?: string },
): void {
	const sessionId = snapshot.sessionId ?? ""
	// Forward ExtensionHost events to Bun subprocess
	host.on("extensionWebviewMessage", (message) => {
		if (message.type === "state" && message.state?.clineMessages) {
			for (const msg of message.state.clineMessages) {
				ipcClient.sendEvent("message", mapClineMessageToTuiEvent(msg, sessionId))
			}
		}
	})

	host.client?.on("message", (msg: ClineMessage) => {
		ipcClient.sendEvent("message", mapClineMessageToTuiEvent(msg, sessionId))
	})

	host.client?.on("messageUpdated", (msg: ClineMessage) => {
		ipcClient.sendEvent("message", mapClineMessageToTuiEvent(msg, sessionId))
	})

	host.client?.on("taskCompleted", (event: import("@/agent/events.js").TaskCompletedEvent) => {
		ipcClient.sendEvent("message", {
			type: "task.completed",
			timestamp: event.stateInfo?.lastMessageTs || Date.now(),
			sessionId,
			success: event.success,
			message: event.message?.text,
		})
	})

	// Send initial state snapshot to TUI (ensure Home screen shows first)
	ipcClient.sendEvent("message", {
		type: "state.snapshot",
		data: {
			currentSessionId: sessionId || null,
			messages: [],
			isRunning: false,
			provider: snapshot.provider,
			model: snapshot.model,
			mode: snapshot.mode,
			workspacePath: snapshot.workspacePath,
			sessions: [],
			todos: [],
			tokenUsage: { total: 0, context: 0 },
		},
	})
}

type UiEvent =
	| { type: "ui.newSession" }
	| { type: "ui.resumeSession"; sessionId: string }
	| { type: "ui.sendMessage"; text: string }
	| { type: "ui.cancel" }

function handleUiEvent(event: UiEvent, host: ExtensionHost): void {
	switch (event.type) {
		case "ui.newSession":
			// Start a new task/session
			host.runTask("")
			break
		case "ui.resumeSession":
			host.resumeTask(event.sessionId)
			break
		case "ui.sendMessage":
			host.sendToExtension({
				type: "askResponse",
				text: event.text,
			})
			break
		case "ui.cancel":
			host.sendToExtension({ type: "cancelTask" })
			break
	}
}

function mapClineMessageToTuiEvent(msg: ClineMessage, sessionId: string): TuiRuntimeEvent {
	const timestamp = msg.ts || Date.now()

	if (msg.type === "say") {
		switch (msg.say) {
			case "text":
				return {
					type: msg.partial ? "text.delta" : "message.created",
					timestamp,
					sessionId,
					messageId: msg.id,
					role: "assistant",
					content: msg.text,
				} as TuiRuntimeEvent
			case "reasoning":
				return {
					type: msg.partial ? "reasoning.delta" : "message.created",
					timestamp,
					sessionId,
					messageId: msg.id,
					role: "assistant",
					content: msg.text,
				} as TuiRuntimeEvent
			case "completion_result":
				return {
					type: "task.completed",
					timestamp,
					sessionId,
					success: true,
					message: msg.text,
				}
			case "error":
				return {
					type: "task.failed",
					timestamp,
					sessionId,
					error: msg.text || "Unknown error",
				}
			default:
				// User messages are sent as say without a specific say subtype.
				return {
					type: "message.created",
					timestamp,
					sessionId,
					messageId: msg.id,
					role: "user",
					content: msg.text,
				}
		}
	}

	return { type: "message.created", timestamp, sessionId, messageId: msg.id, role: "system" }
}

function findBunBinary(): string | null {
	const candidates =
		process.platform === "win32"
			? ["bun.exe", "bun", path.join(process.env.USERPROFILE || "", ".bun", "bin", "bun.exe")]
			: ["bun", path.join(process.env.HOME || "", ".bun", "bin", "bun")]

	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) {
				return candidate
			}
		} catch {
			// Continue
		}
	}

	return null
}

function getPlatformOpenTuiPackage(): string | null {
	const platform = process.platform
	const arch = process.arch

	const platformMap: Record<string, Record<string, string>> = {
		win32: { x64: "@opentui/core-win32-x64", arm64: "@opentui/core-win32-arm64" },
		linux: {
			x64: "@opentui/core-linux-x64-gnu",
			arm64: "@opentui/core-linux-arm64-gnu",
		},
		darwin: { x64: "@opentui/core-darwin-x64", arm64: "@opentui/core-darwin-arm64" },
	}

	return platformMap[platform]?.[arch] || null
}
