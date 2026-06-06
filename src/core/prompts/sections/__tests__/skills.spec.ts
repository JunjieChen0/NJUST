import { describe, it, expect, vi } from "vitest"

import { getSkillsSection, filterCangjieSkillRoutingRows } from "../skills"

describe("getSkillsSection", () => {
	it("should emit Markdown skills section with name, description, and location", async () => {
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

		expect(result).toContain("## Available Skills")
		expect(result).toContain("### pdf-processing")
		// No XML escaping — '&' passes through as-is in Markdown
		expect(result).toContain("**Description:** Extracts text & tables from PDFs")
		// For filesystem-based agents, location should be the absolute path to SKILL.md
		expect(result).toContain("**Location:** /abs/path/pdf-processing/SKILL.md")
	})

	it("filterCangjieSkillRoutingRows removes rows for undiscovered skills", () => {
		const md = "| a | **`cangjie-cjpm`** | x |\n| b | **`missing-skill`** | y |\n| c | no-skill-cell | z |\n"
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
		expect(build).toContain("### cangjie-cjpm")
		expect(build).not.toContain("skills-enhancement-plan")

		const learning = await getSkillsSection(mockSkillsManager, "cangjie", "制定学习规划")
		expect(learning).toContain("### skills-enhancement-plan")
		expect(learning).not.toContain("cangjie-cjpm")
	})

	it("should return empty string when skillsManager or currentMode is missing", async () => {
		await expect(getSkillsSection(undefined, "code")).resolves.toBe("")
		await expect(getSkillsSection({ getSkillsForMode: vi.fn() }, undefined)).resolves.toBe("")
	})
})
