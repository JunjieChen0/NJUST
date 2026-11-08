import type { CangjieTaskCase } from "./suite.js"

export const REPORT_SCORER_VERSION = "structured-facts-1"

/** Read the model's final tool argument, before the extension appends its evidence audit. */
export function finalModelReport(history: readonly unknown[]): string | undefined {
	let report: string | undefined
	for (const message of history) {
		if (
			!message ||
			typeof message !== "object" ||
			!("role" in message) ||
			message.role !== "assistant" ||
			!("content" in message) ||
			!Array.isArray(message.content)
		)
			continue
		for (const block of message.content) {
			if (block?.type === "tool_use" && block.name === "attempt_completion")
				report = typeof block.input?.result === "string" ? block.input.result : undefined
		}
	}
	return report
}

/** Only a final report with every required fact correct can pass. No model-based judge. */
export function evaluateReportFacts(task: CangjieTaskCase, report: string): boolean {
	const expected = task.reportFacts
	if (!expected || Object.keys(expected).length === 0) return false
	try {
		const parsed: unknown = JSON.parse(report)
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false
		const entries = Object.entries(parsed)
		// Flat primitive reports must have one occurrence of each key, including before JSON parsing.
		const keys = [...report.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)].map((match) => JSON.parse(match[1]!) as string)
		return (
			keys.length === entries.length &&
			entries.length === Object.keys(expected).length &&
			entries.every(([key, value]) => Object.hasOwn(expected, key) && value === expected[key])
		)
	} catch {
		// Invalid model output is a failed assertion, not a scorer exception.
		return false
	}
}
