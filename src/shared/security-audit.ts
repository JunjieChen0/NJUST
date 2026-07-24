import { randomUUID } from "crypto"
import { logger } from "./logger"

export type SecurityAuditResult = "allowed" | "denied" | "failed"

export interface SecurityAuditEvent {
	action: string
	actorId?: string
	resource?: string
	result: SecurityAuditResult
	reason?: string
	timestamp: number
	requestId: string
}

export type SecurityAuditSink = (event: SecurityAuditEvent) => void

const sinks = new Set<SecurityAuditSink>()

let idCounter = 0

function generateRequestId(): string {
	try {
		return randomUUID()
	} catch {
		return `${Date.now()}-${++idCounter}`
	}
}

export function logSecurityEvent(
	partial: Omit<SecurityAuditEvent, "timestamp" | "requestId"> &
		Partial<Pick<SecurityAuditEvent, "timestamp" | "requestId">>,
): void {
	const event: SecurityAuditEvent = {
		action: partial.action,
		actorId: partial.actorId,
		resource: partial.resource,
		result: partial.result,
		reason: partial.reason,
		timestamp: partial.timestamp ?? Date.now(),
		requestId: partial.requestId ?? generateRequestId(),
	}

	const level = event.result === "allowed" ? "info" : "warn"
	logger[level](
		"SecurityAudit",
		JSON.stringify({
			action: event.action,
			actor: event.actorId ?? "unknown",
			resource: event.resource ?? "",
			result: event.result,
			reason: event.reason ?? "",
			ts: event.timestamp,
			rid: event.requestId,
		}),
	)

	for (const sink of sinks) {
		try {
			sink(event)
		} catch (e) {
			logger.debug("SecurityAudit", "sink threw", e)
		}
	}
}

export function addSecurityAuditSink(sink: SecurityAuditSink): () => void {
	sinks.add(sink)
	return () => {
		sinks.delete(sink)
	}
}

export function clearSecurityAuditSinks(): void {
	sinks.clear()
}
