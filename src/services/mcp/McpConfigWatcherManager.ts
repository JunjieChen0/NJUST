import * as fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"

import { NJUST_AI_CONFIG_DIR, TelemetryEventName } from "@njust-ai/types"

import { t } from "../../i18n"
import { logger } from "../../shared/logger"
import { arePathsEqual } from "../../utils/path"
import { TIMING } from "../../shared/constants"
import { TelemetryService } from "@njust-ai/telemetry"

import { McpSettingsSchema } from "./McpHubConfigSchema"

export type McpSource = "global" | "project"

/** Callbacks and lookups the watcher manager needs from McpHub. */
export interface McpConfigWatcherHost {
	getWorkspaceFolderPath(): string | undefined
	getProjectMcpPath(): Promise<string | null>
	getMcpSettingsFilePath(): Promise<string>
	ensureProjectMcpTrusted(): Promise<boolean>
	updateServerConnections(
		servers: Record<string, unknown>,
		source: McpSource,
		manageConnectingState?: boolean,
	): Promise<void>
	deleteConnection(name: string, source: McpSource): Promise<void>
	getProjectConnectionNames(): string[]
	notifyWebviewOfServerChanges(): Promise<void>
	showErrorMessage(message: string, error: unknown): void
}

/**
 * Owns the global/project MCP config file watchers, their debounce timers, and the
 * programmatic-update suppression flag that keeps self-triggered writes from
 * restarting servers.
 */
export class McpConfigWatcherManager {
	private settingsWatcher?: vscode.FileSystemWatcher
	private projectMcpWatcher?: vscode.FileSystemWatcher
	private readonly debounceTimers = new Map<string, NodeJS.Timeout>()
	private readonly disposables: vscode.Disposable[] = []
	private isProgrammaticUpdate = false
	private flagResetTimer?: NodeJS.Timeout

	constructor(private readonly host: McpConfigWatcherHost) {}

	setupWorkspaceFoldersWatcher(): void {
		// Skip if test environment is detected
		if (process.env.NODE_ENV === "test") {
			return
		}

		this.disposables.push(
			vscode.workspace.onDidChangeWorkspaceFolders(async () => {
				await this.updateProjectMcpServers()
				await this.watchProjectMcpFile()
			}),
		)
	}

	async watchMcpSettingsFile(): Promise<void> {
		// Skip if test environment is detected or VSCode APIs are not available
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return
		}

		if (this.settingsWatcher) {
			this.settingsWatcher.dispose()
			this.settingsWatcher = undefined
		}

		const settingsPath = await this.host.getMcpSettingsFilePath()
		const settingsPattern = new vscode.RelativePattern(path.dirname(settingsPath), path.basename(settingsPath))

		this.settingsWatcher = vscode.workspace.createFileSystemWatcher(settingsPattern)

		const changeDisposable = this.settingsWatcher.onDidChange((uri) => {
			if (arePathsEqual(uri.fsPath, settingsPath)) {
				this.debounceConfigChange(settingsPath, "global")
			}
		})

		const createDisposable = this.settingsWatcher.onDidCreate((uri) => {
			if (arePathsEqual(uri.fsPath, settingsPath)) {
				this.debounceConfigChange(settingsPath, "global")
			}
		})

