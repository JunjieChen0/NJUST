import type { CheckState, VerificationVerdict } from "./verdict"
import type { AttributedChange } from "./types"

export interface CompletionDecisionContext {
	/** Check-only/evidence-only request: never route into repair or ask for new tests. */
	checkOnly: boolean
	repairExhausted: boolean
	/** The task was already asked once to add tests; a second zero-test delivery is allowed with the gap. */
	missingTestsAlreadyRequested: boolean
}

export type CompletionDecision = { action: "allow" } | { action: "block"; reason: string; requestedMissingTests?: true }

function describeExit(check: CheckState): string {
	if (check.state === "not_run") return ""
	const code = check.run.exitCode
	return typeof code === "number" ? ` (exit ${code})` : ""
}

function buildFailureReason(build: CheckState): string {
	const code = build.state !== "not_run" && typeof build.run.exitCode === "number" ? build.run.exitCode : "unknown"
	return (
		`System verification failed: \`cjpm build\` exited with exit code ${code} on the current code. ` +
		`Delegate CangjieRepair to fix the build, then attempt completion again (the extension re-runs build and tests).`
	)
}

function testFailureReason(test: CheckState): string {
	const scope = test.state !== "not_run" ? test.run.testScope : undefined
	const counts =
		scope?.executed !== undefined ? `${scope.failed ?? 0} of ${scope.executed} tests failed` : "tests failed"
	return (
		`System verification failed: the build passed but ${counts} (${scope?.description ?? "whole project"}). ` +
		`Delegate CangjieRepair to fix the failing tests or the code under test, then attempt completion again.`
	)
}

const MISSING_TESTS_REASON =
	"System verification: the build passed but no tests were executed. Add a unit test that covers the changed " +
	"behavior (std.unittest with @Test/@TestCase in a *_test.cj file of the same package), then attempt completion " +
	"again. If a test cannot be added, attempt completion again and explain why; the gap will be reported."

/**
 * Decide whether a top-level Cangjie completion may proceed, based only on system-recorded facts.
 * Failures loop into repair only while repair attempts remain; everything else is delivered with
 * its gaps stated instead of retrying attempt_completion forever.
 */
export function decideCangjieCompletion(
	verdict: VerificationVerdict,
	ctx: CompletionDecisionContext,
): CompletionDecision {
	const canRepair = !ctx.checkOnly && !ctx.repairExhausted
	if (canRepair && verdict.build.state === "failed") {
		return { action: "block", reason: buildFailureReason(verdict.build) }
	}
	if (canRepair && verdict.test.state === "failed") {
		return { action: "block", reason: testFailureReason(verdict.test) }
	}
	if (!ctx.checkOnly && !ctx.missingTestsAlreadyRequested && verdict.test.state === "zero_tests") {
		return { action: "block", reason: MISSING_TESTS_REASON, requestedMissingTests: true }
	}
	return { action: "allow" }
}

function describeGap(check: CheckState): string {
	if (check.state === "not_run") return "not run"
	const detail =
		check.run.abortReason === "project_busy"
			? (check.run.abortDetail ?? "Another cjpm process is still running in this project")
			: (check.run.abortDetail ?? check.run.abortReason)
	switch (check.state) {
		case "stale":
			return check.staleReason === "environment_changed"
				? "SDK or cjpm environment changed (stale)"
				: "result belongs to a different code state (stale)"
		case "zero_tests":
			return "no tests executed (none found or none matched)"
		case "running":
			return "still running"
		default:
			return `${check.state}${describeExit(check)}${detail ? ` — ${detail}` : ""}`
	}
}

function describeBuild(build: CheckState): string {
	if (build.state === "passed" || build.state === "failed") {
		return `${build.state}${describeExit(build)} — \`cjpm build\` in ${build.run.cwd}`
	}
	return describeGap(build)
}

function describeTests(test: CheckState): string {
	if (test.state !== "passed" && test.state !== "failed") return describeGap(test)
	const scope = test.run.testScope
	const counts =
		scope?.executed !== undefined
			? ` — ${scope.executed} executed, ${scope.failed ?? 0} failed`
			: " — counts unknown"
	return `${test.state}${describeExit(test)}${counts} (${scope?.description ?? "whole project"})`
}

function logLine(check: CheckState, label: string): string | undefined {
	return check.state !== "not_run" && check.run.logRef ? `- ${label} log: ${check.run.logRef}` : undefined
}

/** Plain-text summary of the recorded facts, appended to the delivery. Written by the extension, not the model. */
export function formatVerificationFacts(
	verdict: VerificationVerdict,
	note?: string,
	changes: readonly AttributedChange[] = [],
): string {
	const stale = verdict.build.state === "stale" || verdict.test.state === "stale"
	const taskChanges = changes.filter((change) => change.source === "task_tool")
	const otherChanges = changes.filter((change) => change.source === "other")
	const names = (items: readonly AttributedChange[]) =>
		items
			.slice(0, 10)
			.map((change) => change.path)
			.join(", ") + (items.length > 10 ? ", ..." : "")
	return [
		"System verification (recorded by the extension, not by the model):",
		`- Verdict: ${verdict.overall}`,
		`- Build: ${describeBuild(verdict.build)}`,
		`- Tests: ${describeTests(verdict.test)}`,
		...(verdict.relatedTests ?? []).map(
			(check) =>
				`- Related tests (${check.state === "not_run" ? check.cwd : check.run.cwd}): ${describeTests(check)}`,
		),
		stale && changes.length > 0
			? `- Changed since last verification: ${taskChanges.length} file(s) by task tools, ${otherChanges.length} by other sources (${names(changes)})`
			: undefined,
		stale && otherChanges.length > 0 ? `- Changes by other sources: ${names(otherChanges)}` : undefined,
		logLine(verdict.build, "Build"),
		logLine(verdict.test, "Test"),
		...(verdict.relatedTests ?? []).map((check) => logLine(check, "Related test")),
		note ? `- Note: ${note}` : undefined,
		`- User acceptance: ${verdict.acceptance}`,
	]
		.filter((line): line is string => line !== undefined)
		.join("\n")
}
