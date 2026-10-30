import * as fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import type { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { ListResourceTemplatesResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"

import {
	type McpResource,
	type McpResourceResponse,
	type McpResourceTemplate,
	type McpServer,
	type McpTool,
	type McpToolCallResponse,
	TelemetryEventName,
	NJUST_AI_CONFIG_DIR,
} from "@njust-ai/types"

import { t } from "../../i18n"

import type { IMcpHubClient } from "./interfaces/IMcpHubClient"
import type { IMcpHubService } from "./interfaces/IMcpHubService"

import { GlobalFileNames } from "../../shared/globalFileNames"

import { fileExistsAtPath } from "../../utils/fs"
import { getWorkspacePath } from "../../utils/path"
import { sanitizeMcpName, toolNamesMatch } from "../../utils/mcp-name"
import { logger } from "../../shared/logger"
import { TelemetryService } from "@njust-ai/telemetry"
import { getErrorMessage } from "../../shared/error-utils"
import { appendErrorMessageToConnection, connectToServerWithHub } from "./McpHubConnection"
import {
	deleteServerWithHub,
	readServerConfigFromFileWithHub,
	toggleServerDisabledWithHub,
	updateServerConfigWithHub,
	updateServerTimeoutWithHub,
} from "./McpHubConfigPersistence"
import {
	fetchResourcesListWithHub,
	fetchToolsListWithHub,
	toggleToolAlwaysAllowWithHub,
	toggleToolEnabledForPromptWithHub,
	updateServerToolListWithHub,
} from "./McpHubToolPermissions"
import {
	McpSettingsSchema,
	ServerConfigSchema,
	validateServerConfig as validateServerConfigStandalone,
} from "./McpHubConfigSchema"
import { McpHubFileWatcherManager } from "./McpHubFileWatcherManager"
import { callToolWithHub, readResourceWithHub } from "./McpHubToolCalls"
import { refreshToolsWithHub } from "./McpHubToolRefresh"
import { McpConfigWatcherManager } from "./McpConfigWatcherManager"
import {
	type McpConnectionLifecycleHost,
	refreshAllConnectionsWithHub,
	restartConnectionWithHub,
	updateServerConnectionsWithHub,
} from "./McpHubConnectionLifecycle"
import {
	isWorkspaceTrusted,
	promptUserToTrustMcpServers as promptTrustPrompt,
	TRUSTED_WORKSPACES_FILE_NAME,
	trustWorkspace,
} from "./McpWorkspaceTrust"

// Discriminated union for connection states
export type ConnectedMcpConnection = {
	type: "connected"
	server: McpServer
	client: Client
	transport: StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport
}

export type DisconnectedMcpConnection = {
	type: "disconnected"
	server: McpServer
	client: null
	transport: null
}

export type McpConnection = ConnectedMcpConnection | DisconnectedMcpConnection

/** Narrow interface for hub operations used by extracted helper modules. */
export interface McpHubInternal {
	connections: McpConnection[]
	sanitizedNameRegistry: Map<string, string>
	providerRef: { deref(): { getExtensionPackageVersion(): string } | undefined }
	isMcpEnabled(): Promise<boolean>
	deleteConnection(name: string, source?: "global" | "project"): Promise<void>
	findConnection(serverName: string, source?: "global" | "project"): McpConnection | undefined
	createPlaceholderConnection(name: string, config: unknown, source: string, reason: string): McpConnection
	setupFileWatcher(name: string, config: unknown, source: string): void
	removeFileWatchersForServer(serverName: string): void
	connectToServer(name: string, config: unknown, source?: "global" | "project"): Promise<void>
	notifyWebviewOfServerChanges(): Promise<void>
	fetchToolsList(name: string, source?: string): Promise<McpTool[]>
	fetchResourcesList(name: string, source?: string): Promise<McpResource[]>
	fetchResourceTemplatesList(name: string, source?: string): Promise<McpResourceTemplate[]>
	showErrorMessage(message: string, error: unknown): void
	getProjectMcpPath(): Promise<string>
	getMcpSettingsFilePath(): Promise<string>
	validateServerConfig(config: unknown, serverName: string): { valid: boolean; message?: string }
	setProgrammaticUpdateFlag(): void
	scheduleProgrammaticUpdateFlagReset(): void
	updateServerConnections(servers: Record<string, unknown>, source: "global" | "project"): Promise<void>
}

// Enum for disable reasons
export enum DisableReason {
	MCP_DISABLED = "mcpDisabled",
	SERVER_DISABLED = "serverDisabled",
}

// Re-export for backward compatibility
export { ServerConfigSchema } from "./McpHubConfigSchema"

export class McpHub implements IMcpHubService {
	private providerRef: WeakRef<IMcpHubClient>
	private fileWatcherManager = new McpHubFileWatcherManager()
	private isDisposed: boolean = false
	connections: McpConnection[] = []
	isConnecting: boolean = false
	private refCount: number = 0 // Reference counter for active clients
	private sanitizedNameRegistry: Map<string, string> = new Map()

	private readonly configWatchers = new McpConfigWatcherManager({
		getWorkspaceFolderPath: () => this.providerRef.deref()?.cwd ?? getWorkspacePath(),
		getProjectMcpPath: () => this.getProjectMcpPath(),
		getMcpSettingsFilePath: () => this.getMcpSettingsFilePath(),
		ensureProjectMcpTrusted: () => this.ensureProjectMcpTrusted(),
		updateServerConnections: (servers, source, manageConnectingState) =>
			this.updateServerConnections(servers, source, manageConnectingState),
		deleteConnection: (name, source) => this.deleteConnection(name, source),
		getProjectConnectionNames: () =>
			this.connections.filter((c) => c.server.source === "project").map((c) => c.server.name),
		notifyWebviewOfServerChanges: () => this.notifyWebviewOfServerChanges(),
		showErrorMessage: (message, error) => this.showErrorMessage(message, error),
	})
	private initializationPromise: Promise<void>

	constructor(provider: IMcpHubClient) {
		this.providerRef = new WeakRef(provider)
		void this.configWatchers.watchMcpSettingsFile()
		this.configWatchers.watchProjectMcpFile().catch((err: unknown) => {
			logger.error("McpHub", "watchProjectMcpFile failed:", err)
			TelemetryService.reportError(err, TelemetryEventName.MCP_ERROR)
		})
		this.configWatchers.setupWorkspaceFoldersWatcher()
		// Only global MCP servers are auto-started. Project-level MCP servers
		// (.njust_ai/mcp.json) require explicit user action — prevents malicious
		// workspace configs from spawning subprocesses on open.
		this.initializationPromise = this.initializeGlobalMcpServers()
	}

	/**
	 * Waits until all MCP servers have finished their initial connection attempts.
	 * Each server individually handles its own timeout, so this will not block indefinitely.
	 */
	async waitUntilReady(): Promise<void> {
		await this.initializationPromise
	}
	/**
	 * Registers a client (e.g., ClineProvider) using this hub.
	 * Increments the reference count.
	 *
	 * Guarded against double-registration: a client that registers twice without
	 * unregistering in between is a programming error, but clamping keeps the
	 * count meaningful rather than letting dispose-on-zero fire prematurely.
	 */
	public registerClient(): void {
		this.refCount++
	}

	/**
	 * Unregisters a client. Decrements the reference count.
	 * If the count reaches zero, disposes the hub.
	 *
	 * Guarded against over-decrement: once the hub is disposing/disposed the
	 * count is clamped at zero so redundant unregister calls (e.g. from a retry
	 * path) cannot drive it negative and trigger a second dispose.
	 */
	public async unregisterClient(): Promise<void> {
		if (this.refCount <= 0 || this.isDisposed) {
			// Already at zero (or disposing) — ignore the redundant unregister
			// rather than letting the count go negative.
			return
		}
		this.refCount--

		if (this.refCount <= 0) {
			logger.info("McpHub", "Last client unregistered. Disposing hub.")
			await this.dispose()
		}
	}

	/**
	 * Validates and normalizes server configuration
	 * @param config The server configuration to validate
	 * @param serverName Optional server name for error messages
	 * @returns The validated configuration
	 * @throws Error if the configuration is invalid
	 */
	private validateServerConfig(config: unknown, serverName?: string): z.infer<typeof ServerConfigSchema> {
		return validateServerConfigStandalone(config as Record<string, unknown>, serverName)
	}

	/**
	 * Formats and displays error messages to the user
	 * @param message The error message prefix
	 * @param error The error object
	 */
	private showErrorMessage(message: string, error: unknown): void {
		logger.error("McpHub", `${message}:`, error)
	}

	setProgrammaticUpdateFlag(): void {
		this.configWatchers.setProgrammaticUpdateFlag()
	}

	scheduleProgrammaticUpdateFlagReset(): void {
		this.configWatchers.scheduleProgrammaticUpdateFlagReset()
	}

	public setupWorkspaceFoldersWatcher(): void {
		this.configWatchers.setupWorkspaceFoldersWatcher()
	}

	/**
	 * Debounced wrapper for handling config file changes
	 */
	getServers(): McpServer[] {
		// Only return enabled servers, deduplicating by name with project servers taking priority
		const enabledConnections = this.connections.filter((conn) => !conn.server.disabled)

		// Deduplicate by server name: project servers take priority over global servers
		const serversByName = new Map<string, McpServer>()
		for (const conn of enabledConnections) {
			const existing = serversByName.get(conn.server.name)
			if (!existing) {
				serversByName.set(conn.server.name, conn.server)
			} else if (conn.server.source === "project" && existing.source !== "project") {
				// Project server overrides global server with the same name
				serversByName.set(conn.server.name, conn.server)
			}
			// If existing is project and current is global, keep existing (project wins)
		}

		return Array.from(serversByName.values())
	}

	getAllServers(): McpServer[] {
		// Return all servers regardless of state
		return this.connections.map((conn) => conn.server)
	}

	async getMcpServersPath(): Promise<string> {
		const provider = this.providerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpServersPath = await provider.ensureMcpServersDirectoryExists()
		return mcpServersPath
	}

	async getMcpSettingsFilePath(): Promise<string> {
		const provider = this.providerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const mcpSettingsFilePath = path.join(
			await provider.ensureSettingsDirectoryExists(),
			GlobalFileNames.mcpSettings,
		)
		const fileExists = await fileExistsAtPath(mcpSettingsFilePath)
		if (!fileExists) {
			await fs.writeFile(
				mcpSettingsFilePath,
				`{
  "mcpServers": {

  }
}`,
			)
		}
		return mcpSettingsFilePath
	}

	private async initializeMcpServers(source: "global" | "project"): Promise<void> {
		try {
			const configPath =
				source === "global" ? await this.getMcpSettingsFilePath() : await this.getProjectMcpPath()

			if (!configPath) {
				return
			}

			// For project-level MCP config, require user confirmation before auto-starting
			// any subprocesses — prevents malicious .njust_ai/mcp.json from spawning processes
			// when a workspace is first opened.
			if (source === "project" && !(await this.ensureProjectMcpTrusted())) {
				return
			}

			const content = await fs.readFile(configPath, "utf-8")
			const config = JSON.parse(content)
			const result = McpSettingsSchema.safeParse(config)

			if (result.success) {
				// Pass all servers including disabled ones - they'll be handled in updateServerConnections
				await this.updateServerConnections(result.data.mcpServers || {}, source, false)
			} else {
				const errorMessages = result.error.issues
					.map((err) => `${err.path.join(".")}: ${err.message}`)
					.join("\n")
				logger.error("McpHub", `Invalid ${source} MCP settings format:`, errorMessages)
				vscode.window.showErrorMessage(t("mcp:errors.invalid_settings_validation", { errorMessages }))

				if (source === "global") {
					// Still try to connect with the raw config, but show warnings
					try {
						await this.updateServerConnections(config.mcpServers || {}, source, false)
					} catch (error) {
						this.showErrorMessage(`Failed to initialize ${source} MCP servers with raw config`, error)
						TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
					}
				}
			}
		} catch (error) {
			if (error instanceof SyntaxError) {
				const errorMessage = t("mcp:errors.invalid_settings_syntax")
				logger.error("McpHub", errorMessage, error)
				vscode.window.showErrorMessage(errorMessage)
			} else {
				this.showErrorMessage(`Failed to initialize ${source} MCP servers`, error)
			}
			TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
		}
	}

	private async initializeGlobalMcpServers(): Promise<void> {
		await this.initializeMcpServers("global")
	}

	// Get project-level MCP configuration path
	private async getProjectMcpPath(): Promise<string | null> {
		const workspacePath = this.providerRef.deref()?.cwd ?? getWorkspacePath()
		const projectMcpDir = path.join(workspacePath, NJUST_AI_CONFIG_DIR)
		const projectMcpPath = path.join(projectMcpDir, "mcp.json")

		try {
			await fs.access(projectMcpPath)
			return projectMcpPath
		} catch (error) {
			// ENOENT (file not found) is expected — project config may not exist yet
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				logger.warn("McpHub", `Unexpected error accessing project MCP config at ${projectMcpPath}:`, error)
			}
			return null
		}
	}

	// Initialize project-level MCP servers
	private async initializeProjectMcpServers(): Promise<void> {
		await this.initializeMcpServers("project")
	}

	// ── Workspace trust for project MCP ────────────────────────────

	/**
	 * Path to the file that tracks which workspaces the user has trusted
	 * for auto-starting project-level MCP servers.
	 */
	private async getTrustedWorkspacesFilePath(): Promise<string> {
		const provider = this.providerRef.deref()
		if (!provider) {
			throw new Error("Provider not available")
		}
		const dir = await provider.ensureMcpServersDirectoryExists()
		return path.join(dir, TRUSTED_WORKSPACES_FILE_NAME)
	}

	/**
	 * Ensure the current workspace is trusted for project-level MCP auto-start.
	 * Returns true if already trusted or the user just accepted the prompt;
	 * returns false if the user declined (caller should skip server startup).
	 */
	private async ensureProjectMcpTrusted(): Promise<boolean> {
		const workspacePath = this.providerRef.deref()?.cwd ?? getWorkspacePath()
		if (await this.isWorkspaceTrustedForMcp(workspacePath)) {
			return true
		}
		const trusted = await this.promptUserToTrustMcpServers()
		if (!trusted) {
			logger.info("McpHub", "User declined to start project MCP servers")
			return false
		}
		await this.trustWorkspaceForMcp(workspacePath)
		return true
	}

	/**
	 * Returns true if the user has previously confirmed that MCP servers
	 * in this workspace may be auto-started.
	 */
	private async isWorkspaceTrustedForMcp(workspacePath: string): Promise<boolean> {
		return isWorkspaceTrusted(await this.getTrustedWorkspacesFilePath(), workspacePath)
	}

	/**
	 * Records that the user has trusted this workspace for project-level MCP auto-start.
	 */
	private async trustWorkspaceForMcp(workspacePath: string): Promise<void> {
		return trustWorkspace(await this.getTrustedWorkspacesFilePath(), workspacePath)
	}

	/**
	 * Shows a warning dialog asking the user whether to enable project-level MCP servers.
	 * Returns true if the user accepted.
	 */
	private async promptUserToTrustMcpServers(): Promise<boolean> {
		return promptTrustPrompt()
	}

	/**
	 * Creates a placeholder connection for disabled servers or when MCP is globally disabled
	 * @param name The server name
	 * @param config The server configuration
	 * @param source The source of the server (global or project)
	 * @param reason The reason for creating a placeholder (mcpDisabled or serverDisabled)
	 * @returns A placeholder DisconnectedMcpConnection object
	 */
	private createPlaceholderConnection(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project",
		reason: DisableReason,
	): DisconnectedMcpConnection {
		return {
			type: "disconnected",
			server: {
				name,
				config: JSON.stringify(config),
				status: "disconnected",
				disabled: reason === DisableReason.SERVER_DISABLED ? true : config.disabled,
				source,
				projectPath: source === "project" ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath : undefined,
				errorHistory: [],
			},
			client: null,
			transport: null,
		}
	}

	/**
	 * Checks if MCP is globally enabled
	 * @returns Promise<boolean> indicating if MCP is enabled
	 */
	private async isMcpEnabled(): Promise<boolean> {
		const provider = this.providerRef.deref()
		if (!provider) {
			return true // Default to enabled if provider is not available
		}
		const state = await provider.getState()
		return state.mcpEnabled ?? true
	}

	private async connectToServer(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project" = "global",
	): Promise<void> {
		return connectToServerWithHub(this as unknown as McpHubInternal, name, config, source)
	}
	private appendErrorMessage(connection: McpConnection, error: string, level: "error" | "warn" | "info" = "error") {
		appendErrorMessageToConnection(connection, error, level)
	}

	/**
	 * Helper method to find a connection by server name and source
	 * @param serverName The name of the server to find
	 * @param source Optional source to filter by (global or project)
	 * @returns The matching connection or undefined if not found
	 */
	public findConnection(serverName: string, source?: "global" | "project"): McpConnection | undefined {
		// If source is specified, only find servers with that source
		if (source !== undefined) {
			return this.connections.find((conn) => conn.server.name === serverName && conn.server.source === source)
		}

		// If no source is specified, first look for project servers, then global servers
		// This ensures that when servers have the same name, project servers are prioritized
		const projectConn = this.connections.find(
			(conn) => conn.server.name === serverName && conn.server.source === "project",
		)
		if (projectConn) return projectConn

		// If no project server is found, look for global servers
		return this.connections.find(
			(conn) => conn.server.name === serverName && (conn.server.source === "global" || !conn.server.source),
		)
	}

	/**
	 * Find a connection by sanitized server name.
	 * This is used when parsing MCP tool responses where the server name has been
	 * sanitized (e.g., hyphens replaced with underscores) for API compliance.
	 * Uses fuzzy matching to handle cases where models convert hyphens to underscores.
	 * @param sanitizedServerName The sanitized server name from the API tool call
	 * @returns The original server name if found, or null if no match
	 */
	public findServerNameBySanitizedName(sanitizedServerName: string): string | null {
		// First, check for an exact match
		const exactMatch = this.connections.find((conn) => conn.server.name === sanitizedServerName)
		if (exactMatch) {
			return exactMatch.server.name
		}

		// Check the registry for sanitized name mapping
		const registryMatch = this.sanitizedNameRegistry.get(sanitizedServerName)
		if (registryMatch) {
			return registryMatch
		}

		// Use fuzzy matching: treat hyphens and underscores as equivalent
		const fuzzyMatch = this.connections.find((conn) => toolNamesMatch(conn.server.name, sanitizedServerName))
		if (fuzzyMatch) {
			return fuzzyMatch.server.name
		}

		return null
	}

	public async fetchToolsList(serverName: string, source?: "global" | "project"): Promise<McpTool[]> {
		return fetchToolsListWithHub(this as unknown as McpHubInternal, serverName, source)
	}

	private async fetchResourcesList(serverName: string, source?: "global" | "project"): Promise<McpResource[]> {
		return fetchResourcesListWithHub(this as unknown as McpHubInternal, serverName, source)
	}
	private async fetchResourceTemplatesList(
		serverName: string,
		source?: "global" | "project",
	): Promise<McpResourceTemplate[]> {
		try {
			const connection = this.findConnection(serverName, source)
			if (!connection || connection.type !== "connected") {
				return []
			}
			const response = await connection.client.request(
				{ method: "resources/templates/list" },
				ListResourceTemplatesResultSchema,
			)
			return response?.resourceTemplates || []
		} catch (error) {
			logger.warn("McpHub", `Failed to fetch resource templates from ${serverName}:`, error)
			TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
			return []
		}
	}

	/**
	 * Refresh the tool list for one or all connected MCP servers without
	 * tearing down the transport/client connections.
	 *
	 * Use cases:
	 *   - A server dynamically registers new tools after initial handshake
	 *   - The user changes alwaysAllow / disabledTools in config
	 *   - An external process signals that a server's tool surface changed
	 *
	 * After refreshing, the webview is notified so the UI updates.
	 *
	 * @param serverName  Optional — refresh only this server. When omitted,
	 *                    all connected servers are refreshed.
	 * @returns Map of server names to their refreshed tool counts.
	 */
	async refreshTools(serverName?: string): Promise<Map<string, number>> {
		return refreshToolsWithHub(this, serverName)
	}

	async deleteConnection(name: string, source?: "global" | "project"): Promise<void> {
		// Clean up file watchers for this server
		this.removeFileWatchersForServer(name)

		// If source is provided, only delete connections from that source
		const connections = source
			? this.connections.filter((conn) => conn.server.name === name && conn.server.source === source)
			: this.connections.filter((conn) => conn.server.name === name)

		for (const connection of connections) {
			try {
				if (connection.type === "connected") {
					await connection.transport.close()
					await connection.client.close()
				}
			} catch (error) {
				logger.error("McpHub", `Failed to close transport for ${name}:`, error)
				TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
			}
		}

		// Remove the connections from the array
		this.connections = this.connections.filter((conn) => {
			if (conn.server.name !== name) return true
			if (source && conn.server.source !== source) return true
			return false
		})

		// Remove from sanitized name registry if no more connections with this name exist
		const remainingConnections = this.connections.filter((conn) => conn.server.name === name)
		if (remainingConnections.length === 0) {
			const sanitizedName = sanitizeMcpName(name)
			this.sanitizedNameRegistry.delete(sanitizedName)
		}
	}

	private get connectionLifecycleHost(): McpConnectionLifecycleHost {
		return {
			getConnections: () => this.connections,
			getIsConnecting: () => this.isConnecting,
			setIsConnecting: (value: boolean) => {
				this.isConnecting = value
			},
			isMcpEnabled: () => this.isMcpEnabled(),
			deleteConnection: (name, source) => this.deleteConnection(name, source),
			findConnection: (name, source) => this.findConnection(name, source),
			validateServerConfig: (config, name) => this.validateServerConfig(config, name),
			showErrorMessage: (message, error) => this.showErrorMessage(message, error),
			setupFileWatcher: (name, config, source) => this.setupFileWatcher(name, config, source),
			removeAllFileWatchers: () => this.removeAllFileWatchers(),
			connectToServer: (name, config, source) => this.connectToServer(name, config, source),
			notifyWebviewOfServerChanges: () => this.notifyWebviewOfServerChanges(),
			initializeMcpServers: (source) => this.initializeMcpServers(source),
			getMcpSettingsFilePath: () => this.getMcpSettingsFilePath(),
			getProjectMcpPath: () => this.getProjectMcpPath(),
		}
	}

	async updateServerConnections(
		newServers: Record<string, unknown>,
		source: "global" | "project" = "global",
		manageConnectingState: boolean = true,
	): Promise<void> {
		return updateServerConnectionsWithHub(this.connectionLifecycleHost, newServers, source, manageConnectingState)
	}

	private setupFileWatcher(
		name: string,
		config: z.infer<typeof ServerConfigSchema>,
		source: "global" | "project" = "global",
	) {
		this.fileWatcherManager.setupFileWatcher(name, config, source, (serverName, src) =>
			this.restartConnection(serverName, src),
		)
	}

	private removeAllFileWatchers() {
		this.fileWatcherManager.removeAll()
	}

	private removeFileWatchersForServer(serverName: string) {
		this.fileWatcherManager.removeForServer(serverName)
	}

	async restartConnection(serverName: string, source?: "global" | "project"): Promise<void> {
		return restartConnectionWithHub(this.connectionLifecycleHost, serverName, source)
	}

	public async refreshAllConnections(): Promise<void> {
		return refreshAllConnectionsWithHub(this.connectionLifecycleHost)
	}

	public async notifyWebviewOfServerChanges(): Promise<void> {
		// Get global server order from settings file
		const settingsPath = await this.getMcpSettingsFilePath()
		const content = await fs.readFile(settingsPath, "utf-8")
		const config = JSON.parse(content)
		const globalServerOrder = Object.keys(config.mcpServers || {})

		// Get project server order if available
		const projectMcpPath = await this.getProjectMcpPath()
		let projectServerOrder: string[] = []
		if (projectMcpPath) {
			try {
				const projectContent = await fs.readFile(projectMcpPath, "utf-8")
				const projectConfig = JSON.parse(projectContent)
				projectServerOrder = Object.keys(projectConfig.mcpServers || {})
			} catch (error) {
				logger.warn("McpHub", "Error reading project MCP config for server ordering:", error)
				TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
			}
		}

		// Sort connections: first project servers in their defined order, then global servers in their defined order
		// This ensures that when servers have the same name, project servers are prioritized
		const sortedConnections = [...this.connections].sort((a, b) => {
			const aIsGlobal = a.server.source === "global" || !a.server.source
			const bIsGlobal = b.server.source === "global" || !b.server.source

			// If both are global or both are project, sort by their respective order
			if (aIsGlobal && bIsGlobal) {
				const indexA = globalServerOrder.indexOf(a.server.name)
				const indexB = globalServerOrder.indexOf(b.server.name)
				return indexA - indexB
			} else if (!aIsGlobal && !bIsGlobal) {
				const indexA = projectServerOrder.indexOf(a.server.name)
				const indexB = projectServerOrder.indexOf(b.server.name)
				return indexA - indexB
			}

			// Project servers come before global servers (reversed from original)
			return aIsGlobal ? 1 : -1
		})

		// Send sorted servers to webview
		const targetClient = this.providerRef.deref()

		if (targetClient) {
			const serversToSend = sortedConnections.map((connection) => connection.server)

			try {
				await targetClient.onMcpServersUpdated(serversToSend)
			} catch (error) {
				logger.error("McpHub", "Error calling onMcpServersUpdated:", error)
				TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
			}
		} else {
			logger.error(
				"McpHub",
				"No target provider available (neither from getInstance nor providerRef) - cannot send mcpServers message to webview",
			)
		}
	}

	public async toggleServerDisabled(
		serverName: string,
		disabled: boolean,
		source?: "global" | "project",
	): Promise<void> {
		return toggleServerDisabledWithHub(this as unknown as McpHubInternal, serverName, disabled, source)
	}

	/**
	 * Helper method to read a server's configuration from the appropriate settings file
	 * @param serverName The name of the server to read
	 * @param source Whether to read from the global or project config
	 * @returns The validated server configuration
	 */
	private async readServerConfigFromFile(
		serverName: string,
		source: "global" | "project" = "global",
	): Promise<z.infer<typeof ServerConfigSchema>> {
		return readServerConfigFromFileWithHub(this as unknown as McpHubInternal, serverName, source)
	}

	/**
	 * Helper method to update a server's configuration in the appropriate settings file
	 * @param serverName The name of the server to update
	 * @param configUpdate The configuration updates to apply
	 * @param source Whether to update the global or project config
	 */
	private async updateServerConfig(
		serverName: string,
		configUpdate: Record<string, unknown>,
		source: "global" | "project" = "global",
	): Promise<void> {
		return updateServerConfigWithHub(this as unknown as McpHubInternal, serverName, configUpdate, source)
	}

	public async updateServerTimeout(
		serverName: string,
		timeout: number,
		source?: "global" | "project",
	): Promise<void> {
		return updateServerTimeoutWithHub(this as unknown as McpHubInternal, serverName, timeout, source)
	}

	public async deleteServer(serverName: string, source?: "global" | "project"): Promise<void> {
		return deleteServerWithHub(this as unknown as McpHubInternal, serverName, source)
	}
	async readResource(serverName: string, uri: string, source?: "global" | "project"): Promise<McpResourceResponse> {
		return readResourceWithHub(this, serverName, uri, source)
	}

	async callTool(
		serverName: string,
		toolName: string,
		toolArguments?: Record<string, unknown>,
		source?: "global" | "project",
	): Promise<McpToolCallResponse> {
		return callToolWithHub(this, serverName, toolName, toolArguments, source)
	}

	/**
	 * Helper method to update a specific tool list (alwaysAllow or disabledTools)
	 * in the appropriate settings file.
	 * @param serverName The name of the server to update
	 * @param source Whether to update the global or project config
	 * @param toolName The name of the tool to add or remove
	 * @param listName The name of the list to modify ("alwaysAllow" or "disabledTools")
	 * @param addTool Whether to add (true) or remove (false) the tool from the list
	 */
	private async updateServerToolList(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		listName: "alwaysAllow" | "disabledTools",
		addTool: boolean,
	): Promise<void> {
		return updateServerToolListWithHub(this, serverName, source, toolName, listName, addTool)
	}

	async toggleToolAlwaysAllow(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		shouldAllow: boolean,
	): Promise<void> {
		return toggleToolAlwaysAllowWithHub(this, serverName, source, toolName, shouldAllow)
	}

	async toggleToolEnabledForPrompt(
		serverName: string,
		source: "global" | "project",
		toolName: string,
		isEnabled: boolean,
	): Promise<void> {
		return toggleToolEnabledForPromptWithHub(this, serverName, source, toolName, isEnabled)
	}
	/**
	 * Handles enabling/disabling MCP globally
	 * @param enabled Whether MCP should be enabled or disabled
	 * @returns Promise<void>
	 */
	async handleMcpEnabledChange(enabled: boolean): Promise<void> {
		if (!enabled) {
			// If MCP is being disabled, disconnect all servers with error handling
			const existingConnections = [...this.connections]
			const disconnectionErrors: Array<{ serverName: string; error: string }> = []

			for (const conn of existingConnections) {
				try {
					await this.deleteConnection(conn.server.name, conn.server.source)
				} catch (error) {
					const errorMessage = getErrorMessage(error)
					disconnectionErrors.push({
						serverName: conn.server.name,
						error: errorMessage,
					})
					logger.error("McpHub", `Failed to disconnect MCP server ${conn.server.name}: ${errorMessage}`)
					TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
				}
			}

			// If there were errors, notify the user
			if (disconnectionErrors.length > 0) {
				const errorSummary = disconnectionErrors.map((e) => `${e.serverName}: ${e.error}`).join("\n")
				vscode.window.showWarningMessage(
					t("mcp:errors.disconnect_servers_partial", {
						count: disconnectionErrors.length,
						errors: errorSummary,
					}),
				)
			}

			// Re-initialize servers to track them in disconnected state
			try {
				await this.refreshAllConnections()
			} catch (error) {
				logger.error("McpHub", `Failed to refresh MCP connections after disabling: ${error}`)
				TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
				vscode.window.showErrorMessage(t("mcp:errors.refresh_after_disable"))
			}
		} else {
			// If MCP is being enabled, reconnect all servers
			try {
				await this.refreshAllConnections()
			} catch (error) {
				logger.error("McpHub", `Failed to refresh MCP connections after enabling: ${error}`)
				TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
				vscode.window.showErrorMessage(t("mcp:errors.refresh_after_enable"))
			}
		}
	}

	async dispose(): Promise<void> {
		// Prevent multiple disposals
		if (this.isDisposed) {
			return
		}

		this.isDisposed = true

		this.configWatchers.dispose()
		this.removeAllFileWatchers()

		for (const connection of this.connections) {
			try {
				await this.deleteConnection(connection.server.name, connection.server.source)
			} catch (error) {
				logger.error("McpHub", `Failed to close connection for ${connection.server.name}:`, error)
				TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
			}
		}

		this.connections = []

		this.configWatchers.dispose()
	}
}
