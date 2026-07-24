/**
 * Docker Policy Proxy — Security Audit Logger
 *
 * Lightweight security event logger for the standalone Docker policy proxy.
 * Logs security-relevant events in a structured JSON format for audit purposes.
 */

export interface SecurityEvent {
	action: string
	resource: string
	result: "allowed" | "denied"
	reason: string
	timestamp?: string
}

/**
 * Log a security event to stderr for audit trail purposes.
 */
export function logSecurityEvent(event: SecurityEvent): void {
	const entry = {
		...event,
		timestamp: event.timestamp ?? new Date().toISOString(),
		source: "docker-policy-proxy",
	}
	// Security events always go to stderr for audit separation
	process.stderr.write(JSON.stringify(entry) + "\n")
}
