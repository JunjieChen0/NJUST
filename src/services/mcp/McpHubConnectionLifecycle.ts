import deepEqual from "fast-deep-equal"
import delay from "delay"
import * as fs from "fs/promises"

import * as vscode from "vscode"
import type { z } from "zod"

import { TelemetryEventName } from "@njust-ai/types"

import { t } from "../../i18n"
import { logger } from "../../shared/logger"
import { TelemetryService } from "@njust-ai/telemetry"

import type { ServerConfigSchema } from "./McpHubConfigSchema"

export type McpSource = "global" | "project"
export type McpServerConfig = z.infer<typeof ServerConfigSchema>

/** Minimal structural view of a hub connection used by the lifecycle helpers. */
export interface McpLifecycleConnection {
	type: "connected" | "disconnected"
	server: {
		name: string
		source?: McpSource
		config: string
		disabled?: boolean
		status?: string
		error?: string
	}
}

/** Everything the connection lifecycle needs, supplied by McpHub through an adapter. */
export interface McpConnectionLifecycleHost {
	getConnections(): McpLifecycleConnection[]
	getIsConnecting(): boolean
	setIsConnecting(value: boolean): void
	isMcpEnabled(): Promise<boolean>
	deleteConnection(name: string, source?: McpSource): Promise<void>
	findConnection(name: string, source?: McpSource): McpLifecycleConnection | undefined
	validateServerConfig(config: unknown, serverName?: string): McpServerConfig
	showErrorMessage(message: string, error: unknown): void
	setupFileWatcher(name: string, config: McpServerConfig, source: McpSource): void
	removeAllFileWatchers(): void
	connectToServer(name: string, config: McpServerConfig, source?: McpSource): Promise<void>
	notifyWebviewOfServerChanges(): Promise<void>
	initializeMcpServers(source: McpSource): Promise<void>
	getMcpSettingsFilePath(): Promise<string>
	getProjectMcpPath(): Promise<string | null>
}

/** Reconciles existing connections with a new server map for one source. */
export async function updateServerConnectionsWithHub(
	hub: McpConnectionLifecycleHost,
	newServers: Record<string, unknown>,
	source: McpSource = "global",
	manageConnectingState: boolean = true,
): Promise<void> {
	if (manageConnectingState) {
		hub.setIsConnecting(true)
	}

	hub.removeAllFileWatchers()

	const currentConnections = hub
		.getConnections()
		.filter((conn) => conn.server.source === source || (!conn.server.source && source === "global"))
	const currentNames = new Set(currentConnections.map((conn) => conn.server.name))
	const newNames = new Set(Object.keys(newServers))

	for (const name of currentNames) {
		if (!newNames.has(name)) {
			await hub.deleteConnection(name, source)
		}
	}

	for (const [name, config] of Object.entries(newServers)) {
		const currentConnection = hub.findConnection(name, source)

		let validatedConfig: McpServerConfig
		try {
			validatedConfig = hub.validateServerConfig(config, name)
		} catch (error) {
			hub.showErrorMessage(`Invalid configuration for MCP server "${name}"`, error)
			continue
		}

		if (!currentConnection) {
			try {
				if (!validatedConfig.disabled) {
					hub.setupFileWatcher(name, validatedConfig, source)
				}
				await hub.connectToServer(name, validatedConfig, source)
			} catch (error) {
				hub.showErrorMessage(`Failed to connect to new MCP server ${name}`, error)
			}
		} else if (!deepEqual(JSON.parse(currentConnection.server.config), config)) {
			try {
				if (!validatedConfig.disabled) {
					hub.setupFileWatcher(name, validatedConfig, source)
				}
				await hub.deleteConnection(name, source)
				await hub.connectToServer(name, validatedConfig, source)
			} catch (error) {
				hub.showErrorMessage(`Failed to reconnect MCP server ${name}`, error)
			}
		}
	}

	await hub.notifyWebviewOfServerChanges()

	if (manageConnectingState) {
		hub.setIsConnecting(false)
	}
}

/** Tears down and re-creates a single server connection. */
export async function restartConnectionWithHub(
	hub: McpConnectionLifecycleHost,
	serverName: string,
	source?: McpSource,
): Promise<void> {
	hub.setIsConnecting(true)

	const mcpEnabled = await hub.isMcpEnabled()

	if (!mcpEnabled) {
		hub.setIsConnecting(false)
		return
	}

	const connection = hub.findConnection(serverName, source)
	const config = connection?.server.config

	if (config) {
		vscode.window.showInformationMessage(t("mcp:info.server_restarting", { serverName }))
		connection.server.status = "connecting"
		connection.server.error = ""
		await hub.notifyWebviewOfServerChanges()
		await delay(500) // artificial delay to show user that server is restarting

		try {
			await hub.deleteConnection(serverName, connection.server.source)
			const parsedConfig = JSON.parse(config)

			try {
				const validatedConfig = hub.validateServerConfig(parsedConfig, serverName)
				await hub.connectToServer(serverName, validatedConfig, connection.server.source || "global")
				vscode.window.showInformationMessage(t("mcp:info.server_connected", { serverName }))
			} catch (validationError) {
				hub.showErrorMessage(`Invalid configuration for MCP server "${serverName}"`, validationError)
			}
		} catch (error) {
			hub.showErrorMessage(`Failed to restart ${serverName} MCP server connection`, error)
		}
	}

	await hub.notifyWebviewOfServerChanges()
	hub.setIsConnecting(false)
}

/** Reloads all servers from disk, or clears connections when MCP is disabled. */
export async function refreshAllConnectionsWithHub(hub: McpConnectionLifecycleHost): Promise<void> {
	if (hub.getIsConnecting()) {
		return
	}

	const mcpEnabled = await hub.isMcpEnabled()

	if (!mcpEnabled) {
		const existingConnections = [...hub.getConnections()]

		for (const conn of existingConnections) {
			await hub.deleteConnection(conn.server.name, conn.server.source)
		}

		await hub.initializeMcpServers("global")
		await hub.initializeMcpServers("project")
		await hub.notifyWebviewOfServerChanges()
		return
	}

	hub.setIsConnecting(true)

	try {
		const globalPath = await hub.getMcpSettingsFilePath()
		let _globalServers: Record<string, unknown> = {}

		try {
			const globalContent = await fs.readFile(globalPath, "utf-8")
			const globalConfig = JSON.parse(globalContent)
			_globalServers = globalConfig.mcpServers || {}
		} catch (error) {
			logger.warn("McpHub", "Error reading global MCP config:", error)
			TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
		}

		const projectPath = await hub.getProjectMcpPath()
		let _projectServers: Record<string, unknown> = {}

		if (projectPath) {
			try {
				const projectContent = await fs.readFile(projectPath, "utf-8")
				const projectConfig = JSON.parse(projectContent)
				_projectServers = projectConfig.mcpServers || {}
			} catch (error) {
				logger.warn("McpHub", "Error reading project MCP config:", error)
				TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
			}
		}

		const existingConnections = [...hub.getConnections()]

		for (const conn of existingConnections) {
			await hub.deleteConnection(conn.server.name, conn.server.source)
		}

		await hub.initializeMcpServers("global")
		await hub.initializeMcpServers("project")
		await delay(100)
		await hub.notifyWebviewOfServerChanges()
	} catch (error) {
		hub.showErrorMessage("Failed to refresh MCP servers", error)
	} finally {
		hub.setIsConnecting(false)
	}
}
