import { describe, expect, it } from "vitest"
import { evaluateReportFacts, finalModelReport } from "../reportFacts.js"
import { cangjieTaskPrompt, type CangjieTaskCase } from "../suite.js"

const task: CangjieTaskCase = {
	id: "H03",
	project: "inventory",
	category: "locate",
	prompt: "Locate the reservation function",
	startingPoint: "clean",
	allowedChanges: [],
	requiredAssertions: ["report-correct"],
	reportFacts: { file: "src/stock.cj", function: "canReserve", zeroRequestedAllowed: false },
}
describe("deterministic report facts", () => {
	it("scores only the last assistant completion argument, excluding tool evidence and earlier drafts", () => {
		const good = JSON.stringify(task.reportFacts)
		const wrong = JSON.stringify({ ...task.reportFacts, zeroRequestedAllowed: true })
		const completion = (result: string) => ({ type: "tool_use", name: "attempt_completion", input: { result } })
		const history = [
			{ role: "assistant", content: [completion(good), completion(wrong)] },
			{ role: "user", content: [completion(good)] },
		]
		expect(finalModelReport(history)).toBe(wrong)
		expect(evaluateReportFacts(task, finalModelReport(history)!)).toBe(false)
		expect(finalModelReport([{ role: "assistant", content: [{ type: "text", text: good }] }])).toBeUndefined()
	})
	it("accepts complete correct facts independent of field order", () => {
		expect(
			evaluateReportFacts(
				task,
				JSON.stringify({ zeroRequestedAllowed: false, function: "canReserve", file: "src/stock.cj" }),
			),
		).toBe(true)
	})
	it.each([
		"src/stock.cj defines canReserve. Zero requests are allowed.",
		JSON.stringify({ ...task.reportFacts, zeroRequestedAllowed: true }),
		JSON.stringify({ ...task.reportFacts, explanation: "zero requests are allowed" }),
		JSON.stringify({ file: "src/stock.cj", function: "canReserve" }),
		JSON.stringify({ ...task.reportFacts, zeroRequestedAllowed: "false" }),
		'{"file":"src/stock.cj","function":"canReserve","zeroRequestedAllowed":true,"zeroRequestedAllowed":false}',
		"```json\n" + JSON.stringify(task.reportFacts) + "\n```",
	])("rejects a wrong, ambiguous or incomplete report: %s", (report) => {
		expect(evaluateReportFacts(task, report)).toBe(false)
	})
	it("rejects wrong H07 semantics even with the right file and function", () => {
		const textTask = {
			...task,
			id: "H07",
			reportFacts: {
				file: "src/text.cj",
				function: "wordCount",
				consecutiveSpacesCreateWords: false,
				emptyCount: 0,
			},
		}
		expect(evaluateReportFacts(textTask, JSON.stringify(textTask.reportFacts))).toBe(true)
		expect(evaluateReportFacts(textTask, JSON.stringify({ ...textTask.reportFacts, emptyCount: 1 }))).toBe(false)
		expect(
			evaluateReportFacts(
				textTask,
				JSON.stringify({ ...textTask.reportFacts, consecutiveSpacesCreateWords: true }),
			),
		).toBe(false)
	})
	it("exposes the schema but never the expected answers in the task prompt", () => {
		const prompt = cangjieTaskPrompt(task)
		expect(prompt).toContain("zeroRequestedAllowed: boolean")
		expect(prompt).not.toContain("canReserve")
		expect(prompt).not.toContain("false")
	})
})
