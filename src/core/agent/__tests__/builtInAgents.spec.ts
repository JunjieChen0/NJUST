import { describe, expect, it } from "vitest"

import { BUILT_IN_AGENTS, getBuiltInAgent } from "../builtInAgents"

describe("BUILT_IN_AGENTS", () => {
	it("defines unique built-in agent types", () => {
		const agentTypes = BUILT_IN_AGENTS.map((agent) => agent.agentType)

		expect(new Set(agentTypes).size).toBe(agentTypes.length)
		expect(agentTypes).toEqual(expect.arrayContaining(["Explore", "Implement", "Verify", "Custom"]))
	})

	it("looks up agents by type", () => {
		expect(getBuiltInAgent("Explore")?.agentType).toBe("Explore")
		expect(getBuiltInAgent("missing")).toBeUndefined()
	})

	it("requires an explicit warning for bypass permission agents", () => {
		const bypassAgents = BUILT_IN_AGENTS.filter((agent) => agent.permissionMode === "bypassPermissions")

		expect(bypassAgents.length).toBeGreaterThan(0)
		for (const agent of bypassAgents) {
			expect(agent.permissionWarning).toMatch(/bypass/i)
			expect(agent.permissionWarning).toMatch(/read-only/i)
		}
	})

	it("does not add bypass warnings to normal permission agents", () => {
		const normalAgents = BUILT_IN_AGENTS.filter((agent) => agent.permissionMode !== "bypassPermissions")

		expect(normalAgents.length).toBeGreaterThan(0)
		for (const agent of normalAgents) {
			expect(agent.permissionWarning).toBeUndefined()
		}
	})

	it("keeps bypass permission agents read-only", () => {
		const bypassAgents = BUILT_IN_AGENTS.filter((agent) => agent.permissionMode === "bypassPermissions")
		const writeTools = new Set(["write_to_file", "apply_diff"])

		for (const agent of bypassAgents) {
			expect(agent.tools.some((tool) => writeTools.has(tool))).toBe(false)
		}
	})

	it("keeps Custom agent prompt parameterized by task and mode", () => {
		const custom = getBuiltInAgent("Custom")

		expect(typeof custom?.systemPrompt).toBe("function")
		expect(
			typeof custom?.systemPrompt === "function"
				? custom.systemPrompt({ mode: "code", taskDescription: "inspect api" })
				: "",
		).toContain("inspect api")
	})
})
