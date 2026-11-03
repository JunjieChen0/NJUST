import { describe, expect, it } from "vitest"

import { buildCangjieAgentRoutingSection, routeCangjieAgentTask } from "../CangjieAgentRouter"

describe("routeCangjieAgentTask", () => {
	it.each([
		"只检查当前项目，不要修改或修复",
		"Only verify this project; do not modify or repair any files.",
		"只运行 cjpm build，不要修复：error: type mismatch",
		"只运行 cjpm build：error: type mismatch",
		"Only run cjpm build: error: type mismatch",
	])("keeps explicit read-only constraints ahead of implementation and diagnostics: %s", (request) => {
		const route = routeCangjieAgentTask(request)

		expect(["explore", "verify"]).toContain(route.kind)
		expect(route.stages).not.toContain("CangjieImplement")
		expect(route.stages).not.toContain("CangjieRepair")
	})

	it("keeps implementation ahead of verification wording", () => {
		expect(routeCangjieAgentTask("新增 tripleValue 函数并编译验证")).toMatchObject({
			kind: "implement",
			stages: ["CangjieExplore", "CangjieImplement", "CangjieVerify"],
		})
	})

	it.each([
		"新增函数，不要修改无关文件",
		"Add a feature; do not modify public APIs.",
		"run cjpm build and repair failures",
		"only run cjpm build and repair failures",
	])("preserves implementation intent with scoped constraints or repair authorization: %s", (request) => {
		expect(routeCangjieAgentTask(request).kind).toBe("implement")
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

	it("does not add repair stages to a read-only request after verification fails", () => {
		const section = buildCangjieAgentRoutingSection("验证当前工程的构建和测试", ["CangjieVerify"], {
			repairRequired: true,
		})

		expect(section).toContain("Required stages: none")
		expect(section).not.toContain("CangjieRepair")
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
