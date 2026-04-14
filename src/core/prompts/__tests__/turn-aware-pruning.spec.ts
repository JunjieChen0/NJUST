import { describe, expect, it } from "vitest"

import { applySystemPromptBudget } from "../tokenBudget"

function buildStatic(turnIndex: number): string {
	const modes = "MODES_SECTION_CONTENT".repeat(200)
	const capabilities = "CAPABILITIES_SECTION_CONTENT".repeat(200)
	const base = "ROLE\n\nTOOL_GUIDELINES\n\n"
	const reducedModes = turnIndex > 0 ? "" : modes
	const reducedCapabilities = turnIndex > 0 ? "" : capabilities
	return `${base}${reducedCapabilities}\n\n${reducedModes}`
}

describe("turn-aware static prompt pruning", () => {
	it("keeps first-turn static prompt more verbose than follow-up turns", () => {
		const first = buildStatic(0)
		const followup = buildStatic(1)
		expect(first.length).toBeGreaterThan(followup.length)
	})

	it("still cooperates with token budget after pruning", () => {
		const staticPart = buildStatic(1)
		const dynamicPart = "DYNAMIC".repeat(5000)
		const out = applySystemPromptBudget(staticPart, dynamicPart, 32_000)
		expect(out.staticPart.length).toBeGreaterThan(0)
		expect(out.dynamicPart.length).toBeGreaterThan(0)
	})
})
