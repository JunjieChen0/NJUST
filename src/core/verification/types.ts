import { z } from "zod"
import { verificationDeliverySchema } from "@njust-ai/types"

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
	"project_unresolved",
	/** Another cjpm command did not release the project within the lock wait limit. */
	"project_busy",
	/** The user (or their auto-approval settings) did not approve running the command. */
	"not_approved",
	"untrusted_workspace",
	/** The installed cjpm rejected the verification flags (older SDK). */
	"unsupported_options",
	"sandbox_denied",
	"dependency_unavailable",
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
	backend: z.enum(["guarded-host", "docker"]).optional(),
	image: z.string().optional(),
	imageDigest: z.string().optional(),
})

export const verificationRunSchema = z.object({
	runId: z.string().min(1),
	taskId: z.string().min(1),
	kind: verificationKindSchema,
	/** Missing on legacy records, which were all produced by system verification. */
	source: z.enum(["system_verification", "model_command"]).optional(),
	command: z.string().optional(),
	/** "baseline" = before the task changed code; "delivery" = verifying the task's result. */
	phase: z.enum(["baseline", "delivery"]).optional(),
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
	reportRef: z.string().optional(),
	testScope: testScopeSchema.optional(),
	sdk: sdkInfoSchema.optional(),
	/** Project input fingerprint captured before the run started. */
	inputFingerprint: z.string().optional(),
	/** Project input fingerprint captured after the run ended. */
	inputFingerprintAfter: z.string().optional(),
	inputCoverage: z.enum(["complete", "partial"]).optional(),
	coverageGaps: z.array(z.string()).optional(),
	/** Set when a later change invalidated this run; the original facts are kept. */
	stale: z.boolean(),
})

/** The model declared the work done (attempt_completion). Never implies success. */
export const completionClaimSchema = z.object({
	testProjectRoots: z.array(z.string()).optional(),
	claimId: z.string().min(1),
	taskId: z.string().min(1),
	claimedAt: z.number(),
	/** Code state the delivery was made against. */
	inputFingerprint: z.string().optional(),
	summary: z.string().optional(),
	delivery: verificationDeliverySchema.optional(),
})

/** An explicit user decision on one delivery. */
export const acceptanceDecisionSchema = z.object({
	claimId: z.string().min(1),
	decidedAt: z.number(),
	decision: z.enum(["accepted", "changes_requested"]),
})

export const VERIFICATION_RECORD_VERSION = 1

export const fileChangeSchema = z.object({
	path: z.string(),
	change: z.enum(["added", "modified", "deleted"]),
})
export const attributedChangeSchema = fileChangeSchema.extend({ source: z.enum(["task_tool", "other"]) })
export const verificationEnvironmentSchema = z.object({
	sdkHome: z.string().optional(),
	sdkVersion: z.string().optional(),
	cjpmPath: z.string().optional(),
	backend: z.enum(["guarded-host", "docker"]).optional(),
	image: z.string().optional(),
	imageDigest: z.string().optional(),
})
export const invalidationSchema = z.object({
	at: z.number(),
	cause: z.enum(["file_change", "checkpoint_restore", "task_resume", "environment_change"]),
	fromFingerprint: z.string().optional(),
	toFingerprint: z.string().optional(),
	changes: z.array(attributedChangeSchema),
	changesTruncated: z.boolean().default(false),
	/** Distinguishes SDK changes that share the same code fingerprint. */
	environment: verificationEnvironmentSchema.optional(),
})

export const taskVerificationRecordSchema = z.object({
	version: z.literal(VERIFICATION_RECORD_VERSION),
	taskId: z.string().min(1),
	runs: z.array(verificationRunSchema),
	claims: z.array(completionClaimSchema),
	acceptances: z.array(acceptanceDecisionSchema),
	invalidations: z.array(invalidationSchema).default([]),
})

export type VerificationKind = z.infer<typeof verificationKindSchema>
export type VerificationRunStatus = z.infer<typeof verificationRunStatusSchema>
export type VerificationRun = z.infer<typeof verificationRunSchema>
export type CompletionClaim = z.infer<typeof completionClaimSchema>
export type AcceptanceDecision = z.infer<typeof acceptanceDecisionSchema>
export type TaskVerificationRecord = z.infer<typeof taskVerificationRecordSchema>
export type FileChange = z.infer<typeof fileChangeSchema>
export type AttributedChange = z.infer<typeof attributedChangeSchema>
export type VerificationEnvironment = z.infer<typeof verificationEnvironmentSchema>
export type VerificationInvalidation = z.infer<typeof invalidationSchema>
