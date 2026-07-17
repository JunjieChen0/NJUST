import { randomUUID } from "node:crypto"
import { ADMIN_ACTOR } from "./admin-auth"

export interface AuditEvent {
	action: string
	actor: string
	resource?: string
	result: "allowed" | "denied" | "failed" | "partial"
	reason?: string
	requestId: string
	timestamp: number
}

/**
 * Record a structured audit event.
 *
 * - `actor` defaults to `ADMIN_ACTOR` (stable identifier, not a secret).
 * - `result` can be "allowed", "denied", "failed", or "partial".
 * - Never log raw secrets, database URLs, or full exception objects.
 */
export function logAuditEvent(event: {
	action: string
	actor?: string
	resource?: string
	result: "allowed" | "denied" | "failed" | "partial"
	reason?: string
}): void {
	const entry: AuditEvent = {
		action: event.action,
		actor: event.actor ?? ADMIN_ACTOR,
		resource: event.resource,
		result: event.result,
		reason: event.reason,
		requestId: randomUUID(),
		timestamp: Date.now(),
	}

	console.log(
		JSON.stringify({
			type: "audit",
			...entry,
		}),
	)
}
