import * as fs from "fs/promises"
import * as path from "path"

import type { VerificationRun } from "./types"

type TestScope = NonNullable<VerificationRun["testScope"]>

/** Test counters from one `cjpm test` run. `failed` includes errored cases. */
export interface CangjieTestCounts {
	total: number
	passed: number
	failed: number
	skipped: number
}

const TESTSUITE_TAG_RE = /<testsuite\b[^>]*>/g
const SUMMARY_RE =
	/Summary:\s*TOTAL:\s*(\d+)\s+PASSED:\s*(\d+),\s*SKIPPED:\s*(\d+),\s*ERROR:\s*(\d+)\s+FAILED:\s*(\d+)/g

function readIntAttribute(tag: string, name: string): number | undefined {
	const match = tag.match(new RegExp(`\\b${name}="(\\d+)"`))
	return match ? Number(match[1]) : undefined
}

/** Sum the `<testsuite>` counters of JUnit-style XML reports written by `cjpm test --report-format xml`. */
export function parseCangjieTestReportXml(xmlTexts: readonly string[]): CangjieTestCounts | undefined {
	let total = 0
	let failed = 0
	let skipped = 0
	let suites = 0

	for (const xml of xmlTexts) {
		for (const tag of xml.match(TESTSUITE_TAG_RE) ?? []) {
			const tests = readIntAttribute(tag, "tests")
			const failures = readIntAttribute(tag, "failures")
			const errors = readIntAttribute(tag, "errors")
			const skippedCount = readIntAttribute(tag, "skipped")
			if (tests === undefined || failures === undefined || errors === undefined || skippedCount === undefined) {
				return undefined
			}
			total += tests
			failed += failures + errors
			skipped += skippedCount
			suites += 1
		}
	}

	if (suites === 0) return undefined
	return { total, passed: total - failed - skipped, failed, skipped }
}

/** Parse the final (project-level) `Summary:` block printed by `cjpm test`. */
export function parseCangjieTestSummary(output: string): CangjieTestCounts | undefined {
	const matches = [...output.matchAll(SUMMARY_RE)]
	const last = matches.at(-1)
	if (!last) return undefined
	const [total = 0, passed = 0, skipped = 0, errors = 0, failures = 0] = last.slice(1).map(Number)
	return { total, passed, failed: failures + errors, skipped }
}

/** Read and parse every XML report under `reportDir`; undefined when none exist. */
export async function readCangjieTestReportDir(reportDir: string): Promise<CangjieTestCounts | undefined> {
	let entries: string[]
	try {
		entries = (await fs.readdir(reportDir, { recursive: true })) as string[]
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
		throw error
	}
	const xmlFiles = entries.filter((entry) => entry.toLowerCase().endsWith(".xml"))
	const texts = await Promise.all(xmlFiles.map((entry) => fs.readFile(path.join(reportDir, entry), "utf8")))
	return parseCangjieTestReportXml(texts)
}

function sameCounts(a: CangjieTestCounts, b: CangjieTestCounts): boolean {
	return a.total === b.total && a.failed === b.failed && a.skipped === b.skipped
}

/**
 * Build the recorded test scope. The XML report is preferred and cross-checked against
 * the printed summary; when they disagree (or neither exists) the executed count is left
 * unknown so the run can never count as passing. Any reported failure is preserved.
 */
export function buildCangjieTestScope(
	description: string,
	report: CangjieTestCounts | undefined,
	summary: CangjieTestCounts | undefined,
): TestScope {
	if (report && summary && !sameCounts(report, summary)) {
		return { description, failed: Math.max(report.failed, summary.failed) }
	}
	const counts = report ?? summary
	if (!counts) return { description }
	return {
		description,
		executed: counts.total - counts.skipped,
		passed: counts.passed,
		failed: counts.failed,
		skipped: counts.skipped,
	}
}
