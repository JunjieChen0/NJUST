import { describe, expect, it } from "vitest"

import { applyToolResultBudget, getToolResultBudget, truncateToolResult } from "../toolResultBudget"

describe("tools/toolResultBudget", () => {
	it("computes sane budget bounds", () => {
		const budget = getToolResultBudget(200_000)
		expect(budget.singleMax).toBeGreaterThanOrEqual(500)
		expect(budget.totalMax).toBeGreaterThanOrEqual(500)
		expect(budget.singleMax).toBeLessThanOrEqual(30_000)
	})

	it("truncates long text and preserves head/tail with marker", () => {
		const long = `${"HEAD\n".repeat(500)}${"MIDDLE\n".repeat(3000)}${"TAIL\n".repeat(500)}`
		const out = truncateToolResult(long, 800)
		expect(out.length).toBeLessThan(long.length)
		expect(out).toContain("内容已裁剪")
		expect(out.startsWith("HEAD")).toBe(true)
		expect(out.includes("TAIL")).toBe(true)
	})

	it("compresses historical tool_result blocks, not current turn", () => {
		const huge = Array.from({ length: 2500 }, (_, i) => `line-${i} ${"x".repeat(40)}`).join("\n")
		const messages: any[] = [
			{ role: "user", content: "turn-1" },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: huge }] },
			{ role: "assistant", content: "ok" },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "b", content: huge }] }, // current turn
		]

		const out = applyToolResultBudget(messages as any, 200_000, 3)
		const hist = out[1].content[0].content as string
		const current = out[3].content[0].content as string

		expect(hist.length).toBeLessThan(huge.length)
		expect(hist).toContain("内容已裁剪")
		expect(current.length).toBe(huge.length)
	})
})
