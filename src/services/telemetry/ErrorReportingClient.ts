import type { TelemetryClient } from "@njust-ai/telemetry"

import { guardedFetch } from "../../core/security/networkGuard"
import { logger } from "../../shared/logger"

/** Client-side timeout for a single report; reporting must never stall the host. */
const REPORT_TIMEOUT_MS = 5_000

/**
 * Off-box error reporting, strictly opt-in.
 *
 * Only events that already passed TelemetryService's allowlist reach this
 * client, so no raw messages, paths, prompts or credentials are sent. The
 * endpoint goes through guardedFetch (SSRF and DNS-pinning checks) and every
 * failure is swallowed after a debug log: reporting must never break the
 * extension host.
 */
export class ErrorReportingClient implements TelemetryClient {
	constructor(private readonly endpoint: string) {}

	async captureEvent(name: string, properties: Record<string, unknown>): Promise<void> {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), REPORT_TIMEOUT_MS)
		try {
			const response = await guardedFetch(this.endpoint, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ event: name, properties, ts: Date.now() }),
				signal: controller.signal,
			})
			if (!response.ok) {
				logger.debug("ErrorReportingClient", `report rejected with status ${response.status}`)
			}
		} catch (error) {
			logger.debug("ErrorReportingClient", "report failed", error)
		} finally {
			clearTimeout(timer)
		}
	}
}