		this.disposables.push(vscode.Disposable.from(changeDisposable, createDisposable, this.settingsWatcher))
	}

	watchProjectMcpFile(): Promise<void> {
		// Skip if test environment is detected or VSCode APIs are not available
		if (process.env.NODE_ENV === "test" || !vscode.workspace.createFileSystemWatcher) {
			return Promise.resolve()
		}

		if (this.projectMcpWatcher) {
			this.projectMcpWatcher.dispose()
			this.projectMcpWatcher = undefined
		}

		if (!vscode.workspace.workspaceFolders?.length) {
			return Promise.resolve()
		}

		const workspaceFolder = this.host.getWorkspaceFolderPath()
		const projectMcpPattern = new vscode.RelativePattern(workspaceFolder!, `${NJUST_AI_CONFIG_DIR}/mcp.json`)

		this.projectMcpWatcher = vscode.workspace.createFileSystemWatcher(projectMcpPattern)

		const changeDisposable = this.projectMcpWatcher.onDidChange((uri) => {
			this.debounceConfigChange(uri.fsPath, "project")
		})

		const createDisposable = this.projectMcpWatcher.onDidCreate((uri) => {
			this.debounceConfigChange(uri.fsPath, "project")
		})

		const deleteDisposable = this.projectMcpWatcher.onDidDelete(async () => {
			await this.cleanupProjectMcpServers()
			await this.host.notifyWebviewOfServerChanges()
			vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"))
		})

		this.disposables.push(
			vscode.Disposable.from(changeDisposable, createDisposable, deleteDisposable, this.projectMcpWatcher),
		)

		return Promise.resolve()
	}

	setProgrammaticUpdateFlag(): void {
		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
		}
		this.isProgrammaticUpdate = true
	}

	scheduleProgrammaticUpdateFlagReset(): void {
		this.flagResetTimer = setTimeout(() => {
			this.isProgrammaticUpdate = false
			this.flagResetTimer = undefined
		}, 600)
	}

	dispose(): void {
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer)
		}
		this.debounceTimers.clear()

		if (this.flagResetTimer) {
			clearTimeout(this.flagResetTimer)
			this.flagResetTimer = undefined
		}

		this.isProgrammaticUpdate = false

		if (this.settingsWatcher) {
			this.settingsWatcher.dispose()
			this.settingsWatcher = undefined
		}

		if (this.projectMcpWatcher) {
			this.projectMcpWatcher.dispose()
			this.projectMcpWatcher = undefined
		}

		this.disposables.forEach((d) => d.dispose())
	}

	private debounceConfigChange(filePath: string, source: McpSource): void {
		// Skip processing if this is a programmatic update to prevent unnecessary server restarts
		if (this.isProgrammaticUpdate) {
			return
		}

		const key = `${source}-${filePath}`

		const existingTimer = this.debounceTimers.get(key)
		if (existingTimer) {
			clearTimeout(existingTimer)
		}

		const timer = setTimeout(async () => {
			this.debounceTimers.delete(key)
			await this.handleConfigFileChange(filePath, source)
		}, TIMING.MCP_CONFIG_CHANGE_DEBOUNCE_MS)

		this.debounceTimers.set(key, timer)
	}

	private async handleConfigFileChange(filePath: string, source: McpSource): Promise<void> {
		try {
			const content = await fs.readFile(filePath, "utf-8")
			let config: unknown

			try {
				config = JSON.parse(content)
			} catch (parseError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				logger.error("McpHub", errorMessage, parseError)
				TelemetryService.reportError(parseError, TelemetryEventName.MCP_ERROR)
				vscode.window.showErrorMessage(errorMessage)
				return
			}

			const result = McpSettingsSchema.safeParse(config)

			if (!result.success) {
				const errorMessages = result.error.issues
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))
				return
			}

			// For project MCP config, require workspace trust before starting servers.
			// This prevents malicious workspace configs from spawning subprocesses
			// via file watcher events without user consent.
			if (source === "project" && !(await this.host.ensureProjectMcpTrusted())) {
				return
			}

			await this.host.updateServerConnections(result.data.mcpServers || {}, source)
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT" && source === "project") {
				await this.cleanupProjectMcpServers()
				await this.host.notifyWebviewOfServerChanges()
				vscode.window.showInformationMessage(t("mcp:info.project_config_deleted"))
			} else {
				this.host.showErrorMessage(t("mcp:errors.failed_update_project"), error)
			}
		}
	}

	private async updateProjectMcpServers(): Promise<void> {
		try {
			const projectMcpPath = await this.host.getProjectMcpPath()
			if (!projectMcpPath) return

			const content = await fs.readFile(projectMcpPath, "utf-8")
			let config: unknown

			try {
				config = JSON.parse(content)
			} catch (parseError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				logger.error("McpHub", errorMessage, parseError)
				TelemetryService.reportError(parseError, TelemetryEventName.MCP_ERROR)
				vscode.window.showErrorMessage(errorMessage)
				return
			}

			const result = McpSettingsSchema.safeParse(config)

			if (result.success) {
				if (!(await this.host.ensureProjectMcpTrusted())) {
					return
				}
				await this.host.updateServerConnections(result.data.mcpServers || {}, "project")
			} else {
				const errorMessages = result.error.issues
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				logger.error("McpHub", "Invalid project MCP settings format:", errorMessages)
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))
			}
		} catch (error) {
			this.host.showErrorMessage(t("mcp:errors.failed_update_project"), error)
		}
	}

	private async cleanupProjectMcpServers(): Promise<void> {
		for (const name of this.host.getProjectConnectionNames()) {
			await this.host.deleteConnection(name, "project")
		}

		await this.host.updateServerConnections({}, "project", false)
	}
}
