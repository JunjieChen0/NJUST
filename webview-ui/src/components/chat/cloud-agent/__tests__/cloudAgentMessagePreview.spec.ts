import {
	buildCloudAgentPreviewSummary,
	getCloudAgentCardSummary,
	getCloudAgentInnerText,
	shouldCollapseCloudAgentText,
} from "../cloudAgentMessagePreview"

describe("cloudAgentMessagePreview", () => {
	it("builds a preview from prefixed JSON text", () => {
		const raw = `1. [OK] write_file {"isError":false,"text":"First line\\nSecond line"}`

		expect(buildCloudAgentPreviewSummary(raw)).toBe("1. [OK] write_file\nFirst line")
		expect(getCloudAgentInnerText(raw)).toBe("First line\nSecond line")
	})

	it("falls back to text regex when balanced JSON parse fails", () => {
		const raw = `prefix {"isError":false,"text":"Use { braces } safely\\nNext"`

		expect(buildCloudAgentPreviewSummary(raw)).toBe("prefix\nUse { braces } safely")
		expect(getCloudAgentInnerText(raw)).toBe("Use { braces } safely\nNext")
	})

	it("summarizes plain short and long text without JSON", () => {
		expect(buildCloudAgentPreviewSummary("short answer")).toBe("short answer")

		const longFirstLine = "x".repeat(420)
		const summary = buildCloudAgentPreviewSummary(`${longFirstLine}\nsecond line`)
		expect(summary.startsWith("x".repeat(300))).toBe(true)
		expect(summary.length).toBeGreaterThan(300)
		expect(summary.length).toBeLessThan(330)
	})

	it("applies collapse threshold only to complete long messages", () => {
		expect(shouldCollapseCloudAgentText(undefined)).toBe(false)
		expect(shouldCollapseCloudAgentText("x".repeat(419))).toBe(false)
		expect(shouldCollapseCloudAgentText("x".repeat(420))).toBe(true)
		expect(shouldCollapseCloudAgentText("x".repeat(420), true)).toBe(false)
	})

	it("extracts card summary title and hint from frontmatter", () => {
		const raw = `{"text":"---\\nname: Deploy Skill\\ndescription: \\"Runs deploy checks\\"\\n---\\nbody"}`

		expect(getCloudAgentCardSummary(raw)).toEqual({
			title: "Deploy Skill",
			hint: "Runs deploy checks",
		})
	})

	it("uses first human line for card summary and hides transport logs", () => {
		expect(getCloudAgentCardSummary('[OK] write_file {"text":"raw"}')).toEqual({
			title: "",
			hint: null,
		})

		expect(getCloudAgentCardSummary("Human visible line\nSecond line")).toEqual({
			title: "Human visible line",
			hint: null,
		})
	})
})
