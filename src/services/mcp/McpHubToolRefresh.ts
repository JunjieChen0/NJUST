import type { McpTool } from "@njust-ai/types"
import { TelemetryEventName } from "@njust-ai/types"

import { logger } from "../../shared/logger"
import { TelemetryService } from "@njust-ai/telemetry"

type McpSource = "global" | "project"

type RefreshableConnection = {
	server: { name: string; source?: string; tools?: McpTool[] }
	type: "connected" | "disconnected"
}

/** Narrow view of the hub needed to refresh tool lists. */
export interface McpToolRefreshHost {
	readonly connections: RefreshableConnection[]
	fetchToolsList(name: string, source?: string): Promise<McpTool[]>
	notifyWebviewOfServerChanges(): Promise<void>
}

/**
 * Reloads the tool list for one or all connected servers.
 * Returns a map of server name → tool count, with -1 marking a failed refresh.
 */
export async function refreshToolsWithHub(host: McpToolRefreshHost, serverName?: string): Promise<Map<string, number>> {
	const result = new Map<string, number>()

	const targets = serverName
		? host.connections.filter((c) => c.server.name === serverName && c.type === "connected")
		: host.connections.filter((c) => c.type === "connected")

	if (targets.length === 0) {
		logger.warn("McpHub", `refreshTools: No connected server(s) found${serverName ? ` for "${serverName}"` : ""}`)
		return result
	}

	await Promise.allSettled(
		targets.map(async (connection) => {
			const name = connection.server.name
			const source = connection.server.source || "global"

			try {
				const tools = await host.fetchToolsList(name, source as McpSource)
				connection.server.tools = tools
				result.set(name, tools.length)
				logger.info("McpHub", `refreshTools: Refreshed ${tools.length} tool(s) for server "${name}"`)
			} catch (error) {
				logger.error("McpHub", `refreshTools: Failed to refresh tools for "${name}":`, error)
				TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
				result.set(name, -1) // -1 signals failure
			}
		}),
	)

	// Notify the webview so the UI reflects the updated tool lists
	await host.notifyWebviewOfServerChanges()

	return result
}
