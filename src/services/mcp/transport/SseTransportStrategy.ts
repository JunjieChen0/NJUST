import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"

import { logger } from "../../../shared/logger"

import type { ITransportStrategy, TransportCallbacks } from "./ITransportStrategy"

export class SseTransportStrategy implements ITransportStrategy {
	readonly type = "sse"

	async createTransport(
		name: string,
		config: Record<string, UnsafeAny>,
		callbacks: TransportCallbacks,
	): Promise<SSEClientTransport> {
		// MCP server URLs are user-configured — the user explicitly trusts these endpoints.
		// SSRF guards (assertSafeOutboundUrl) are intentionally NOT applied here, as they
		// would block legitimate local MCP servers (localhost, private network addresses).
		// NOTE: The configuration schema validates URL format only, not protocol or hostname.
		// The trust boundary is the user's explicit configuration action.

		// IMPORTANT: Do NOT monkey-patch `globalThis.EventSource`. The MCP SDK instantiates
		// its own `eventsource` dependency directly (new EventSource(...) from the
		// `eventsource` package), so overriding the global has no effect on the transport
		// and only pollutes the process global. We instead implement reconnection at the
		// transport level, mirroring StdioTransportStrategy.

		const sseOptions = {
			requestInit: {
				headers: config.headers,
			},
			// Apply a request timeout to the initial SSE handshake to avoid an
			// indefinite hang when the endpoint is unresponsive.
			eventSourceInit: {
				fetch: (url: string | URL, init: RequestInit) => {
					const headers = new Headers({ ...(init?.headers || {}), ...(config.headers || {}) })
					const controller = new AbortController()
					const timeoutId = setTimeout(() => controller.abort(), 15_000)
					return fetch(url, {
						...init,
						headers,
						signal: controller.signal,
					}).finally(() => clearTimeout(timeoutId))
				},
			},
		}

		const transport = new SSEClientTransport(new URL(config.url), sseOptions)

		transport.onerror = async (error) => {
			logger.error("McpHub", `SSE transport error for "${name}":`, error)
			await callbacks.onError(error)
		}

		// Transport-level disconnect handling.
		//
		// NOTE: The MCP SDK's SSEClientTransport is NOT restartable — its
		// `start()` throws "already started!" once initialized, and `close()`
		// does not reset the internal `_eventSource` reference. So unlike
		// StdioTransportStrategy (which monkey-patches start() to no-op and can
		// re-invoke a real start), we cannot call transport.start() to
		// reconnect from here. A true reconnect requires rebuilding the whole
		// transport+client in McpHubConnection, which is out of scope for the
		// transport strategy.
		//
		// Instead of silently marking the server disconnected (the original
		// behavior), we surface onReconnectExhausted so the user gets a clear
		// "restart manually" message via the existing McpHubConnection handler.
		transport.onclose = async () => {
			logger.warn("McpHub", `SSE "${name}" disconnected — SDK transport is not restartable, surfacing to user`)
			await callbacks.onReconnectExhausted?.(name)
			await callbacks.onClose()
		}

		return transport
	}
}
