import * as fs from "fs/promises"
import * as path from "path"

import { safeWriteJson } from "../../utils/safeWriteJson"
import { getErrorMessage } from "../../shared/error-utils"

import {
	VERIFICATION_RECORD_VERSION,
	taskVerificationRecordSchema,
	type AcceptanceDecision,
	type CompletionClaim,
	type TaskVerificationRecord,
	type VerificationRun,
	type VerificationInvalidation,
} from "./types"

export const VERIFICATION_FILE_NAME = "verification.json"

/** The on-disk record exists but cannot be trusted; it is never silently overwritten. */
export class VerificationRecordCorruptError extends Error {
	constructor(
		readonly filePath: string,
		detail: string,
	) {
		super(`Verification record is corrupt (${filePath}): ${detail}`)
		this.name = "VerificationRecordCorruptError"
	}
}

export function createEmptyVerificationRecord(taskId: string): TaskVerificationRecord {
	return { version: VERIFICATION_RECORD_VERSION, taskId, runs: [], claims: [], acceptances: [], invalidations: [] }
}

export function withInvalidation(
	record: TaskVerificationRecord,
	inv: VerificationInvalidation,
): TaskVerificationRecord {
	const previous = record.invalidations.at(-1)
	if (
		previous &&
		previous.toFingerprint === inv.toFingerprint &&
		JSON.stringify(previous.environment) === JSON.stringify(inv.environment)
	)
		return record
	return {
		...record,
		invalidations: [
			...record.invalidations,
			{
				...inv,
				changes: inv.changes.slice(0, 200),
				changesTruncated: inv.changesTruncated || inv.changes.length > 200,
			},
		],
	}
}

/** Add a run, or replace the run with the same runId (e.g. running → passed). */
export function withRun(record: TaskVerificationRecord, run: VerificationRun): TaskVerificationRecord {
	const exists = record.runs.some((r) => r.runId === run.runId)
	const runs = exists ? record.runs.map((r) => (r.runId === run.runId ? run : r)) : [...record.runs, run]
	return { ...record, runs }
}

/** Add a completion claim; a repeated claimId is ignored so duplicate events cannot double count. */
export function withClaim(record: TaskVerificationRecord, claim: CompletionClaim): TaskVerificationRecord {
	if (record.claims.some((c) => c.claimId === claim.claimId)) return record
	return { ...record, claims: [...record.claims, claim] }
}

/** Add a user decision for a known delivery; repeating the current decision is ignored. */
export function withAcceptance(record: TaskVerificationRecord, decision: AcceptanceDecision): TaskVerificationRecord {
	if (!record.claims.some((c) => c.claimId === decision.claimId)) {
		throw new Error(`Cannot record a decision for unknown delivery "${decision.claimId}"`)
	}
	const previous = record.acceptances
		.filter((a) => a.claimId === decision.claimId)
		.reduce<
			AcceptanceDecision | undefined
		>((latest, a) => (latest === undefined || a.decidedAt >= latest.decidedAt ? a : latest), undefined)
	if (previous?.decision === decision.decision) return record
	return { ...record, acceptances: [...record.acceptances, decision] }
}

/**
 * Load a task's verification record.
 * Returns undefined when none exists (legacy task); throws VerificationRecordCorruptError
 * when the file is unreadable, invalid, or belongs to another task.
 */
export async function loadVerificationRecord(
	taskDir: string,
	taskId: string,
): Promise<TaskVerificationRecord | undefined> {
	const filePath = path.join(taskDir, VERIFICATION_FILE_NAME)

	let raw: string
	try {
		raw = await fs.readFile(filePath, "utf8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
		throw error
	}

	let json: unknown
	try {
		json = JSON.parse(raw)
	} catch (error) {
		throw new VerificationRecordCorruptError(filePath, getErrorMessage(error))
	}

	const parsed = taskVerificationRecordSchema.safeParse(json)
	if (!parsed.success) {
		throw new VerificationRecordCorruptError(filePath, parsed.error.message)
	}
	if (parsed.data.taskId !== taskId) {
		throw new VerificationRecordCorruptError(filePath, `belongs to task "${parsed.data.taskId}"`)
	}
	return parsed.data
}

/** Per-file write queue so concurrent updates within this process never lose writes. */
const updateQueues = new Map<string, Promise<unknown>>()

/**
 * Read-modify-write a task's verification record, serialized per task directory.
 * A corrupt record is never replaced; the error propagates to the caller.
 */
export function updateVerificationRecord(
	taskDir: string,
	taskId: string,
	update: (record: TaskVerificationRecord) => TaskVerificationRecord,
): Promise<TaskVerificationRecord> {
	const filePath = path.join(taskDir, VERIFICATION_FILE_NAME)
	const previous = updateQueues.get(filePath) ?? Promise.resolve()

	// An earlier update's failure was already reported to its own caller; it must not block this one.
	const next = previous
		.catch(() => undefined)
		.then(async () => {
			const current = (await loadVerificationRecord(taskDir, taskId)) ?? createEmptyVerificationRecord(taskId)
			const updated = taskVerificationRecordSchema.parse(update(current))
			await safeWriteJson(filePath, updated)
			return updated
		})

	updateQueues.set(filePath, next)
	next.then(
		() => releaseQueue(filePath, next),
		() => releaseQueue(filePath, next),
	)

	return next
}

function releaseQueue(filePath: string, settled: Promise<unknown>): void {
	if (updateQueues.get(filePath) === settled) updateQueues.delete(filePath)
}
