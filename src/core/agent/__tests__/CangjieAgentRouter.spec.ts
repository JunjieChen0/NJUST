import { describe, expect, it } from "vitest"

import { buildCangjieAgentRoutingSection, routeCangjieAgentTask } from "../CangjieAgentRouter"

describe("routeCangjieAgentTask", () => {
	it("keeps implementation ahead of verification wording", () => {
		expect(routeCangjieAgentTask("新增 tripleValue 函数并编译验证")).toMatchObject({
			kind: "implement",
			stages: ["CangjieExplore", "CangjieImplement", "CangjieVerify"],
		})
	})

	it("routes the ArrayList roadmap case through evidence, implementation, and verification", () => {
		expect(
			routeCangjieAgentTask(
				"新增一个使用 ArrayList.add 的 duplicateStrings 函数，实现前查 CangjieCorpus，并运行 cjpm build 验证。",
			),
		).toMatchObject({
			kind: "implement",
			stages: ["CangjieExplore", "CangjieImplement", "CangjieVerify"],
		})
	})

	it("keeps command-only requests verification-only", () => {
		expect(routeCangjieAgentTask("只运行 cjpm build 验证项目")).toMatchObject({
			kind: "verify",
			stages: ["CangjieVerify"],
		})
	})

	it("routes a failed implementation verification through repair and back to verify", () => {
		const completed = ["CangjieExplore", "CangjieImplement", "CangjieVerify"]
		const afterFailure = buildCangjieAgentRoutingSection("新增函数并编译验证", completed, {
			repairRequired: true,
		})
		expect(afterFailure).toContain("Next stage: CangjieRepair")
		expect(afterFailure).toContain("CangjieRepair -> CangjieVerify")

		const afterRepair = buildCangjieAgentRoutingSection("新增函数并编译验证", [...completed, "CangjieRepair"], {
			repairRequired: true,
		})
		expect(afterRepair).toContain("Next stage: CangjieVerify")
	})

	it("requires fresh exploration before another repair when diagnostics stagnate", () => {
		const section = buildCangjieAgentRoutingSection(
			"新增函数并编译验证",
			["CangjieExplore", "CangjieImplement", "CangjieVerify", "CangjieRepair", "CangjieVerify"],
			{ repairRequired: true, freshEvidenceRequired: true },
		)
		expect(section).toContain("Next stage: CangjieExplore")
		expect(section).toContain("CangjieExplore -> CangjieRepair -> CangjieVerify")
	})
})
