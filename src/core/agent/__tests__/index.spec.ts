import { describe, expect, it } from "vitest"

import { CANGJIE_EVAL_CASES, evaluateCangjieObservations, formatCangjieEvalBehavior, getBuiltInAgent } from "../index"

describe("agent index exports", () => {
	it("exports Cangjie eval helpers from the public agent entrypoint", () => {
		expect(CANGJIE_EVAL_CASES).toHaveLength(10)
		expect(getBuiltInAgent("CangjieVerify")?.agentType).toBe("CangjieVerify")

		const result = evaluateCangjieObservations([
			{
				caseId: "hello-world-project",
				text: "Read cjpm.toml and package declaration. Made a minimal edit. Ran cjpm build and build passed.",
			},
		])

		expect(result.report.passed).toBe(1)
		expect(result.markdown).toContain("All evaluated Cangjie cases passed.")
		expect(formatCangjieEvalBehavior("run-cjpm-build")).toBe("run cjpm build")
	})
})
