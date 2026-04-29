import { getSkillsSection, filterCangjieSkillRoutingRows } from "../skills"

describe("getSkillsSection", () => {
	it("should emit <available_skills> XML with name, description, and location", async () => {
		const mockSkillsManager = {
			getSkillsForMode: vi.fn().mockReturnValue([
				{
					name: "pdf-processing",
					description: "Extracts text & tables from PDFs",
					path: "/abs/path/pdf-processing/SKILL.md",
					source: "global" as const,
				},
			]),
		}

		const result = await getSkillsSection(mockSkillsManager, "code")

		expect(result).toContain("<available_skills>")
		expect(result).toContain("</available_skills>")
		expect(result).toContain("<skill>")
		expect(result).toContain("<name>pdf-processing</name>")
		// Ensure XML escaping for '&'
		expect(result).toContain("<description>Extracts text &amp; tables from PDFs</description>")
		// For filesystem-based agents, location should be the absolute path to SKILL.md
		expect(result).toContain("<location>/abs/path/pdf-processing/SKILL.md</location>")
	})

	it("filterCangjieSkillRoutingRows removes rows for undiscovered skills", () => {
		const md =
			"| a | **`cangjie-cjpm`** | x |\n| b | **`missing-skill`** | y |\n| c | no-skill-cell | z |\n"
		const filtered = filterCangjieSkillRoutingRows(md, new Set(["cangjie-cjpm"]))
		expect(filtered).toContain("cangjie-cjpm")
		expect(filtered).not.toContain("missing-skill")
		expect(filtered).toContain("no-skill-cell")
	})

	it("lazily exposes Cangjie workflow skills only for matching scenarios", async () => {
		const mockSkillsManager = {
			getSkillsForMode: vi.fn().mockReturnValue([
				{
					name: "cangjie-cjpm",
					description: "Cangjie build workflow",
					path: "/skills/cangjie-cjpm/SKILL.md",
					source: "global" as const,
				},
				{
					name: "skills-enhancement-plan",
					description: "Learning plan",
					path: "/skills/skills-enhancement-plan/SKILL.md",
					source: "global" as const,
				},
			]),
		}

		const plain = await getSkillsSection(mockSkillsManager, "cangjie", "implement HashMap usage")
		expect(plain).toBe("")

		const build = await getSkillsSection(mockSkillsManager, "cangjie", "cjpm build fails")
		expect(build).toContain("<name>cangjie-cjpm</name>")
		expect(build).not.toContain("skills-enhancement-plan")

		const learning = await getSkillsSection(mockSkillsManager, "cangjie", "制定学习规划")
		expect(learning).toContain("<name>skills-enhancement-plan</name>")
		expect(learning).not.toContain("cangjie-cjpm")
	})

	it("should return empty string when skillsManager or currentMode is missing", async () => {
		await expect(getSkillsSection(undefined, "code")).resolves.toBe("")
		await expect(getSkillsSection({ getSkillsForMode: vi.fn() }, undefined)).resolves.toBe("")
	})
})
