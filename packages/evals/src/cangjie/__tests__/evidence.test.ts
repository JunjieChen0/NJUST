import { describe, expect, it } from "vitest"
import { CANGJIE_TASK_SUITE } from "../suite.js"
import { hasAssistantResponse, scoreCangjieTask, type CangjieTaskEvidence } from "../evidence.js"

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
