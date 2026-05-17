import { describe, expect, it } from "vitest"

import {
	COMMON_ERROR_TABLE_TEMPLATE,
	CORE_PROJECT_TEMPLATE,
	DIAGNOSTIC_CODE_TEMPLATES,
	TEST_FILE_TEMPLATE,
	pushTemplateWithinBudget,
} from "../CangjiePromptTemplates"

describe("CangjiePromptTemplates", () => {
	it("exports non-empty reusable templates", () => {
		expect(CORE_PROJECT_TEMPLATE.length).toBeGreaterThan(0)
		expect(TEST_FILE_TEMPLATE.length).toBeGreaterThan(0)
		expect(COMMON_ERROR_TABLE_TEMPLATE.length).toBeGreaterThan(0)
		expect(DIAGNOSTIC_CODE_TEMPLATES.length).toBeGreaterThan(0)
	})

	it("pushes a template when budget is sufficient", () => {
		const parts: string[] = []

		const remaining = pushTemplateWithinBudget(parts, 10, "hello")

		expect(parts).toEqual(["hello"])
		expect(remaining).toBe(5)
	})

	it("does not mutate parts when budget is insufficient", () => {
		const parts = ["existing"]

		const remaining = pushTemplateWithinBudget(parts, 2, "hello")

		expect(parts).toEqual(["existing"])
		expect(remaining).toBe(2)
	})
})
