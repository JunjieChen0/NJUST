import { describe, it, expect } from "vitest"
import * as path from "path"
import { verificationSummarySchema } from "@njust-ai/types"
import { buildVerificationSummary } from "../verificationSummary"
import { evaluateVerification } from "../verdict"
import { createEmptyVerificationRecord } from "../VerificationStore"

describe("verification summaries", () => {
	it("retains the recorded environmental blocker when no command could run", () => {
		const record = createEmptyVerificationRecord("task")
		record.runs = [
			{
				runId: "r",
				taskId: "task",
				kind: "build",
				executable: "cjpm",
				args: ["build"],
				cwd: "/app",
				startedAt: 1,
				status: "blocked",
				stale: false,
				inputFingerprint: "fp",
				inputFingerprintAfter: "fp",
				abortReason: "spawn_failed",
				abortDetail: "cjpm executable could not be resolved",
			},
		]
		const result = buildVerificationSummary(evaluateVerification(record, "fp"), { taskDir: "/task" })
		expect(result.overall).toBe("incomplete")
		expect(result.note).toContain("cjpm executable could not be resolved")
	})
	it.each(["verified", "failed", "incomplete", "no_record"] as const)(
		"preserves the %s verdict independently of user acceptance",
		(overall) => {
			const summary = buildVerificationSummary(
				{ ...evaluateVerification(undefined, undefined), overall, acceptance: "accepted" },
				{ taskDir: "/storage/task" },
			)
			expect(summary).toMatchObject({
				overall,
				acceptance: "accepted",
				build: { state: "not_run" },
				test: { state: "not_run" },
			})
			expect(verificationSummarySchema.safeParse(summary).success).toBe(true)
		},
	)
	it("preserves exit codes, test counts, stale reasons, delivery and absolute log paths", () => {
		const record = createEmptyVerificationRecord("task")
		record.runs = [
			{
				runId: "r",
				taskId: "task",
				kind: "test",
				executable: "cjpm",
				args: ["test"],
				cwd: "/app",
				startedAt: 1,
				endedAt: 2,
				status: "passed",
				exitCode: 0,
				stale: false,
				inputFingerprint: "before",
				inputFingerprintAfter: "before",
				logRef: "verification-logs/r.log",
				testScope: { description: "all", filter: "test*", executed: 3, passed: 2, failed: 1, skipped: 0 },
			},
		]
		record.claims = [{ claimId: "delivery", taskId: "task", claimedAt: 3, inputFingerprint: "before" }]
		const result = buildVerificationSummary(evaluateVerification(record, "after"), {
			taskDir: path.resolve("/storage/task"),
			terminal: "cancelled",
			note: "preserved",
		})
		expect(result.test).toMatchObject({
			state: "stale",
			staleReason: "code_changed",
			exitCode: 0,
			executed: 3,
			failed: 1,
		})
		expect(path.isAbsolute(result.test.logPath!)).toBe(true)
		expect(result.test.logPath).toBe(path.resolve("/storage/task/verification-logs/r.log"))
		expect(result.test).not.toHaveProperty("description")
		expect(result.test).not.toHaveProperty("filter")
		expect(result).toMatchObject({ claimId: "delivery", terminal: "cancelled", note: "preserved" })
	})
	it("keeps full source counts and caps each file list at ten", () => {
		const result = buildVerificationSummary(evaluateVerification(undefined, undefined), {
			taskDir: "/storage",
			changes: Array.from({ length: 25 }, (_, i) => ({
				path: `${i}.cj`,
				change: "modified",
				source: i < 12 ? "other" : "task_tool",
			})),
		})
		expect(result.changes).toMatchObject({ taskTool: 13, other: 12 })
		expect(result.changes?.files).toHaveLength(10)
		expect(result.changes?.otherFiles).toHaveLength(10)
	})
})
