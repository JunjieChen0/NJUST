import { describe, it, expect } from "vitest"

import { isReadOnlyCangjieAgent, validateCheckOnlyToolUse } from "../checkOnlyGuard"

describe("validateCheckOnlyToolUse", () => {
	it.each([
		"write_to_file",
		"apply_diff",
		"edit",
		"search_replace",
		"edit_file",
		"apply_patch",
		"use_mcp_tool",
		"custom_tool",
		"run_slash_command",
		"skill",
		"new_task",
		"task_create",
		"switch_mode",
	])("rejects %s", (toolName) => {
		expect(validateCheckOnlyToolUse(toolName, {})).toMatch(/check-only/i)
	})

	it.each(["read_file", "search_files", "list_files", "attempt_completion", "update_todo_list"])(
		"allows %s",
		(toolName) => {
			expect(validateCheckOnlyToolUse(toolName, {})).toBeNull()
		},
	)

	it("allows delegating only read-only Cangjie agents", () => {
		expect(validateCheckOnlyToolUse("agent", { agentType: "CangjieVerify" })).toBeNull()
		expect(validateCheckOnlyToolUse("agent", { agentType: "CangjieExplore" })).toBeNull()
		expect(validateCheckOnlyToolUse("agent", { agentType: "CangjieImplement" })).toMatch(/check-only/i)
		expect(validateCheckOnlyToolUse("agent", { agentType: "CangjieRepair" })).toMatch(/check-only/i)
		expect(validateCheckOnlyToolUse("agent", {})).toMatch(/check-only/i)
	})

	it.each([
		"cjpm build",
		"cjpm check",
		"cjpm test",
		"cjpm build 2>&1",
		"  cjpm test --filter Calc*  ",
		"cjpm --version",
		"cjpm.exe build",
		"D:\\Cangjie\\tools\\bin\\cjpm.exe build",
		'"C:\\Program Files\\Cangjie\\tools\\bin\\cjpm.exe" build',
		'"C:\\Program Files (x86)\\Cangjie\\tools\\bin\\cjpm.exe" test',
		"/opt/cangjie/tools/bin/cjpm test",
		"cjpm --help",
		"cjc -v",
		"cjc --help",
		"'C:\\Program Files\\Cangjie\\bin\\cjc.exe' --version",
		"cjlint -f src",
		"cjc --version",
	])("allows the read-only toolchain command %s", (command) => {
		expect(validateCheckOnlyToolUse("execute_command", { command })).toBeNull()
	})

	it.each([
		'cjc main.cj "-o" src/main.cj',
		"cjc main.cj '-o' x",
		'cjlint -f src "--output" r.cj',
		"cjc main.cj",
		"cjc main.cj -o=x",
		"cjlint -f src --output=x",
		"cjpm build --output=x",
		"cjlint -f src -o=x",
		"cjlint -f src --out`put r.cj",
		"cjlint -f src --out^put r.cj",
		'cjlint -f \\"src\\"',
		"cjlint -f --output=x",
		"where.exe cjpm",
		'"$(Get-Command cjpm)" build',
		"cjfmt -f src/main.cj",
		"sed -i s/a/b/ src/main.cj",
		"cjpm build > build.log",
		"cjpm build && rm -rf src",
		"cjpm build; echo x > src/main.cj",
		"cjpm build | tee out.txt",
		"cjpm init --name x",
		"cjpm clean",
		"echo $(cjpm build)",
		"cjc foo.cj -o src/main.cj",
		"cjlint -f src --output src/report.cj",
		"cjpm",
		"cjpm build (Remove-Item -Recurse src)",
		"cjc @(rm x.cj)",
		"cjpm test {Remove-Item src}",
	])("rejects the command %s", (command) => {
		expect(validateCheckOnlyToolUse("execute_command", { command })).toMatch(/check-only/i)
	})

	it("rejects an execute_command without a command string", () => {
		expect(validateCheckOnlyToolUse("execute_command", {})).toMatch(/check-only/i)
	})
})

describe("isReadOnlyCangjieAgent", () => {
	it("treats explore and verify agents as read-only", () => {
		expect(isReadOnlyCangjieAgent("CangjieVerify")).toBe(true)
		expect(isReadOnlyCangjieAgent("CangjieExplore")).toBe(true)
		expect(isReadOnlyCangjieAgent("CangjieImplement")).toBe(false)
		expect(isReadOnlyCangjieAgent(undefined)).toBe(false)
	})
})
