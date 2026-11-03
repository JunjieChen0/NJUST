import { describe, it, expect } from "vitest"

import type { VerificationRun } from "../types"
import type { CheckState, VerificationVerdict } from "../verdict"
import { decideCangjieCompletion, formatVerificationFacts } from "../completionDecision"

const RUN: VerificationRun = {
	runId: "r1",
	taskId: "t1",
	kind: "build",
	executable: "cjpm",
	args: ["build"],
	cwd: "/ws/app",
	startedAt: 1,
	endedAt: 2,
	status: "passed",
	exitCode: 0,
	logRef: "verification-logs/r1.log",
	stale: false,
}

function check(state: CheckState["state"], run: Partial<VerificationRun> = {}): CheckState {
	if (state === "not_run") return { state }
	if (state === "stale") return { state, run: { ...RUN, ...run }, staleReason: "code_changed" }
	return { state, run: { ...RUN, ...run } }
}

describe("changed input facts", () => {
	const stale = () => verdict(check("stale"), check("stale"))
	it("omits change details when there are no changes", () => {
		expect(formatVerificationFacts(stale())).not.toContain("Changed since")
	})
	it("separates task tool paths from other sources", () => {
		const facts = formatVerificationFacts(stale(), undefined, [
			{ path: "src/a.cj", change: "modified", source: "task_tool" },
			{ path: "src/b.cj", change: "added", source: "other" },
		])
		expect(facts).toContain("1 file(s) by task tools, 1 by other sources")
		expect(facts).toContain("Changes by other sources: src/b.cj")
	})
	it("lists at most ten paths for external changes", () => {
		const facts = formatVerificationFacts(
			stale(),
			undefined,
			Array.from({ length: 11 }, (_, i) => ({ path: `file-${i}.cj`, change: "modified", source: "other" })),
		)
		expect(facts).toContain("0 file(s) by task tools, 11 by other sources")
		expect(facts).toContain("file-9.cj, ...")
		expect(facts).not.toContain("file-10.cj")
	})
})

function verdict(build: CheckState, test: CheckState, overall?: VerificationVerdict["overall"]): VerificationVerdict {
	const derived =
		build.state === "failed" || test.state === "failed"
			? "failed"
			: build.state === "passed" && test.state === "passed"
				? "verified"
				: "incomplete"
	return { overall: overall ?? derived, build, test, acceptance: "pending" }
}

const PASSED_TEST = check("passed", {
	kind: "test",
	testScope: { description: "whole project", executed: 8, passed: 8, failed: 0 },
})
const FAILED_TEST = check("failed", {
	kind: "test",
	exitCode: 1,
	testScope: { description: "whole project", executed: 8, passed: 7, failed: 1 },
})
const ZERO_TEST = check("zero_tests", { kind: "test", testScope: { description: "whole project", executed: 0 } })

const IMPLEMENT = { checkOnly: false, repairExhausted: false, missingTestsAlreadyRequested: false }

describe("decideCangjieCompletion", () => {
	it("allows a verified delivery", () => {
		expect(decideCangjieCompletion(verdict(check("passed"), PASSED_TEST), IMPLEMENT)).toEqual({ action: "allow" })
	})

	it("blocks a failed build while repair attempts remain", () => {
		const decision = decideCangjieCompletion(verdict(check("failed", { exitCode: 1 }), check("not_run")), IMPLEMENT)

		expect(decision.action).toBe("block")
		if (decision.action === "block") expect(decision.reason).toMatch(/cjpm build.*exit code 1.*CangjieRepair/s)
	})

	it("blocks failing tests while repair attempts remain", () => {
		const decision = decideCangjieCompletion(verdict(check("passed"), FAILED_TEST), IMPLEMENT)

		expect(decision.action).toBe("block")
		if (decision.action === "block") expect(decision.reason).toMatch(/1 of 8 tests failed/)
	})

	it("allows a partial delivery once repair attempts are exhausted", () => {
		expect(
			decideCangjieCompletion(verdict(check("passed"), FAILED_TEST), { ...IMPLEMENT, repairExhausted: true }),
		).toEqual({ action: "allow" })
	})

	it("never asks a check-only task to repair", () => {
		expect(
			decideCangjieCompletion(verdict(check("failed", { exitCode: 1 }), check("not_run")), {
				...IMPLEMENT,
				checkOnly: true,
			}),
		).toEqual({ action: "allow" })
	})

	it("asks once for tests when none were executed, then allows with the gap", () => {
		const first = decideCangjieCompletion(verdict(check("passed"), ZERO_TEST), IMPLEMENT)
		const second = decideCangjieCompletion(verdict(check("passed"), ZERO_TEST), {
			...IMPLEMENT,
			missingTestsAlreadyRequested: true,
		})

		expect(first).toMatchObject({ action: "block", requestedMissingTests: true })
		expect(second).toEqual({ action: "allow" })
	})

	it("does not ask a check-only task to add tests", () => {
		expect(decideCangjieCompletion(verdict(check("passed"), ZERO_TEST), { ...IMPLEMENT, checkOnly: true })).toEqual(
			{ action: "allow" },
		)
	})

	it.each(["blocked", "cancelled", "inconclusive", "stale"] as const)(
		"allows a %s build with the gap instead of looping",
		(state) => {
			expect(decideCangjieCompletion(verdict(check(state), check("not_run")), IMPLEMENT)).toEqual({
				action: "allow",
			})
		},
	)
})

describe("formatVerificationFacts", () => {
	it("states verified facts with commands and exit codes", () => {
		const text = formatVerificationFacts(verdict(check("passed"), PASSED_TEST))

		expect(text).toContain("System verification")
		expect(text).toContain("Verdict: verified")
		expect(text).toMatch(/Build: passed \(exit 0\)/)
		expect(text).toMatch(/Tests: passed \(exit 0\) — 8 executed, 0 failed \(whole project\)/)
	})

	it("separates a passing build from failing tests", () => {
		const text = formatVerificationFacts(verdict(check("passed"), FAILED_TEST))

		expect(text).toContain("Verdict: failed")
		expect(text).toMatch(/Build: passed/)
		expect(text).toMatch(/Tests: failed \(exit 1\) — 8 executed, 1 failed/)
	})

	it("lists verification gaps explicitly", () => {
		const text = formatVerificationFacts(
			verdict(
				check("blocked", {
					exitCode: undefined,
					abortReason: "spawn_failed",
					abortDetail: "spawn cjpm ENOENT",
				}),
				check("not_run"),
			),
		)

		expect(text).toMatch(/Build: blocked — spawn cjpm ENOENT/)
		expect(text).toMatch(/Tests: not run/)
		expect(text).toContain("Verdict: incomplete")
	})

	it("reports zero executed tests as a gap", () => {
		expect(formatVerificationFacts(verdict(check("passed"), ZERO_TEST))).toMatch(/Tests: no tests executed/)
	})

	it("explains a busy project without suggesting a code or test failure", () => {
		const text = formatVerificationFacts(
			verdict(check("blocked", { exitCode: undefined, abortReason: "project_busy" }), check("not_run")),
		)
		expect(text).toContain("Build: blocked — Another cjpm process is still running in this project")
		expect(text).toContain("Tests: not run")
		expect(text).toContain("Verdict: incomplete")
	})

	it("includes an extra note such as an unresolved project", () => {
		expect(formatVerificationFacts(verdict(check("not_run"), check("not_run")), "No cjpm.toml found")).toContain(
			"No cjpm.toml found",
		)
	})
})
