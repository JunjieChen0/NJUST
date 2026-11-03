import { describe, it, expect, beforeEach, afterEach } from "vitest"

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import {
	buildCangjieTestScope,
	parseCangjieTestReportXml,
	parseCangjieTestSummary,
	readCangjieTestReportDir,
} from "../cangjieTestReport"

// Captured from a real `cjpm test --report-format xml` run with Cangjie SDK 1.0.5.
const FAILING_SUITE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="cjdemo.CalcTest" tests="2" failures="1" errors="0" skipped="0" time="0.002404" timestamp="2026-11-02T15:06:14.7743726Z">
	<testcase name="addWorks" classname="cjdemo.CalcTest" assertions="1" time="0.000261"/>
	<testcase name="addFails" classname="cjdemo.CalcTest" assertions="1" time="0.000026">
		<failure>Expect Failed: \`(add(1, 1) == 3)\`</failure>
	</testcase>
</testsuite>`

const FAILING_STDOUT = `TP: cjdemo, time elapsed: 2404400 ns, RESULT:
    TCS: CalcTest, time elapsed: 2404400 ns, RESULT:
    [ PASSED ] CASE: addWorks (261300 ns)
    [ FAILED ] CASE: addFails (26200 ns)
Summary: TOTAL: 2
    PASSED: 1, SKIPPED: 0, ERROR: 0
    FAILED: 1, listed below:
            TCS: CalcTest, CASE: addFails
--------------------------------------------------------------------------------------------------
Project tests finished, time elapsed: 18147000 ns, RESULT:
TP: cjdemo.*, time elapsed: 18010100 ns, RESULT:
    FAILED:
Summary: TOTAL: 2
    PASSED: 1, SKIPPED: 0, ERROR: 0
    FAILED: 1
--------------------------------------------------------------------------------------------------
Error: cjpm test failed`

// Real output when `--filter` matched nothing: exit code 0 and "success", but nothing executed.
const ZERO_MATCH_STDOUT = `TP: cjdemo.*, time elapsed: 17426700 ns, RESULT:
    PASSED:
    TP: cjdemo, time elapsed: 657000 ns
Summary: TOTAL: 2
    PASSED: 0, SKIPPED: 2, ERROR: 0
    FAILED: 0
--------------------------------------------------------------------------------------------------
cjpm test success`

describe("parseCangjieTestReportXml", () => {
	it("sums suite counters across report files", () => {
		const second = FAILING_SUITE_XML.replace('tests="2" failures="1"', 'tests="3" failures="0"')

		expect(parseCangjieTestReportXml([FAILING_SUITE_XML, second])).toEqual({
			total: 5,
			passed: 4,
			failed: 1,
			skipped: 0,
		})
	})

	it("returns undefined when no suite element is present", () => {
		expect(parseCangjieTestReportXml(["<html/>"])).toBeUndefined()
		expect(parseCangjieTestReportXml([])).toBeUndefined()
	})

	it("returns undefined when a suite is missing a counter", () => {
		expect(parseCangjieTestReportXml(['<testsuite name="x" tests="2" skipped="0">'])).toBeUndefined()
	})
})

describe("parseCangjieTestSummary", () => {
	it("uses the final project summary", () => {
		expect(parseCangjieTestSummary(FAILING_STDOUT)).toEqual({ total: 2, passed: 1, failed: 1, skipped: 0 })
	})

	it("reports zero executed tests when everything was filtered out", () => {
		expect(parseCangjieTestSummary(ZERO_MATCH_STDOUT)).toEqual({ total: 2, passed: 0, failed: 0, skipped: 2 })
	})

	it("returns undefined without a summary", () => {
		expect(parseCangjieTestSummary("Error: cjpm test failed")).toBeUndefined()
	})
})

describe("buildCangjieTestScope", () => {
	it("counts executed tests as total minus skipped", () => {
		const counts = { total: 2, passed: 1, failed: 1, skipped: 0 }

		expect(buildCangjieTestScope("whole project", counts, counts)).toEqual({
			description: "whole project",
			executed: 2,
			passed: 1,
			failed: 1,
			skipped: 0,
		})
	})

	it("reports zero executed when every test was skipped", () => {
		const counts = parseCangjieTestSummary(ZERO_MATCH_STDOUT)

		expect(buildCangjieTestScope("whole project", undefined, counts)).toMatchObject({ executed: 0 })
	})

	it("leaves executed unknown when the report and summary disagree", () => {
		const scope = buildCangjieTestScope(
			"whole project",
			{ total: 2, passed: 2, failed: 0, skipped: 0 },
			{ total: 2, passed: 1, failed: 1, skipped: 0 },
		)

		expect(scope.executed).toBeUndefined()
		expect(scope.failed).toBe(1)
	})

	it("leaves executed unknown when neither source is available", () => {
		expect(buildCangjieTestScope("whole project", undefined, undefined)).toEqual({ description: "whole project" })
	})
})

describe("readCangjieTestReportDir", () => {
	let dir: string

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "cj-report-"))
	})

	afterEach(async () => {
		await fs.rm(dir, { recursive: true, force: true })
	})

	it("reads xml files recursively", async () => {
		await fs.mkdir(path.join(dir, "tests"), { recursive: true })
		await fs.writeFile(path.join(dir, "tests", "test-cjdemo.CalcTest.xml"), FAILING_SUITE_XML, "utf8")

		await expect(readCangjieTestReportDir(dir)).resolves.toEqual({ total: 2, passed: 1, failed: 1, skipped: 0 })
	})

	it("returns undefined for a missing directory", async () => {
		await expect(readCangjieTestReportDir(path.join(dir, "missing"))).resolves.toBeUndefined()
	})
})
