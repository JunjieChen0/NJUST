import { describe, it, expect } from "vitest"
import { createEmptyVerificationRecord } from "../VerificationStore"
import { evaluateVerification } from "../verdict"
import type { VerificationRun } from "../types"

const run = (kind: "build" | "test", cwd: string, status: "passed" | "failed", at: number): VerificationRun => ({
	runId: String(at),
	taskId: "task",
	kind,
	executable: "cjpm",
	args: [kind],
	cwd,
	startedAt: at,
	endedAt: at + 1,
	status,
	exitCode: status === "passed" ? 0 : 1,
	stale: false,
	inputFingerprint: "fp",
	inputFingerprintAfter: "fp",
	...(kind === "test"
		? {
				testScope: {
					description: cwd,
					executed: 1,
					passed: status === "passed" ? 1 : 0,
					failed: status === "failed" ? 1 : 0,
				},
			}
		: {}),
})

describe("related test evidence", () => {
	it("does not let a later passing dependency suite hide a root suite failure", () => {
		const record = createEmptyVerificationRecord("task")
		record.claims = [
			{
				taskId: "task",
				claimId: "claim",
				claimedAt: 5,
				inputFingerprint: "fp",
				testProjectRoots: ["/app", "/app/lib"],
			},
		]
		record.runs = [
			run("build", "/app", "passed", 1),
			run("test", "/app", "failed", 2),
			run("test", "/app/lib", "passed", 3),
		]
		expect(evaluateVerification(record, "fp")).toMatchObject({
			overall: "failed",
			test: { state: "failed", run: { cwd: "/app" } },
			relatedTests: [{ state: "passed", run: { cwd: "/app/lib" } }],
		})
	})

	it("requires evidence for every scope, even if another project has a later passing test", () => {
		const record = createEmptyVerificationRecord("task")
		record.runs = [
			run("build", "/app", "passed", 1),
			run("test", "/app", "passed", 2),
			run("test", "/other", "passed", 3),
		]
		expect(evaluateVerification(record, "fp", undefined, undefined, ["/app", "/app/lib"])).toMatchObject({
			overall: "incomplete",
			test: { state: "not_run", cwd: "/app/lib" },
		})
		record.runs.push(run("test", "/app/lib", "passed", 4))
		expect(evaluateVerification(record, "fp", undefined, undefined, ["/app", "/app/lib"]).overall).toBe("verified")
		record.runs.at(-1)!.inputFingerprint = "old"
		expect(evaluateVerification(record, "fp", undefined, undefined, ["/app", "/app/lib"]).overall).toBe(
			"incomplete",
		)
	})
})
