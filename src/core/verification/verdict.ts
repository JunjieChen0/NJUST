import type {
	CompletionClaim,
	TaskVerificationRecord,
	VerificationKind,
	VerificationRun,
	VerificationRunStatus,
	VerificationEnvironment,
} from "./types"
import * as path from "path"
import type { ProjectSnapshot } from "./projectFingerprint"

/**
 * State of one check (build or test) as it applies to the CURRENT code.
 * - not_run: no execution recorded
 * - stale: the latest execution was for a different (or unknown) code state
 * - zero_tests: tests ran but none were executed (e.g. filter matched nothing)
 */
export type CheckState =
	| { state: "not_run"; cwd?: string }
	| { state: VerificationRunStatus | "zero_tests"; run: VerificationRun }
	| { state: "stale"; run: VerificationRun; staleReason: "code_changed" | "environment_changed" }

export type OverallVerdict = "no_record" | "verified" | "failed" | "incomplete"

/**
 * - superseded: the latest delivery was decided on, but the code has changed since
 *   (or its code state cannot be confirmed), so a new delivery and decision are needed.
 */
export type AcceptanceState = "no_delivery" | "pending" | "accepted" | "changes_requested" | "superseded"

export interface VerificationVerdict {
	overall: OverallVerdict
	build: CheckState
	test: CheckState
	relatedTests?: CheckState[]
	acceptance: AcceptanceState
	latestClaim?: CompletionClaim
	gaps?: string[]
}

/**
 * Derive the verification verdict for the current code from recorded facts.
 * Only a passing build and passing, actually-executed tests that both match
 * `currentFingerprint` yield "verified". Completion claims and user acceptance
 * never change the overall verdict.
 */
export function evaluateVerification(
	record: TaskVerificationRecord | undefined,
	currentFingerprint: string | undefined,
	currentEnvironment?: VerificationEnvironment,
	currentSnapshot?: Pick<ProjectSnapshot, "coverage" | "gaps">,
	requiredTestRoots?: readonly string[],
): VerificationVerdict {
	if (!record) {
		return {
			overall: "no_record",
			build: { state: "not_run" },
			test: { state: "not_run" },
			acceptance: "no_delivery",
		}
	}

	const latestClaim = latestBy(record.claims, (c) => c.claimedAt)
	const roots = requiredTestRoots ?? latestClaim?.testProjectRoots
	const key = (cwd: string) =>
		process.platform === "win32" ? path.normalize(cwd).toLowerCase() : path.normalize(cwd)
	const scopedCheck = (kind: VerificationKind, cwd?: string): CheckState => {
		const runs = cwd ? record.runs.filter((run) => key(run.cwd) === key(cwd)) : record.runs
		const check = evaluateCheck(runs, kind, currentFingerprint, currentEnvironment)
		return check.state === "not_run" && cwd ? { ...check, cwd } : check
	}
	const build = scopedCheck("build", roots?.[0])
	const tests = roots?.length ? roots.map((cwd) => scopedCheck("test", cwd)) : [scopedCheck("test")]
	const test =
		tests.find((check) => check.state === "failed") ?? tests.find((check) => check.state !== "passed") ?? tests[0]!
	const relatedTests = tests.filter((check) => check !== test)
	const checkedRuns = [build, ...tests].flatMap((check) => (check.state === "not_run" ? [] : [check.run]))
	const partial =
		currentSnapshot?.coverage === "partial" || checkedRuns.some((run) => run.inputCoverage === "partial")
	const overall = deriveOverall(build, test)

	return {
		overall: partial && overall === "verified" ? "incomplete" : overall,
		build,
		test,
		relatedTests: relatedTests.length ? relatedTests : undefined,
		acceptance: evaluateAcceptance(record, latestClaim, currentFingerprint),
		latestClaim,
		gaps: [...new Set([...(currentSnapshot?.gaps ?? []), ...checkedRuns.flatMap((run) => run.coverageGaps ?? [])])],
	}
}

function deriveOverall(build: CheckState, test: CheckState): OverallVerdict {
	if (build.state === "failed" || test.state === "failed") return "failed"
	if (build.state === "passed" && test.state === "passed") return "verified"
	return "incomplete"
}

