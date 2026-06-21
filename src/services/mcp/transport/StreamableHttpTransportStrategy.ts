import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

import { logger } from "../../../shared/logger"

import type { ITransportStrategy, TransportCallbacks } from "./ITransportStrategy"

export class StreamableHttpTransportStrategy implements ITransportStrategy {
	readonly type = "streamable-http"

	async createTransport(
		name: string,
		config: Record<string, UnsafeAny>,
		callbacks: TransportCallbacks,
	): Promise<StreamableHTTPClientTransport> {
		// MCP server URLs are user-configured — the user explicitly trusts these endpoints.
		// SSRF guards are intentionally NOT applied here (see SseTransportStrategy for rationale).

		const transport = new StreamableHTTPClientTransport(new URL(config.url), {
			requestInit: {
				headers: config.headers,
			},
			// Apply a per-request timeout so an unresponsive Streamable HTTP
			// endpoint cannot hang the initial handshake (and subsequent
			// requests) indefinitely.
			//
			// The handshake/initialize and metadata requests get a 15s cap. But a
			// `tools/call` request (e.g. a long-running build, script, or search)
			// may legitimately take minutes, so those requests get a longer 120s
			// cap that aligns with the McpProtocolAdapter callTool timeout.
			fetch: async (url: string | URL, init?: RequestInit) => {
				const headers = new Headers({ ...(init?.headers || {}), ...(config.headers || {}) })
				// Detect a tools/call request to grant it a longer budget.
				// The SDK POSTs a JSON-RPC body; inspect its `method` field.
				let isToolCall = false
				if (init?.body && typeof init.body === "string") {
					try {
						const parsed = JSON.parse(init.body)
						// Batched requests are arrays; a single request is an object.
						const messages = Array.isArray(parsed) ? parsed : [parsed]
						isToolCall = messages.some(
							(m: { method?: string }) => typeof m?.method === "string" && m.method === "tools/call",
						)
					} catch {
						// Non-JSON body (e.g. an SSE handshake) — treat as non-tool-call.
					}
				}
				const timeoutMs = isToolCall ? 120_000 : 15_000
				const controller = new AbortController()
				const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
				return fetch(url, {
					...init,
					headers,
					signal: controller.signal,
				}).finally(() => clearTimeout(timeoutId))
			},
		})

		// Set up Streamable HTTP specific error handling
		transport.onerror = async (error) => {
			logger.error("McpHub", `Streamable HTTP transport error for "${name}":`, error)
			await callbacks.onError(error)
		}

		// Transport-level disconnect handling.
		//
		// NOTE: The MCP SDK's StreamableHTTPClientTransport is NOT restartable —
		// its `start()` throws "already started!" once initialized (same guard
		// as SSEClientTransport). So we cannot call transport.start() to
		// reconnect from here. A true reconnect requires rebuilding the whole
		// transport+client in McpHubConnection, which is out of scope for the
		// transport strategy.
		//
		// Instead of the original silent-onClose, surface onReconnectExhausted
		// so the user gets a clear "restart manually" message.
		transport.onclose = async () => {
			logger.warn(
				"McpHub",
				`Streamable HTTP "${name}" disconnected — SDK transport is not restartable, surfacing to user`,
			)
			await callbacks.onReconnectExhausted?.(name)
			await callbacks.onClose()
		}

		return transport
	}
}
