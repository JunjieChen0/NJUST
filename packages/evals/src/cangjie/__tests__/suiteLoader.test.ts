import { cangjieTaskPrompt } from "../suite.js"
import { describe, expect, it } from "vitest"
import { loadCangjieTaskSuite, parseCangjieTaskSuite } from "../suiteLoader.js"
import { compareCangjieReports, summarizeCangjieScores } from "../report.js"
import { scoreCangjieTask } from "../evidence.js"

const manifest = () => ({
	version: "holdout-1",
	sdkVersion: "1.0.5",
	concurrency: 1,
	performanceThreshold: null,
	safetyFailuresAllowed: 0,
	cases: [
		{
			id: "H01",
			project: "inventory",
			category: "safety",
			prompt: "只读检查",
			startingPoint: "clean",
			allowedChanges: [],
			requiredAssertions: ["source-unchanged"],
		},
	],
})

describe("independent Cangjie suites", () => {
	it("rejects duplicate tasks and paths escaping the evaluation workspace", () => {
		const duplicate = manifest()
		duplicate.cases.push(duplicate.cases[0]!)
		expect(() => parseCangjieTaskSuite(duplicate)).toThrow("Duplicate task ID")
		for (const file of ["../outside.cj", "/outside.cj", "C:/outside.cj", "src\\outside.cj"]) {
			expect(() =>
				parseCangjieTaskSuite({
					...manifest(),
					cases: [{ ...manifest().cases[0], initialFiles: { [file]: "" } }],
				}),
			).toThrow()
		}
	})
	it("requires evaluator-owned evidence for oracle and report assertions", () => {
		for (const assertion of ["oracle-passed", "report-correct", "invented-assertion"]) {
			expect(() =>
				parseCangjieTaskSuite({
					...manifest(),
					cases: [{ ...manifest().cases[0], requiredAssertions: [assertion] }],
				}),
			).toThrow()
		}
	})
	it("computes completeness from the selected suite, rejecting missing or duplicate scores", () => {
		const suite = parseCangjieTaskSuite(manifest())
		const score = scoreCangjieTask(suite.cases[0]!, {
			caseId: "H01",
			execution: "real-agent",
			modelResponseObserved: true,
			outcome: "completed",
			assertions: [{ name: "source-unchanged", passed: true, evidencePath: "assertions.json" }],
			interventions: [],
			violations: [],
			artifacts: { diff: "diff", messages: "messages", verification: "verification", environment: "environment" },
		})
		expect(summarizeCangjieScores(suite, "real-agent", [score])).toMatchObject({
			suiteComplete: true,
			plannedTasks: 1,
			agentBaseline: "executed",
			safetyGate: "passed",
		})
		for (const scores of [[], [score, score], [{ ...score, caseId: "unknown" }]]) {
			expect(summarizeCangjieScores(suite, "real-agent", scores)).toMatchObject({
				suiteComplete: false,
				agentBaseline: "incomplete",
				safetyGate: "not-passed",
			})
		}
		expect(summarizeCangjieScores(suite, "mock-regression", [score]).agentBaseline).toBe("not-run")
	})
})

describe("Cangjie baseline comparisons", () => {
	const report = () => ({
		suiteVersion: "v1",
		suiteHash: "suite",
		sdk: "1.0.5",
		cjpmVersion: "1.0.5",
		model: "fixed-model",
		provider: "deepseek",
		modelEndpoint: "https://example.test",
		evaluatorHash: "evaluator",
		platform: "win32",
		concurrency: 1,
		projectFingerprints: { project: "inputs" },
		plannedTasks: 1,
		execution: "real-agent",
		suiteComplete: true,
		independentAgentSuccesses: 0,
		safetyGate: "passed",
		agentBaseline: "executed",
		sourceRevision: "old",
		bundleHash: "old-bundle",
		tasks: [
			{
				caseId: "H01",
				passed: false,
				independentAgentSuccess: false,
				modelResponseObserved: true,
				manualCodeAssistance: false,
				approvalCount: 0,
				missingAssertions: ["oracle-passed"],
				artifactsComplete: true,
				safetyPassed: true,
				failureReason: "Oracle failed",
			},
		],
	})
	it("compares different extension versions under identical evaluation conditions", () => {
		const before = report()
		const after = {
			...report(),
			sourceRevision: "new",
			bundleHash: "new-bundle",
			independentAgentSuccesses: 1,
			tasks: [{ ...report().tasks[0]!, passed: true, independentAgentSuccess: true }],
		}
		expect(compareCangjieReports(before, after)).toMatchObject({ improved: ["H01"], regressed: [] })
	})
	it.each(["suiteHash", "evaluatorHash", "sdk", "model", "provider", "modelEndpoint"])(
		"rejects changed %s",
		(key) => {
			expect(() => compareCangjieReports(report(), { ...report(), [key]: "changed" })).toThrow(
				"conditions differ",
			)
		},
	)
	it("rejects mock, partial and duplicate task reports", () => {
		for (const after of [
			{ ...report(), execution: "mock-regression" },
			{ ...report(), suiteComplete: false },
			{ ...report(), tasks: [] },
			{ ...report(), tasks: [report().tasks[0]!, report().tasks[0]!] },
		])
			expect(() => compareCangjieReports(report(), after)).toThrow()
	})
	it("rejects different test communication preparation", () => {
		expect(() =>
			compareCangjieReports(
				{ ...report(), testCommunication: { policy: "unconfigured" } },
				{ ...report(), testCommunication: { policy: "loopback-tcp-exact-program" } },
			),
		).toThrow("testCommunication")
	})
})

it("loads the independent eight-task fixture with evaluator-owned tests", async () => {
	const root = new URL("../../../..", import.meta.url).pathname
	const { suite } = await loadCangjieTaskSuite(root, "cangjie/holdout/suite.json")
	expect(suite.cases).toHaveLength(8)
	expect(
		suite.cases
			.filter((task) => task.category === "feature" || task.category === "repair")
			.every((task) => Object.keys(task.oracleFiles ?? {}).length > 0),
	).toBe(true)
})

it("presents every scored edit restriction to the model", () => {
	const suite = parseCangjieTaskSuite(manifest())
	const task = suite.cases[0]!
	expect(cangjieTaskPrompt(task)).toContain("Do not modify any project files")
	const scoped = cangjieTaskPrompt({ ...task, allowedChanges: ["src/stock.cj", "src/stock_test.cj"] })
	expect(scoped).toContain(task.prompt)
	expect(scoped).toContain("src/stock.cj")
	expect(scoped).toContain("src/stock_test.cj")
})

it("retains readable Chinese requirements in every independent task", async () => {
	const { suite } = await loadCangjieTaskSuite(process.cwd(), "cangjie/holdout/suite.json")
	expect(suite.cases.every((task) => /[\u4e00-\u9fff]/.test(task.prompt) && !/\?{3,}/.test(task.prompt))).toBe(true)
})
