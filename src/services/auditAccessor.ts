/**
 * Process-wide accessors for the singleton AuditSink and AuditLogger.
 *
 * The extension activates a single AuditLogger / AuditSink pair in
 * `extension.ts#activate`. Long-lived modules (CloudAgentOrchestrator,
 * background services, etc.) can read them through these helpers instead of
 * threading the instance through deep call chains.
 *
 * Setters are intentionally tolerant of being called multiple times so the
 * extension can rotate state in tests without breaking module shape.
 */

import type { AuditLogger } from "./AuditLogger"
import type { AuditSink } from "./AuditSink"

let currentLogger: AuditLogger | undefined
let currentSink: AuditSink | undefined

export function setAuditServices(logger: AuditLogger | undefined, sink: AuditSink | undefined): void {
	currentLogger = logger
	currentSink = sink
}

export function getAuditLogger(): AuditLogger | undefined {
	return currentLogger
}

export function getAuditSink(): AuditSink | undefined {
	return currentSink
}
