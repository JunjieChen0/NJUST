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
import { TuiRuntimeAdapter } from "./runtime/extension-host-adapter.ts"
import { setKV } from "@/lib/storage/kv.ts"
import { readWorkspaceTaskSessions, getDefaultCliTaskStoragePath } from "@/lib/task-history/index.js"
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

		// Load recent workspace sessions for the Home screen resume list
		const recentSessions = await loadRecentSessions(options.workspacePath)

		// Step 5: Wire up TuiRuntimeAdapter to IPC
		const adapter = new TuiRuntimeAdapter({
			extensionHost: options.extensionHost,
			recentSessions,
			storagePath: getDefaultCliTaskStoragePath(),
		})
		await adapter.activate()

		adapter.subscribe((event: TuiRuntimeEvent) => {
			ipcClient.sendEvent("message", event)
		})

		// Send initial state snapshot to TUI (ensure Home screen shows first)
		ipcClient.sendEvent("message", {
			type: "state.snapshot",
			timestamp: Date.now(),
			sessionId: options.sessionId ?? "",
			data: {
				currentSessionId: options.sessionId || null,
				messages: [],
				isRunning: false,
				provider: options.provider || "njust-ai",
				model: options.model || "default",
				mode: options.mode || "code",
				workspacePath: options.workspacePath,
				sessions: [],
				recentSessions,
				todos: [],
				tokenUsage: { total: 0, context: 0 },
				autoApprovalEnabled: false,
			},
		})

		// Step 6: Wire up IPC events to adapter
		ipcClient.on("message", (event: UiEvent) => {
			handleUiEvent(event, adapter)
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

type UiEvent =
	| { type: "ui.newSession" }
	| { type: "ui.startTask"; text: string }
	| { type: "ui.resumeSession"; sessionId: string }
	| { type: "ui.sendMessage"; text: string }
	| { type: "ui.approve"; requestId: string; always?: boolean }
	| { type: "ui.reject"; requestId: string }
	| { type: "ui.answer"; requestId: string; answer: string }
	| { type: "ui.cancel" }
	| { type: "ui.undo" }
	| { type: "ui.setAutoApproval"; enabled: boolean }
	| { type: "ui.export" }
	| { type: "ui.approvePlan"; planId: string }
	| { type: "ui.executePlan"; planId: string }
	| { type: "ui.pausePlan"; planId: string }
	| { type: "ui.cancelPlan"; planId: string }
	| { type: "ui.skipPlanStep"; planId: string; stepId: string }
	| { type: "ui.regeneratePlanStep"; planId: string; stepId: string }
	| { type: "ui.editPlanStep"; planId: string; stepId: string; description: string }
	| { type: "ui.renameSession"; sessionId: string; title: string }
	| { type: "ui.deleteSession"; sessionId: string }
	| { type: "ui.forkSession"; sessionId: string }
	| { type: "ui.exit" }
	| { type: "ui.setTheme"; theme: "light" | "dark" }
	| { type: "ui.setMode"; mode: string }

function handleUiEvent(event: UiEvent, adapter: TuiRuntimeAdapter): void {
	switch (event.type) {
		case "ui.newSession":
			// Clear current task/session
			void adapter.newSession()
			break
		case "ui.startTask":
			// Start a task with the user's initial prompt
			void adapter.startTask({ prompt: event.text })
			break
		case "ui.resumeSession":
			void adapter.resumeTask(event.sessionId)
			break
		case "ui.renameSession":
			void adapter.renameSession(event.sessionId, event.title)
			break
		case "ui.deleteSession":
			void adapter.deleteSession(event.sessionId)
			break
		case "ui.forkSession":
			void adapter.forkSession(event.sessionId).then((newId) => {
				console.log(`[CLI] Forked session: ${newId}`)
			})
			break
		case "ui.sendMessage":
			void adapter.sendMessage(event.text)
			break
		case "ui.approve":
			void adapter.approve(event.requestId, event.always)
			break
		case "ui.reject":
			void adapter.reject(event.requestId)
			break
		case "ui.answer":
			void adapter.answer(event.requestId, event.answer)
			break
		case "ui.cancel":
			void adapter.cancel()
			break
		case "ui.undo":
			void adapter.undo()
			break
		case "ui.setAutoApproval":
			void adapter.setAutoApprovalEnabled(event.enabled)
			break
		case "ui.export": {
			adapter
				.exportCurrentTask()
				.then((filePath) => {
					console.log(`[CLI] Session exported to: ${filePath}`)
				})
				.catch((err) => {
					console.error("[CLI] Failed to export session:", err instanceof Error ? err.message : String(err))
				})
			break
		}
		case "ui.approvePlan":
			void adapter.approvePlan(event.planId)
			break
		case "ui.executePlan":
			void adapter.executePlan(event.planId)
			break
		case "ui.pausePlan":
			void adapter.pausePlan(event.planId)
			break
		case "ui.cancelPlan":
			void adapter.cancelPlan(event.planId)
			break
		case "ui.skipPlanStep":
			void adapter.skipPlanStep(event.planId, event.stepId)
			break
		case "ui.regeneratePlanStep":
			void adapter.regeneratePlanStep(event.planId, event.stepId)
			break
		case "ui.editPlanStep":
			void adapter.editPlanStep(event.planId, event.stepId, event.description)
			break
		case "ui.setTheme":
			setKV("theme", event.theme)
			break
		case "ui.setMode":
			setKV("mode", event.mode)
			void adapter.setMode(event.mode)
			break
	}
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

async function loadRecentSessions(
	workspacePath: string,
): Promise<Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }>> {
	try {
		const entries = await readWorkspaceTaskSessions(workspacePath)
		return entries.slice(0, 10).map((entry) => ({
			id: entry.id,
			title: entry.task || entry.id,
			createdAt: entry.ts,
			updatedAt: entry.ts,
			messageCount: 0,
		}))
	} catch {
		return []
	}
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
