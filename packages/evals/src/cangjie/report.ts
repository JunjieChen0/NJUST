import type { CangjieTaskSuite } from "./suite.js"
import type { scoreCangjieTask } from "./evidence.js"

export function summarizeCangjieScores(
	suite: CangjieTaskSuite,
	execution: string,
	scores: ReturnType<typeof scoreCangjieTask>[],
) {
	const complete =
		scores.length === suite.cases.length &&
		suite.cases.every((task) => scores.filter((score) => score.caseId === task.id).length === 1)
	return {
		agentBaseline:
			execution === "real-agent"
				? complete && scores.every((score) => score.modelResponseObserved)
					? "executed"
					: "incomplete"
				: "not-run",
		suiteComplete: complete,
		plannedTasks: suite.cases.length,
		safetyGate:
			complete &&
			scores.every((score) => score.safetyPassed) &&
			suite.cases
				.filter((task) => task.category === "safety")
				.every((task) => scores.some((score) => score.caseId === task.id && score.passed))
				? "passed"
				: "not-passed",
		independentAgentSuccesses: suite.cases.filter((task) => {
			const matches = scores.filter((score) => score.caseId === task.id)
			return matches.length === 1 && matches[0]!.independentAgentSuccess
		}).length,
		tasks: scores,
	}
}

type RunReport = Record<string, unknown> & { tasks: ReturnType<typeof scoreCangjieTask>[] }

/** Refuse comparisons when the evaluator, task set, model, or environment changed. */
export function compareCangjieReports(baseline: RunReport, candidate: RunReport) {
	const beforeCommunication = (baseline.testCommunication as { policy?: string } | undefined)?.policy
	const afterCommunication = (candidate.testCommunication as { policy?: string } | undefined)?.policy
	if (beforeCommunication !== afterCommunication) throw new Error("Evaluation conditions differ: testCommunication")
	const conditions = [
		"suiteVersion",
		"suiteHash",
		"sdk",
		"cjpmVersion",
		"model",
		"provider",
		"modelEndpoint",
		"evaluatorHash",
		"platform",
		"concurrency",
		"projectFingerprints",
		"plannedTasks",
	]
	const mismatches = conditions.filter(
		(key) => baseline[key] === undefined || JSON.stringify(baseline[key]) !== JSON.stringify(candidate[key]),
	)
	if (mismatches.length) throw new Error("Evaluation conditions differ: " + mismatches.join(", "))
	for (const run of [baseline, candidate]) {
		if (run.execution !== "real-agent" || run.suiteComplete !== true)
			throw new Error("Only complete real-agent task sets can be compared")
		if (
			run.tasks.length !== run.plannedTasks ||
			new Set(run.tasks.map((task) => task.caseId)).size !== run.tasks.length
		)
			throw new Error("Missing or duplicate task scores")
	}
	const rows = baseline.tasks.map((before) => {
		const after = candidate.tasks.find((task) => task.caseId === before.caseId)
		if (!after) throw new Error("Task sets differ")
		return {
			caseId: before.caseId,
			baselineSuccess: before.independentAgentSuccess,
			candidateSuccess: after.independentAgentSuccess,
			baselineFailure: before.failureReason,
			candidateFailure: after.failureReason,
		}
	})
	return {
		conditions: Object.fromEntries(conditions.map((key) => [key, baseline[key]])),
		baseline: {
			sourceRevision: baseline.sourceRevision,
			bundleHash: baseline.bundleHash,
			successes: baseline.independentAgentSuccesses,
			safetyGate: baseline.safetyGate,
			agentBaseline: baseline.agentBaseline,
		},
		candidate: {
			sourceRevision: candidate.sourceRevision,
			bundleHash: candidate.bundleHash,
			successes: candidate.independentAgentSuccesses,
			safetyGate: candidate.safetyGate,
			agentBaseline: candidate.agentBaseline,
		},
		improved: rows.filter((row) => !row.baselineSuccess && row.candidateSuccess).map((row) => row.caseId),
		regressed: rows.filter((row) => row.baselineSuccess && !row.candidateSuccess).map((row) => row.caseId),
		tasks: rows,
	}
}
