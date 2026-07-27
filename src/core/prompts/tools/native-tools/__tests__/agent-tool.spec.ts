import { describe, expect, it } from "vitest"

import agentTool from "../agent-tool"

describe("native agent tool", () => {
	it("exposes all Cangjie built-in agent types to native tool providers", () => {
		const parameters = agentTool.function.parameters as {
			properties: { agentType: { enum: unknown[]; description: string } }
		}
		const agentType = parameters.properties.agentType

		expect(agentType.enum).toEqual(
			expect.arrayContaining(["CangjieExplore", "CangjieImplement", "CangjieVerify", "CangjieRepair"]),
		)
		expect(agentType.description).toContain("CangjieVerify")
	})
})