function evaluateCheck(
	runs: readonly VerificationRun[],
	kind: VerificationKind,
	currentFingerprint: string | undefined,
	currentEnvironment?: VerificationEnvironment,
): CheckState {
	// The latest execution wins, so an older success never masks a newer failure.
	const run = latestBy(
		runs.filter((r) => r.kind === kind),
		(r) => r.startedAt,
	)
	if (!run) return { state: "not_run" }
	if (run.status === "running") return { state: "running", run }

	const inputsChangedDuringRun =
		run.inputFingerprint !== undefined &&
		run.inputFingerprintAfter !== undefined &&
		run.inputFingerprint !== run.inputFingerprintAfter
	if (inputsChangedDuringRun) return { state: "inconclusive", run }

	const appliesToCurrentCode =
		!run.stale &&
		currentFingerprint !== undefined &&
		run.inputFingerprint === currentFingerprint &&
		run.inputFingerprintAfter === currentFingerprint
	if (!appliesToCurrentCode) return { state: "stale", run, staleReason: "code_changed" }
	// Model-requested shell commands are observed evidence, never system verification.
	// In particular, a passing filtered test must not verify the entire delivery.
	if (run.source === "model_command") return { state: run.status === "passed" ? "inconclusive" : run.status, run }
	if (hasEnvironmentChanged(run, currentEnvironment))
		return { state: "stale", run, staleReason: "environment_changed" }

	if (run.status !== "passed") return { state: run.status, run }
	return kind === "build" ? evaluatePassedBuild(run) : evaluatePassedTest(run)
}

export function hasEnvironmentChanged(run: VerificationRun, current?: VerificationEnvironment): boolean {
	return environmentsDiffer(
		{
			sdkHome: run.sdk?.home,
			sdkVersion: run.sdk?.version,
			cjpmPath: run.executable,
			backend: run.sdk?.backend ?? "guarded-host",
			image: run.sdk?.image,
			imageDigest: run.sdk?.imageDigest,
		},
		current,
	)
}

export function environmentsDiffer(previous?: VerificationEnvironment, current?: VerificationEnvironment): boolean {
	if (!previous || !current) return false
	const normalize = (value: string) => {
		const normalized = path.normalize(value)
		return process.platform === "win32" ? normalized.toLowerCase() : normalized
	}
	const differentPath = (before: string | undefined, next: string | undefined) =>
		before !== undefined && (next === undefined || normalize(before) !== normalize(next))
	return (
		(previous.backend !== undefined && current.backend !== undefined && previous.backend !== current.backend) ||
		(previous.image !== undefined && current.image !== undefined && previous.image !== current.image) ||
		(previous.imageDigest !== undefined &&
			current.imageDigest !== undefined &&
			previous.imageDigest !== current.imageDigest) ||
		differentPath(previous.sdkHome, current.sdkHome) ||
		differentPath(previous.cjpmPath, current.cjpmPath) ||
		(previous.sdkVersion !== undefined && previous.sdkVersion !== current.sdkVersion)
	)
}

function evaluatePassedBuild(run: VerificationRun): CheckState {
	return run.exitCode === 0 ? { state: "passed", run } : { state: "inconclusive", run }
}

function evaluatePassedTest(run: VerificationRun): CheckState {
	if (run.exitCode !== 0) return { state: "inconclusive", run }
	const scope = run.testScope
	if ((scope?.failed ?? 0) > 0) return { state: "failed", run }
	if (scope?.executed === undefined) return { state: "inconclusive", run }
	if (scope.executed === 0) return { state: "zero_tests", run }
	return { state: "passed", run }
}

function evaluateAcceptance(
	record: TaskVerificationRecord,
	latestClaim: CompletionClaim | undefined,
	currentFingerprint: string | undefined,
): AcceptanceState {
	if (!latestClaim) return "no_delivery"

	const decision = latestBy(
		record.acceptances.filter((a) => a.claimId === latestClaim.claimId),
		(a) => a.decidedAt,
	)
	if (!decision) return "pending"

	const deliveryIsCurrent = currentFingerprint !== undefined && latestClaim.inputFingerprint === currentFingerprint
	return deliveryIsCurrent ? decision.decision : "superseded"
}

function latestBy<T>(items: readonly T[], timeOf: (item: T) => number): T | undefined {
	let latest: T | undefined
	for (const item of items) {
		if (latest === undefined || timeOf(item) >= timeOf(latest)) latest = item
	}
	return latest
}
