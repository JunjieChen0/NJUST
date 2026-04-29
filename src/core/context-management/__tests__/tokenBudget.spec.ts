import { describe, it, expect } from "vitest"
import { estimatePromptTokens, derivePromptTokenBudget } from "../../prompts/tokenBudget"

describe("estimatePromptTokens", () => {
	it("returns 0 for empty string", () => {
		expect(estimatePromptTokens("")).toBe(0)
	})

	it("returns 0 for null-like", () => {
		// @ts-expect-error testing edge case
		expect(estimatePromptTokens(null)).toBe(0)
	})

	it("estimates Latin text with ~3.5 chars/token", () => {
		const tokens = estimatePromptTokens("Hello world this is a test")
		expect(tokens).toBeGreaterThan(5)
		expect(tokens).toBeLessThan(15)
	})

	it("estimates CJK text with ~0.6 tokens per character", () => {
		const tokens = estimatePromptTokens("你好世界这是一个测试")
		// 9 CJK chars * 0.6 = 5.4 -> ceil 6
		expect(tokens).toBe(6)
	})

	it("estimates mixed CJK and Latin text", () => {
		const tokens = estimatePromptTokens("你好 world 测试 test")
		expect(tokens).toBeGreaterThan(0)
	})

	it("estimates pure code with higher ratio", () => {
		const code = "const foo = () => { return bar.baz(qux) }"
		const tokens = estimatePromptTokens(code)
		expect(tokens).toBeGreaterThan(5)
	})
})

describe("derivePromptTokenBudget", () => {
	it("returns null for undefined context window", () => {
		expect(derivePromptTokenBudget(undefined)).toBeNull()
	})

	it("returns null for zero context window", () => {
		expect(derivePromptTokenBudget(0)).toBeNull()
	})

	it("returns budget for 128k context window", () => {
		const budget = derivePromptTokenBudget(128_000)
		expect(budget).toBeDefined()
		expect(budget!.systemPromptMaxTokens).toBeGreaterThan(10_000)
		expect(budget!.toolDefinitionMaxTokens).toBeGreaterThan(5_000)
		expect(budget!.dialogHistoryMinTokens).toBeGreaterThan(30_000)
	})

	it("returns budget for small 8k context window", () => {
		const budget = derivePromptTokenBudget(8_000)
		expect(budget).toBeDefined()
		expect(budget!.systemPromptMaxTokens).toBeGreaterThanOrEqual(1200)
	})

	it("system prompt budget is ~15% of context", () => {
		const budget = derivePromptTokenBudget(100_000)
		expect(budget!.systemPromptMaxTokens).toBe(15_000)
	})
})
