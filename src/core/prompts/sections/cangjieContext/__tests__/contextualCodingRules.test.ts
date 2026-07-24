import { describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"

vi.mock("vscode", () => ({
	window: {
		visibleTextEditors: [],
	},
	DiagnosticSeverity: {
		Error: 0,
		Warning: 1,
		Information: 2,
		Hint: 3,
	},
}))

vi.mock("../cangjie-context", () => ({
	getCangjiePromptServices: vi.fn(() => ({
		getCangjieErrorAnalyzer: vi.fn(() => ({
			matchCjcErrorPattern: vi.fn(() => null),
		})),
	})),
}))

const { buildContextualCodingRules } = await import("../contextualCodingRules")

describe("buildContextualCodingRules", () => {
	it("injects safe Option handling guidance for visible Cangjie files", () => {
		vi.mocked(vscode.window.visibleTextEditors).push({
			document: {
				languageId: "cangjie",
				fileName: "src/main.cj",
			},
		} as any)

		const section = buildContextualCodingRules([], null, [])

		expect(section).toContain("avoid unguarded `getOrThrow()`")
		expect(section).toContain("getOrDefault({ => ... })")
		expect(section).toContain("match")
		expect(section).toContain("None")
		expect(section).toContain("prefer raw string patterns")
		expect(section).toContain('#"\\d+"#')
		expect(section).toContain("Do not apply the struct mut-method rule to HashMap.add")
	})
})
