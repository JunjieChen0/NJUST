import { z } from "zod"

/**
 * Verification facts for a task. These records are the single source of truth
 * for "is this delivery verified": the model's completion claim, the actual
 * build/test process results, and the user's explicit acceptance are kept as
 * separate facts and never inferred from one another.
 */

export const verificationKindSchema = z.enum(["build", "test"])

/** Status of one recorded build/test execution. */
export const verificationRunStatusSchema = z.enum([
	"running",
	"passed",
	"failed",
	/** Environment prevented execution (missing SDK, no project root, ...). */
	"blocked",
	"cancelled",
	/** Finished, but the outcome cannot be trusted (e.g. exit code unknown). */
	"inconclusive",
])

export const verificationAbortReasonSchema = z.enum([
	"cancelled",
	"timeout",
	"spawn_failed",
	"signal",
	"exit_code_unknown",
	"input_changed",
])

export const testScopeSchema = z.object({
	/** Human readable scope, e.g. "whole project" or "package parser". */
	description: z.string(),
	filter: z.string().optional(),
	/** Number of tests actually executed; undefined means it could not be determined. */
	executed: z.number().int().nonnegative().optional(),
	passed: z.number().int().nonnegative().optional(),
	failed: z.number().int().nonnegative().optional(),
	skipped: z.number().int().nonnegative().optional(),
})

export const sdkInfoSchema = z.object({
	home: z.string().optional(),
	version: z.string().optional(),
})

export const verificationRunSchema = z.object({
	runId: z.string().min(1),
	taskId: z.string().min(1),
	kind: verificationKindSchema,
	executable: z.string().min(1),
	args: z.array(z.string()),
	cwd: z.string().min(1),
	startedAt: z.number(),
	endedAt: z.number().optional(),
	status: verificationRunStatusSchema,
	/** null = the process ended but its exit code is unknown. */
	exitCode: z.number().int().nullable().optional(),
	abortReason: verificationAbortReasonSchema.optional(),
	abortDetail: z.string().optional(),
	logRef: z.string().optional(),
	testScope: testScopeSchema.optional(),
	sdk: sdkInfoSchema.optional(),
	/** Project input fingerprint captured before the run started. */
	inputFingerprint: z.string().optional(),
	/** Project input fingerprint captured after the run ended. */
	inputFingerprintAfter: z.string().optional(),
	/** Set when a later change invalidated this run; the original facts are kept. */
	stale: z.boolean(),
})

/** The model declared the work done (attempt_completion). Never implies success. */
export const completionClaimSchema = z.object({
	claimId: z.string().min(1),
	taskId: z.string().min(1),
	claimedAt: z.number(),
	/** Code state the delivery was made against. */
	inputFingerprint: z.string().optional(),
	summary: z.string().optional(),
})

/** An explicit user decision on one delivery. */
export const acceptanceDecisionSchema = z.object({
	claimId: z.string().min(1),
	decidedAt: z.number(),
	decision: z.enum(["accepted", "changes_requested"]),
})

export const VERIFICATION_RECORD_VERSION = 1

export const taskVerificationRecordSchema = z.object({
	version: z.literal(VERIFICATION_RECORD_VERSION),
	taskId: z.string().min(1),
	runs: z.array(verificationRunSchema),
	claims: z.array(completionClaimSchema),
	acceptances: z.array(acceptanceDecisionSchema),
})

export type VerificationKind = z.infer<typeof verificationKindSchema>
export type VerificationRunStatus = z.infer<typeof verificationRunStatusSchema>
export type VerificationRun = z.infer<typeof verificationRunSchema>
export type CompletionClaim = z.infer<typeof completionClaimSchema>
export type AcceptanceDecision = z.infer<typeof acceptanceDecisionSchema>
export type TaskVerificationRecord = z.infer<typeof taskVerificationRecordSchema>
