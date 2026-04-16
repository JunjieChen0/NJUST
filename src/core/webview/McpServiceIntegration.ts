/**
 * McpServiceIntegration — Encapsulates MCP Hub initialization, lifecycle,
 * and UI synchronization.
 *
 * Extracted from ClineProvider.ts to decompose the monolithic file.
 *
 * Phase 1: Interface + initialization helper.
 * Phase 2 (future): Move MCP-related constructor logic, ensureMcpServersDirectoryExists,
 * getMcpHub, onMcpServersUpdated from ClineProvider.
 */
import type * as vscode from "vscode"
import type { McpServer } from "@njust-ai-cj/types"
import type { IMcpHubService } from "../../services/mcp/interfaces/IMcpHubService"
import type { IMcpHubClient } from "../../services/mcp/interfaces/IMcpHubClient"
import { McpServerManager } from "../../services/mcp/McpServerManager"

/**
 * Initialize the MCP hub singleton and register the provider as a client.
 * Returns the hub service interface for further operations.
 */
export async function initializeMcpHub(
	context: vscode.ExtensionContext,
	client: IMcpHubClient,
): Promise<IMcpHubService> {
	const hub = await McpServerManager.getInstance(context, client)
	hub.registerClient()
	return hub
}

/**
 * Tear down an MCP hub connection for a specific client.
 */
export async function teardownMcpHub(
	hub: IMcpHubService | undefined,
	client: IMcpHubClient,
): Promise<void> {
	if (hub) {
		await hub.unregisterClient()
	}
	McpServerManager.unregisterProvider(client)
}

/**
 * Service interface for MCP integration surface.
 * ClineProvider implements this.
 */
export interface IMcpServiceIntegration {
	getMcpHub(): IMcpHubService | undefined
	onMcpServersUpdated(servers: McpServer[]): Promise<void>
	ensureMcpServersDirectoryExists(): Promise<string>
}
