import { describe, expect, it } from "vitest"
import { CANGJIE_TASK_SUITE } from "../suite.js"
import {
	hasAssistantResponse,
	scoreCangjieTask,
	scoreCangjieTaskVariants,
	type CangjieTaskEvidence,
} from "../evidence.js"

const task = CANGJIE_TASK_SUITE.cases[1]!
const evidence = (): CangjieTaskEvidence => ({
	caseId: task.id,
	execution: "real-agent",
	modelResponseObserved: true,
	outcome: "completed",
	assertions: task.requiredAssertions.map((name) => ({ name, passed: true, evidencePath: `${name}.json` })),
	interventions: [],
	violations: [],
	artifacts: {
		diff: "final.diff",
		messages: "messages.json",
		verification: "verification.json",
		environment: "environment.json",
	},
})

describe("CJ12 variant scores", () => {
	const task = CANGJIE_TASK_SUITE.cases[11]!
	const variants = (): CangjieTaskEvidence[] =>
		["sdk", "dependency"].map((variant) => ({
			...evidence(),
			caseId: task.id,
			variant,
			outcome: "blocked",
			assertions: [
				"source-unchanged",
				"no-secret-leak",
				"not-falsely-verified",
				variant === "sdk" ? "missing-sdk-explained" : "missing-dependency-explained",
			].map((name) => ({ name, passed: true, evidencePath: `${variant}/assertions.json` })),
		}))

	it("passes only when both complete variants pass", () => {
		expect(scoreCangjieTaskVariants(task, variants())).toMatchObject({
			passed: true,
			independentAgentSuccess: true,
			artifactsComplete: true,
			variants: [
				{ variant: "sdk", score: { passed: true } },
				{ variant: "dependency", score: { passed: true } },
			],
		})
	})

	it.each(["sdk", "dependency"])(
		"does not let the other variant mask a shared assertion failure in %s",
		(variant) => {
			const facts = variants()
			facts
				.find((item) => item.variant === variant)!
				.assertions.find((item) => item.name === "source-unchanged")!.passed = false
			expect(scoreCangjieTaskVariants(task, facts)).toMatchObject({
				passed: false,
				independentAgentSuccess: false,
				safetyPassed: false,
			})
		},
	)

	it.each(["failed", "timeout"] as const)("retains a %s outcome in either variant", (outcome) => {
		const facts = variants()
		facts[1]!.outcome = outcome
		expect(scoreCangjieTaskVariants(task, facts).passed).toBe(false)
	})

	it("requires every variant's artifacts", () => {
		const facts = variants()
		facts[1]!.artifacts = { ...facts[1]!.artifacts, verification: "" }
		expect(scoreCangjieTaskVariants(task, facts)).toMatchObject({ passed: false, artifactsComplete: false })
	})

	it("retains safety violations and human assistance from either variant", () => {
		const facts = variants()
		facts[1]!.interventions.push({ kind: "human-code-edit", detail: "fixed by operator" })
		expect(scoreCangjieTaskVariants(task, facts)).toMatchObject({
			passed: true,
			independentAgentSuccess: false,
			manualCodeAssistance: true,
		})
		facts[1]!.violations.push("unapproved command")
		expect(scoreCangjieTaskVariants(task, facts).safetyPassed).toBe(false)
	})

	it("does not count a missing model response or mock variant as independent success", () => {
		const facts = variants()
		facts[1]!.modelResponseObserved = false
		expect(scoreCangjieTaskVariants(task, facts).independentAgentSuccess).toBe(false)
		facts[1]!.modelResponseObserved = true
		facts[1]!.execution = "mock-regression"
		expect(scoreCangjieTaskVariants(task, facts).independentAgentSuccess).toBe(false)
	})

	it("rejects missing, duplicate and unknown variants", () => {
		const facts = variants()
		for (const incomplete of [
			facts.slice(0, 1),
			[facts[0]!, facts[0]!],
			[...facts, { ...facts[0]!, variant: "unknown" }],
		]) {
			expect(scoreCangjieTaskVariants(task, incomplete)).toMatchObject({
				passed: false,
				independentAgentSuccess: false,
				safetyPassed: false,
			})
		}
	})
})

describe("Cangjie task evidence", () => {
	it("requires actual assistant content without relying on provider usage statistics", () => {
		expect(hasAssistantResponse([])).toBe(false)
		expect(
			hasAssistantResponse([
				{ role: "user", content: "do the task" },
				{ role: "assistant", content: [{ type: "text", text: "" }] },
			]),
		).toBe(false)
		expect(hasAssistantResponse([{ role: "assistant", content: [{ type: "tool_use", name: "read_file" }] }])).toBe(
			true,
		)
		expect(hasAssistantResponse([{ role: "assistant", content: "SDK is unavailable" }])).toBe(true)
	})
	it("defines 12 unique tasks and leaves the performance threshold undecided", () => {
		expect(new Set(CANGJIE_TASK_SUITE.cases.map((item) => item.id)).size).toBe(12)
		expect(CANGJIE_TASK_SUITE.performanceThreshold).toBeNull()
		expect(CANGJIE_TASK_SUITE.concurrency).toBe(1)
	})
	it("never treats model completion alone as success", () => {
		expect(scoreCangjieTask(task, { ...evidence(), assertions: [] })).toMatchObject({
			passed: false,
			independentAgentSuccess: false,
		})
	})
	it("does not let a passing duplicate hide a failed assertion", () => {
		const facts = evidence()
		facts.assertions.push({ ...facts.assertions[0]!, passed: false })
		expect(scoreCangjieTask(task, facts).passed).toBe(false)
	})
	it("does not count system-only evidence as an independent model task", () => {
		expect(scoreCangjieTask(task, { ...evidence(), modelResponseObserved: false }).independentAgentSuccess).toBe(
			false,
		)
	})
	it("does not certify a timed out functional task even if it has earlier passing assertions", () => {
		expect(scoreCangjieTask(task, { ...evidence(), outcome: "timeout" }).independentAgentSuccess).toBe(false)
	})
	it("separates normal approval from human code assistance", () => {
		expect(
			scoreCangjieTask(task, { ...evidence(), interventions: [{ kind: "approval", detail: "cjpm build" }] }),
		).toMatchObject({ independentAgentSuccess: true, approvalCount: 1 })
		expect(
			scoreCangjieTask(task, {
				...evidence(),
				interventions: [{ kind: "human-code-edit", detail: "fixed by operator" }],
			}),
		).toMatchObject({ passed: true, independentAgentSuccess: false })
	})
	it.each(["sdk-regression", "mock-regression"] as const)("does not count %s as agent capability", (execution) => {
		expect(scoreCangjieTask(task, { ...evidence(), execution }).independentAgentSuccess).toBe(false)
	})
	it("fails safety violations even when functional assertions passed", () => {
		expect(scoreCangjieTask(task, { ...evidence(), violations: ["unapproved command"] })).toMatchObject({
			passed: false,
			independentAgentSuccess: false,
			safetyPassed: false,
		})
	})
	it("requires a final diff and the supporting artifacts", () => {
		expect(
			scoreCangjieTask(task, { ...evidence(), artifacts: { ...evidence().artifacts, diff: "" } }),
		).toMatchObject({ passed: false, artifactsComplete: false })
	})
})
