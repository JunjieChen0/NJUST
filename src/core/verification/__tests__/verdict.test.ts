import { describe, it, expect } from "vitest"

import type { TaskVerificationRecord, VerificationRun } from "../types"
import { evaluateVerification } from "../verdict"

const FP = "fp-current"

function run(overrides: Partial<VerificationRun> & Pick<VerificationRun, "kind">): VerificationRun {
	return {
		runId: `${overrides.kind}-${Math.random().toString(36).slice(2, 8)}`,
		taskId: "task-1",
		executable: "cjpm",
		args: [overrides.kind],
		cwd: "/ws/app",
		startedAt: 1_000,
		endedAt: 2_000,
		status: "passed",
		exitCode: 0,
		inputFingerprint: FP,
		inputFingerprintAfter: FP,
		stale: false,
		...overrides,
	}
}

function passingTest(overrides: Partial<VerificationRun> = {}): VerificationRun {
	return run({
		kind: "test",
		testScope: { description: "whole project", executed: 8, passed: 8, failed: 0 },
		...overrides,
	})
}

function record(parts: Partial<TaskVerificationRecord> = {}): TaskVerificationRecord {
	return { version: 1, taskId: "task-1", runs: [], claims: [], acceptances: [], invalidations: [], ...parts }
}

describe("evaluateVerification", () => {
	it("never verifies partial input coverage even with passing commands", () => {
		const evidence = record({ runs: [run({ kind: "build" }), passingTest()] })
		const result = evaluateVerification(evidence, FP, undefined, {
			coverage: "partial",
			gaps: ["Missing workspace member"],
		})
		expect(result.overall).toBe("incomplete")
		expect(result.gaps).toContain("Missing workspace member")
		evidence.runs[0].inputCoverage = "partial"
		expect(evaluateVerification(evidence, FP).overall).toBe("incomplete")
	})
	it.each([{ sdkVersion: "2" }, { sdkHome: "/other/sdk" }, { cjpmPath: "/other/cjpm" }])(
		"marks a changed environment stale: %o",
		(environment) => {
			const build = run({ kind: "build", sdk: { home: "/sdk", version: "1" } })
			const result = evaluateVerification(record({ runs: [build] }), FP, environment)
			expect(result.build).toMatchObject({ state: "stale", staleReason: "environment_changed" })
		},
	)

	it("does not infer SDK changes when old metadata is missing", () => {
		const result = evaluateVerification(record({ runs: [run({ kind: "build" })] }), FP, {
			sdkHome: "/sdk",
			sdkVersion: "2",
		})
		expect(result.build.state).toBe("passed")
	})
	it("reports no_record for legacy tasks without a verification file", () => {
		const verdict = evaluateVerification(undefined, FP)

		expect(verdict.overall).toBe("no_record")
		expect(verdict.build.state).toBe("not_run")
		expect(verdict.test.state).toBe("not_run")
		expect(verdict.acceptance).toBe("no_delivery")
	})

	it("is verified only when build and executed tests both passed on the current code", () => {
		const verdict = evaluateVerification(record({ runs: [run({ kind: "build" }), passingTest()] }), FP)

		expect(verdict.overall).toBe("verified")
		expect(verdict.build.state).toBe("passed")
		expect(verdict.test.state).toBe("passed")
	})

	it("is incomplete when the build passed but tests were never run", () => {
		const verdict = evaluateVerification(record({ runs: [run({ kind: "build" })] }), FP)

		expect(verdict.overall).toBe("incomplete")
		expect(verdict.test.state).toBe("not_run")
	})

	it("does not count zero matched tests as passing", () => {
		const zero = passingTest({ testScope: { description: "filter foo", filter: "foo", executed: 0 } })
		const verdict = evaluateVerification(record({ runs: [run({ kind: "build" }), zero] }), FP)

		expect(verdict.overall).toBe("incomplete")
		expect(verdict.test.state).toBe("zero_tests")
	})

	it("does not count tests with an unknown executed count as passing", () => {
		const unknownCount = passingTest({ testScope: { description: "whole project" } })
		const verdict = evaluateVerification(record({ runs: [run({ kind: "build" }), unknownCount] }), FP)

		expect(verdict.test.state).toBe("inconclusive")
		expect(verdict.overall).toBe("incomplete")
	})

	it("does not count a passed status with an unknown exit code as passing", () => {
		const verdict = evaluateVerification(
			record({ runs: [run({ kind: "build", exitCode: null }), passingTest()] }),
			FP,
		)

		expect(verdict.build.state).toBe("inconclusive")
		expect(verdict.overall).toBe("incomplete")
	})

	it("reports failed when the tests failed even though the build passed", () => {
		const failing = passingTest({
			status: "failed",
			exitCode: 1,
			testScope: { description: "whole project", executed: 8, passed: 7, failed: 1 },
		})
		const verdict = evaluateVerification(record({ runs: [run({ kind: "build" }), failing] }), FP)

		expect(verdict.overall).toBe("failed")
		expect(verdict.build.state).toBe("passed")
		expect(verdict.test.state).toBe("failed")
	})

	it("treats a passed status that reports failed tests as failed", () => {
		const inconsistent = passingTest({ testScope: { description: "whole project", executed: 8, failed: 1 } })
		const verdict = evaluateVerification(record({ runs: [run({ kind: "build" }), inconsistent] }), FP)

		expect(verdict.test.state).toBe("failed")
		expect(verdict.overall).toBe("failed")
	})

	it("does not let an older success mask a newer failure", () => {
		const oldPass = run({ kind: "build", startedAt: 1_000 })
		const newFail = run({ kind: "build", startedAt: 3_000, status: "failed", exitCode: 1 })
		const verdict = evaluateVerification(record({ runs: [newFail, oldPass, passingTest()] }), FP)

		expect(verdict.build.state).toBe("failed")
		expect(verdict.overall).toBe("failed")
	})

	it("marks results for a different code state as stale", () => {
		const verdict = evaluateVerification(record({ runs: [run({ kind: "build" }), passingTest()] }), "fp-newer")

		expect(verdict.build.state).toBe("stale")
		expect(verdict.test.state).toBe("stale")
		expect(verdict.overall).toBe("incomplete")
	})

	it("honours the persisted stale flag even when fingerprints match", () => {
		const verdict = evaluateVerification(record({ runs: [run({ kind: "build", stale: true }), passingTest()] }), FP)

		expect(verdict.build.state).toBe("stale")
		expect(verdict.overall).toBe("incomplete")
	})

	it("treats a run whose inputs changed during execution as inconclusive", () => {
		const changed = passingTest({ inputFingerprintAfter: "fp-mid-run" })
		const verdict = evaluateVerification(record({ runs: [run({ kind: "build" }), changed] }), FP)

		expect(verdict.test.state).toBe("inconclusive")
		expect(verdict.overall).toBe("incomplete")
	})

	it("cannot confirm results without a current fingerprint", () => {
		const verdict = evaluateVerification(record({ runs: [run({ kind: "build" }), passingTest()] }), undefined)

		expect(verdict.overall).not.toBe("verified")
		expect(verdict.build.state).toBe("stale")
	})

	it("keeps a stale failure from counting as a current failure", () => {
		const oldFail = run({
			kind: "build",
			status: "failed",
			exitCode: 1,
			inputFingerprint: "fp-old",
			inputFingerprintAfter: "fp-old",
		})
		const verdict = evaluateVerification(record({ runs: [oldFail] }), FP)

		expect(verdict.build.state).toBe("stale")
		expect(verdict.overall).toBe("incomplete")
	})

	it.each(["blocked", "cancelled", "inconclusive", "running"] as const)(
		"surfaces a %s build without fabricating a verdict",
		(status) => {
			const verdict = evaluateVerification(
				record({ runs: [run({ kind: "build", status, exitCode: undefined }), passingTest()] }),
				FP,
			)

			expect(verdict.build.state).toBe(status)
			expect(verdict.overall).toBe("incomplete")
		},
	)

	it("never upgrades to verified because the model claimed completion", () => {
		const verdict = evaluateVerification(
			record({ claims: [{ claimId: "c1", taskId: "task-1", claimedAt: 5_000, inputFingerprint: FP }] }),
			FP,
		)

		expect(verdict.overall).toBe("incomplete")
		expect(verdict.acceptance).toBe("pending")
	})

	it("records acceptance without overriding a failed verification", () => {
		const verdict = evaluateVerification(
			record({
				runs: [run({ kind: "build", status: "failed", exitCode: 1 })],
				claims: [{ claimId: "c1", taskId: "task-1", claimedAt: 5_000, inputFingerprint: FP }],
				acceptances: [{ claimId: "c1", decidedAt: 6_000, decision: "accepted" }],
			}),
			FP,
		)

		expect(verdict.overall).toBe("failed")
		expect(verdict.acceptance).toBe("accepted")
	})

	it("binds acceptance to the latest delivery", () => {
		const verdict = evaluateVerification(
			record({
				claims: [
					{ claimId: "c1", taskId: "task-1", claimedAt: 5_000, inputFingerprint: "fp-old" },
					{ claimId: "c2", taskId: "task-1", claimedAt: 7_000, inputFingerprint: FP },
				],
				acceptances: [{ claimId: "c1", decidedAt: 6_000, decision: "accepted" }],
			}),
			FP,
		)

		expect(verdict.latestClaim?.claimId).toBe("c2")
		expect(verdict.acceptance).toBe("pending")
	})

	it("uses the latest decision for a delivery", () => {
		const verdict = evaluateVerification(
			record({
				claims: [{ claimId: "c1", taskId: "task-1", claimedAt: 5_000, inputFingerprint: FP }],
				acceptances: [
					{ claimId: "c1", decidedAt: 6_000, decision: "accepted" },
					{ claimId: "c1", decidedAt: 7_000, decision: "changes_requested" },
				],
			}),
			FP,
		)

		expect(verdict.acceptance).toBe("changes_requested")
	})

	it("marks an accepted delivery as superseded once the code changes", () => {
		const verdict = evaluateVerification(
			record({
				claims: [{ claimId: "c1", taskId: "task-1", claimedAt: 5_000, inputFingerprint: "fp-old" }],
				acceptances: [{ claimId: "c1", decidedAt: 6_000, decision: "accepted" }],
			}),
			FP,
		)

		expect(verdict.acceptance).toBe("superseded")
	})
})
