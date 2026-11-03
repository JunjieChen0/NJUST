import { useTranslation } from "react-i18next"
import type { ClineMessage, VerificationSummary } from "@njust-ai/types"
import { vscode } from "@src/utils/vscode"

export function VerificationCard({
	summary,
	ts,
	isLatest,
}: {
	summary: VerificationSummary
	ts: number
	isLatest: boolean
}) {
	const { t } = useTranslation()
	const colors = {
		verified: "var(--vscode-testing-iconPassed)",
		failed: "var(--vscode-errorForeground)",
		incomplete: "var(--vscode-editorWarning-foreground)",
		no_record: "var(--vscode-descriptionForeground)",
	}
	const state = (check: VerificationSummary["build"]) =>
		check.state === "stale"
			? t(
					`chat:verification.${check.staleReason === "environment_changed" ? "environmentChanged" : "codeChanged"}`,
				)
			: t(`chat:verification.states.${check.state}`)
	const stale = summary.build.state === "stale" || summary.test.state === "stale"
	const decide = (decision: "accepted" | "changes_requested") =>
		vscode.postMessage({
			type: "verificationDecision",
			verificationDecision: { ts, decision, claimId: summary.claimId },
		})
	return (
		<section
			aria-label={t("chat:verification.title")}
			className="mt-3 rounded border border-vscode-panel-border p-3 text-sm"
			data-verification-status={summary.overall}>
			<strong style={{ color: colors[summary.overall] }}>
				{t(`chat:verification.overall.${summary.overall}`)}
			</strong>
			{summary.terminal && <div>{t(`chat:verification.terminal.${summary.terminal}`)}</div>}
			<div>
				{t("chat:verification.build")}: {state(summary.build)}
				{summary.build.exitCode != null &&
					` (${t("chat:verification.exitCode", { code: summary.build.exitCode })})`}
			</div>
			<div>
				{t("chat:verification.test")}: {state(summary.test)}
				{summary.test.executed !== undefined &&
					` — ${t("chat:verification.testCounts", { passed: summary.test.passed ?? 0, failed: summary.test.failed ?? 0, skipped: summary.test.skipped ?? 0 })}`}
			</div>
			{stale && summary.changes && (
				<div className="mt-2">
					<div>
						{t("chat:verification.changes", {
							taskTool: summary.changes.taskTool,
							other: summary.changes.other,
						})}
					</div>
					<div className="break-all">{summary.changes.files.join(", ")}</div>
					{summary.changes.other > 0 && (
						<div className="break-all">
							{t("chat:verification.otherChanges")}:{" "}
							{summary.changes.otherFiles?.join(", ") ?? summary.changes.other}
						</div>
					)}
				</div>
			)}
			<div className="mt-2 flex gap-3">
				{summary.build.logPath && (
					<button
						className="text-vscode-textLink-foreground underline"
						onClick={() => vscode.postMessage({ type: "openFile", text: summary.build.logPath })}>
						{t("chat:verification.buildLog")}
					</button>
				)}
				{summary.test.logPath && (
					<button
						className="text-vscode-textLink-foreground underline"
						onClick={() => vscode.postMessage({ type: "openFile", text: summary.test.logPath })}>
						{t("chat:verification.testLog")}
					</button>
				)}
			</div>
			{summary.note && <div className="mt-2">{summary.note}</div>}
			<div className="mt-2">{t(`chat:verification.acceptance.${summary.acceptance}`)}</div>
			{stale && <div className="mt-2">{t("chat:verification.reverifyRequired")}</div>}
			{summary.acceptance === "pending" && summary.claimId && isLatest && !summary.terminal && !stale && (
				<div className="mt-2 flex flex-wrap items-center gap-2">
					<button
						className="rounded border border-vscode-button-border px-2 py-1"
						onClick={() => decide("accepted")}>
						{t("chat:verification.accept")}
					</button>
					<button
						className="rounded border border-vscode-button-border px-2 py-1"
						onClick={() => decide("changes_requested")}>
						{t("chat:verification.requestChanges")}
					</button>
					{summary.overall !== "verified" && (
						<span className="text-vscode-descriptionForeground">{t("chat:verification.unverified")}</span>
					)}
				</div>
			)}
		</section>
	)
}

export function isLatestVerificationMessage(message: ClineMessage, messages: readonly ClineMessage[]): boolean {
	const latest = [...messages]
		.reverse()
		.find(
			(item) =>
				item.say === "completion_result" ||
				item.say === "verification_summary" ||
				(item.ask === "completion_result" && Boolean(item.text)),
		)
	return (
		latest?.id === message.id &&
		latest?.ts === message.ts &&
		latest?.verification?.claimId === message.verification?.claimId
	)
}
