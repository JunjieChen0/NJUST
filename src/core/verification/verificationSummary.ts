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
): VerificationSummary {
	const check = (value: CheckState): VerificationSummary["build"] => {
		if (value.state === "not_run") return { state: value.state }
		return {
			state: value.state,
			exitCode: value.run.exitCode,
			logPath: value.run.logRef ? path.resolve(options.taskDir, value.run.logRef) : undefined,
			staleReason: value.state === "stale" ? value.staleReason : undefined,
			executed: value.run.testScope?.executed,
			passed: value.run.testScope?.passed,
			failed: value.run.testScope?.failed,
			skipped: value.run.testScope?.skipped,
		}
	}
	const changes = options.changes ?? []
	const notes = [options.note]
	for (const value of [verdict.build, verdict.test]) {
		if (value.state === "not_run" || value.state === "stale") continue
		const run = value.run
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
		acceptance: verdict.acceptance,
		claimId: verdict.latestClaim?.claimId,
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
