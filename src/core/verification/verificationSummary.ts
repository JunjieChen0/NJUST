import * as path from "path"
import type { VerificationSummary } from "@njust-ai/types"
import type { AttributedChange } from "./types"
import type { CheckState, VerificationVerdict } from "./verdict"

/** Build display data exclusively from recorded system facts. */
export function buildVerificationSummary(
	verdict: VerificationVerdict,
	options: {
		taskDir: string
		changes?: readonly AttributedChange[]
		note?: string
		terminal?: VerificationSummary["terminal"]
	},
	currentFingerprint?: string,
): VerificationSummary {
	const check = (value: CheckState): VerificationSummary["build"] => {
		if (value.state === "not_run")
			return value.cwd ? { state: value.state, cwd: value.cwd } : { state: value.state }
		return {
			state: value.state,
			exitCode: value.run.exitCode,
			logPath: value.run.logRef ? path.resolve(options.taskDir, value.run.logRef) : undefined,
			staleReason: value.state === "stale" ? value.staleReason : undefined,
			executable: value.run.executable,
			args: value.run.args,
			cwd: value.run.cwd,
			startedAt: value.run.startedAt,
			endedAt: value.run.endedAt,
			executed: value.run.testScope?.executed,
			passed: value.run.testScope?.passed,
			failed: value.run.testScope?.failed,
			skipped: value.run.testScope?.skipped,
		}
	}
	const changes = options.changes ?? []
	const notes = [options.note, ...(verdict.gaps ?? []).map((gap) => `Input coverage: ${gap}`)]
	for (const value of [verdict.build, verdict.test, ...(verdict.relatedTests ?? [])]) {
		if (value.state === "not_run" || value.state === "stale") continue
		const run = value.run
		if (run.source === "model_command")
			notes.push(`${run.kind}: model-requested command from task ${run.taskId}; not system verification`)
		if (run.source === "model_command" && run.testScope?.filter)
			notes.push(`test: result applies only to filter ${run.testScope.filter}; whole-project outcome is unknown`)
		const detail = run.abortDetail ?? run.abortReason?.replaceAll("_", " ")
		if (detail) notes.push(`${run.kind}: ${detail}`)
		if (run.inputFingerprint && run.inputFingerprintAfter && run.inputFingerprint !== run.inputFingerprintAfter)
			notes.push(`${run.kind}: verification inputs changed while the command was running`)
		if (
			run.kind === "test" &&
			value.state === "inconclusive" &&
			run.exitCode === 0 &&
			run.testScope?.executed === undefined
		)
			notes.push("Test execution counts could not be determined")
	}
	return {
		overall: verdict.overall,
		build: check(verdict.build),
		test: check(verdict.test),
		relatedTests: verdict.relatedTests?.map(check),
		acceptance: verdict.acceptance,
		claimId: verdict.latestClaim?.claimId,
		delivery: verdict.latestClaim?.delivery,
		currentFingerprint,
		changes: changes.length
			? {
					taskTool: changes.filter((change) => change.source === "task_tool").length,
					other: changes.filter((change) => change.source === "other").length,
					files: changes.slice(0, 10).map((change) => change.path),
					otherFiles: changes
						.filter((change) => change.source === "other")
						.slice(0, 10)
						.map((change) => change.path),
				}
			: undefined,
		note: [...new Set(notes.filter(Boolean))].join("\n") || undefined,
		terminal: options.terminal,
	}
}
