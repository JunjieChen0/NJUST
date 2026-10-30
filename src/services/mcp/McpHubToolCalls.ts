import { CallToolResultSchema, ReadResourceResultSchema } from "@modelcontextprotocol/sdk/types.js"

import type { McpResourceResponse, McpServer, McpToolCallResponse } from "@njust-ai/types"
import { TelemetryEventName } from "@njust-ai/types"

import { logger } from "../../shared/logger"
import { TelemetryService } from "@njust-ai/telemetry"

import { ServerConfigSchema } from "./McpHubConfigSchema"

type McpSource = "global" | "project"

/** The only client capability these calls need; keeps the seam testable. */
export interface McpRequestable {
	request(request: unknown, resultSchema: unknown, options?: { timeout?: number }): Promise<unknown>
}

/** Minimal structural view of a hub connection used by resource/tool calls. */
export interface McpToolCallConnection {
	type: "connected" | "disconnected"
	server: McpServer
	client: McpRequestable | null
}

export interface McpToolCallHost {
	findConnection(serverName: string, source?: McpSource): McpToolCallConnection | undefined
}

const DEFAULT_TOOL_TIMEOUT_SECONDS = 60

function requireConnected(
	host: McpToolCallHost,
	serverName: string,
	source: McpSource | undefined,
	disabledMessage: (name: string) => string,
	missingMessage: (name: string, source?: McpSource) => string,
): McpToolCallConnection & { client: McpRequestable } {
	const connection = host.findConnection(serverName, source)

	if (!connection || connection.type !== "connected" || !connection.client) {
		throw new Error(missingMessage(serverName, source))
	}

	if (connection.server.disabled) {
		throw new Error(disabledMessage(serverName))
	}

	return connection as McpToolCallConnection & { client: McpRequestable }
}

/** Reads an MCP resource from a connected server. */
export async function readResourceWithHub(
	host: McpToolCallHost,
	serverName: string,
	uri: string,
	source?: McpSource,
): Promise<McpResourceResponse> {
	const connection = requireConnected(
		host,
		serverName,
		source,
		(name) => `Server "${name}" is disabled`,
		(name, src) => `No connection found for server: ${name}${src ? ` with source ${src}` : ""}`,
	)

	return (await connection.client.request(
		{ method: "resources/read", params: { uri } },
		ReadResourceResultSchema,
	)) as McpResourceResponse
}

/** Invokes an MCP tool, validating argument serializability and resolving the timeout. */
export async function callToolWithHub(
	host: McpToolCallHost,
	serverName: string,
	toolName: string,
	toolArguments?: Record<string, unknown>,
	source?: McpSource,
): Promise<McpToolCallResponse> {
	const connection = requireConnected(
		host,
		serverName,
		source,
		(name) => `Server "${name}" is disabled and cannot be used`,
		(name, src) =>
			`No connection found for server: ${name}${src ? ` with source ${src}` : ""}. Please make sure to use MCP servers available under 'Connected MCP Servers'.`,
	)

	let timeout: number

	try {
		const parsedConfig = ServerConfigSchema.parse(JSON.parse(connection.server.config))
		timeout = (parsedConfig.timeout ?? DEFAULT_TOOL_TIMEOUT_SECONDS) * 1000
	} catch (error) {
		logger.error("McpHub", "Failed to parse server config for timeout:", error)
		TelemetryService.reportError(error, TelemetryEventName.MCP_ERROR)
		timeout = DEFAULT_TOOL_TIMEOUT_SECONDS * 1000
	}

	// Validate arguments are JSON-serializable before passing to RPC layer.
	// Circular references, Functions, Symbols, and BigInt values cause
	// JSON.stringify to throw, which would crash the caller uncaught.
	let safeArguments: Record<string, unknown> | undefined

	if (toolArguments !== undefined) {
		try {
			safeArguments = JSON.parse(JSON.stringify(toolArguments))
		} catch (serializeError) {
			throw new Error(
				`Cannot serialize tool arguments for "${toolName}" on server "${serverName}": ` +
					`arguments contain non-JSON-safe values (circular references, functions, etc.). ` +
					`Original error: ${(serializeError as Error).message}`,
			)
		}
	}

	return (await connection.client.request(
		{
			method: "tools/call",
			params: {
				name: toolName,
				arguments: safeArguments,
			},
		},
		CallToolResultSchema,
		{ timeout },
	)) as McpToolCallResponse
}
