import { describe, expect, it } from "vitest"

import { BUILT_IN_AGENTS, getBuiltInAgent } from "../builtInAgents"

describe("BUILT_IN_AGENTS", () => {
	it("defines unique built-in agent types", () => {
		const agentTypes = BUILT_IN_AGENTS.map((agent) => agent.agentType)

		expect(new Set(agentTypes).size).toBe(agentTypes.length)
		expect(agentTypes).toEqual(
			expect.arrayContaining([
				"Explore",
				"Implement",
				"Verify",
				"CangjieExplore",
				"CangjieVerify",
				"CangjieImplement",
				"CangjieRepair",
				"Custom",
			]),
		)
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

	it("defines CangjieVerify as a read-only Cangjie toolchain verifier", () => {
		const agent = getBuiltInAgent("CangjieVerify")

		expect(agent?.tools).toEqual(
			expect.arrayContaining([
				"read_file",
				"execute_command",
				"read_command_output",
				"search_files",
				"list_files",
			]),
		)
		expect(agent?.tools).not.toContain("write_to_file")
		expect(agent?.tools).not.toContain("apply_diff")
		expect(agent?.permissionMode).toBe("bypassPermissions")
		expect(typeof agent?.systemPrompt).toBe("string")
		expect(agent?.systemPrompt).toContain("cjpm build")
		expect(agent?.systemPrompt).toContain("cjpm check")
		expect(agent?.systemPrompt).toContain("cjlint")
		expect(agent?.systemPrompt).toContain("Invoke Cangjie toolchain commands directly")
		expect(agent?.systemPrompt).toContain('Do not wrap them with "cd /d ... &&"')
		expect(agent?.systemPrompt).toContain("MUST NOT modify files")
		expect(agent?.systemPrompt).toContain("Do not switch to Code mode")
		expect(agent?.systemPrompt).toContain("Do not replace toolchain verification with speculative static analysis")
		expect(agent?.systemPrompt).toContain("verification as inconclusive")
		expect(agent?.systemPrompt).toContain("Explicit command allowlists override the normal project-confirmation")
		expect(agent?.systemPrompt).toContain("do not read cjpm.toml")
		expect(agent?.systemPrompt).toContain("do not list directories")
		expect(agent?.systemPrompt).toContain("do not even announce or plan extra probes")
		expect(agent?.systemPrompt).toContain("checking whether cjpm.toml exists")
		expect(agent?.systemPrompt).toContain("explicit command allowlist")
		expect(agent?.systemPrompt).toContain("Do not add fallback commands")
		expect(agent?.systemPrompt).toContain("Keep an execution ledger")
		expect(agent?.systemPrompt).toContain(
			"Only report a command as attempted if you actually invoked that exact command",
		)
		expect(agent?.systemPrompt).toContain('report it as "not attempted: execute_command unavailable"')
		expect(agent?.systemPrompt).toContain("run each allowed command at most once")
		expect(agent?.systemPrompt).toContain(
			"A timeout, shell integration warning, or unavailable execute_command result counts",
		)
		expect(agent?.systemPrompt).toContain('if the allowlist says "where.exe cjpm"')
		expect(agent?.systemPrompt).toContain(
			'do not run "where cjpm", "Get-Command cjpm", or "powershell -Command ..."',
		)
		expect(agent?.systemPrompt).toContain('If the allowlist says "cjpm build 2>&1"')
		expect(agent?.systemPrompt).toContain(
			'do not run "cjpm build", "cd /d ... && cjpm build", or any PowerShell wrapper',
		)
		expect(agent?.systemPrompt).toContain("terminal shell integration warning")
		expect(agent?.systemPrompt).toContain('do not retry with a rewritten command such as "cd /d ... && cjpm build"')
		expect(agent?.systemPrompt).toContain("CangjieRepair")
	})

	it("defines CangjieExplore as a read-only Cangjie evidence collector", () => {
		const agent = getBuiltInAgent("CangjieExplore")

		expect(agent?.tools).toEqual(
			expect.arrayContaining([
				"read_file",
				"search_files",
				"list_files",
				"list_code_definition_names",
				"codebase_search",
			]),
		)
		expect(agent?.tools).not.toContain("execute_command")
		expect(agent?.tools).not.toContain("write_to_file")
		expect(agent?.tools).not.toContain("apply_diff")
		expect(agent?.permissionMode).toBe("bypassPermissions")
		expect(agent?.permissionWarning).toMatch(/read-only/i)
		expect(typeof agent?.systemPrompt).toBe("string")
		expect(agent?.systemPrompt).toContain("Read cjpm.toml")
		expect(agent?.systemPrompt).toContain("bundled Cangjie corpus")
		expect(agent?.systemPrompt).toContain("recommended next agent")
		expect(agent?.systemPrompt).toContain("CangjieVerify")
		expect(agent?.systemPrompt).toContain("CangjieRepair")
		expect(agent?.systemPrompt).toContain("CangjieImplement")
		expect(agent?.systemPrompt).toContain("asks only for evidence")
		expect(agent?.systemPrompt).toContain("finish after the evidence report")
		expect(agent?.systemPrompt).toContain("Do not ask follow-up questions about implementation details")
		expect(agent?.systemPrompt).toContain("Evidence collected; no files were modified")
		expect(agent?.systemPrompt).toContain(
			"Do not print the full final evidence report as an ordinary assistant message",
		)
		expect(agent?.systemPrompt).toContain("attempt_completion.result")
		expect(agent?.systemPrompt).toContain("attempt_completion itself times out")
		expect(agent?.systemPrompt).toContain("do not resubmit the same long report")
		expect(agent?.systemPrompt).toContain("如需开始编写代码")
		expect(agent?.systemPrompt).toContain("preserve exact signatures including parameters")
		expect(agent?.systemPrompt).toContain("do not write getOrThrow(default)")
		expect(agent?.systemPrompt).toContain("find(input: String, group!: Bool = false): Option<MatchData>")
		expect(agent?.systemPrompt).toContain('Do not conclude "add 必须 var"')
		expect(agent?.systemPrompt).toContain('"let 可以调用 add"')
		expect(agent?.systemPrompt).toContain('"let 更推荐"')
		expect(agent?.systemPrompt).toContain("Do not run cjpm build")
		expect(agent?.systemPrompt).toContain("MUST NOT modify files")
	})

	it("defines CangjieRepair as a small-step Cangjie repair agent", () => {
		const agent = getBuiltInAgent("CangjieRepair")

		expect(agent?.tools).toEqual(expect.arrayContaining(["read_file", "apply_patch", "search_files", "list_files"]))
		expect(agent?.permissionMode).toBe("default")
		expect(agent?.permissionWarning).toBeUndefined()
		expect(typeof agent?.systemPrompt).toBe("string")
		expect(agent?.systemPrompt).toContain("real cjpm build")
		expect(agent?.systemPrompt).toContain("Fix only the top 1-2 root causes")
		expect(agent?.systemPrompt).toContain("Keep edits minimal")
		expect(agent?.systemPrompt).toContain("gather corpus/LSP evidence")
		expect(agent?.systemPrompt).toContain("CangjieVerify")
		expect(agent?.systemPrompt).toContain("If no real toolchain output is available")
		expect(agent?.systemPrompt).toContain("make no edits")
	})

	it("defines CangjieImplement as an evidence-based Cangjie implementation agent", () => {
		const agent = getBuiltInAgent("CangjieImplement")

		expect(agent?.tools).toEqual(
			expect.arrayContaining(["read_file", "apply_patch", "execute_command", "search_files", "list_files"]),
		)
		expect(agent?.permissionMode).toBe("default")
		expect(agent?.permissionWarning).toBeUndefined()
		expect(typeof agent?.systemPrompt).toBe("string")
		expect(agent?.systemPrompt).toContain("CangjieExplore findings")
		expect(agent?.systemPrompt).toContain("cjpm src-dir")
		expect(agent?.systemPrompt).toContain("bundled Cangjie corpus/LSP evidence")
		expect(agent?.systemPrompt).toContain("CangjieCorpus-1.0.0/extra/HashMap.md")
		expect(agent?.systemPrompt).toContain("CangjieCorpus-1.0.0/extra/ArrayList.md")
		expect(agent?.systemPrompt).toContain("CangjieCorpus-1.0.0/extra/File.md")
		expect(agent?.systemPrompt).toContain("CangjieCorpus-1.0.0/extra/Regex.md")
		expect(agent?.systemPrompt).toContain("CangjieCorpus-1.0.0/extra/Time.md")
		expect(agent?.systemPrompt).toContain("CangjieCorpus-1.0.0/extra/Process.md")
		expect(agent?.systemPrompt).toContain("Preserve exact stdlib signatures including parameters")
		expect(agent?.systemPrompt).toContain("do not write getOrThrow(default)")
		expect(agent?.systemPrompt).toContain("find(input: String, group!: Bool = false): Option<MatchData>")
		expect(agent?.systemPrompt).toContain("attempt_completion itself times out")
		expect(agent?.systemPrompt).toContain("do not resubmit the same long report")
		expect(agent?.systemPrompt).toContain("post-edit verification")
		expect(agent?.systemPrompt).toContain("Do not list cjpm build/check as an implementation-preparation step")
		expect(agent?.systemPrompt).toContain("preserve main() and existing callers")
		expect(agent?.systemPrompt).toContain("Do not add sample values")
		expect(agent?.systemPrompt).toContain("Prefer one atomic apply_patch per target file")
		expect(agent?.systemPrompt).toContain("focused, minimal edits")
		expect(agent?.systemPrompt).toContain("CangjieVerify")
		expect(agent?.systemPrompt).toContain("Do not guess Cangjie syntax")
		expect(agent?.systemPrompt).toContain("explicitly forbids corpus/LSP/evidence lookup")
		expect(agent?.systemPrompt).toContain("blocked/inconclusive under the user's constraints")
		expect(agent?.systemPrompt).toContain("Use apply_patch for edits")
		expect(agent?.systemPrompt).toContain("assume the write may already have committed")
		expect(agent?.systemPrompt).toContain("Never retry the same patch blindly")
		expect(agent?.systemPrompt).toContain("cjpm init --name <name> --type=<type>")
		expect(agent?.systemPrompt).toContain("execute_command is available only for a direct cjpm init command")
		expect(agent?.systemPrompt).toContain("Do not run cjpm build/check in this implementation stage")
		expect(agent?.systemPrompt).toContain("parent owns the CangjieVerify handoff")
	})

	it("keeps CangjieRepair edits atomic and idempotent after uncertain patch results", () => {
		const agent = getBuiltInAgent("CangjieRepair")

		expect(agent?.systemPrompt).toContain("Prefer one atomic apply_patch")
		expect(agent?.systemPrompt).toContain("assume it may have committed")
		expect(agent?.systemPrompt).toContain("never retry the same patch blindly")
	})
})
