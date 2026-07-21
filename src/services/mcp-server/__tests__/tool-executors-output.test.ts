import { describe, expect, it } from "vitest"

import { formatCommandExecutionResult, truncateUtf8 } from "../tool-executors"
import type { CommandExecutionHandle } from "../../sandbox"

function handle(overrides: Partial<CommandExecutionHandle>): CommandExecutionHandle {
	return {
		executionId: "exec-output",
		backend: "docker",
		exitCode: 1,
		output: "",
		cancelled: false,
		timedOut: false,
		...overrides,
	}
}

describe("MCP command output formatting", () => {
	it("does not duplicate stderr-only output as stdout", () => {
		const result = formatCommandExecutionResult(
			handle({
				output: "failure\n",
				stderr: "failure\n",
			}),
		)

		expect(result).not.toContain("STDOUT:")
		expect(result).toContain("STDERR:\nfailure")
		expect(result.match(/failure/g)).toHaveLength(1)
	})

	it("falls back to combined output only when separate streams are absent", () => {
		const result = formatCommandExecutionResult(handle({ output: "legacy output" }))

		expect(result).toContain("STDOUT:\nlegacy output")
		expect(result).not.toContain("STDERR:")
	})

	it.each([
		["你a", 3, "你"],
		["😀a", 4, "😀"],
		["a你b", 4, "a你"],
		["éx", 2, "é"],
	])("truncates %s at a valid UTF-8 boundary", (input, maxBytes, expected) => {
		const result = truncateUtf8(input, maxBytes)

		expect(result).toEqual({ text: expected, truncated: true })
		expect(result.text).not.toContain("�")
	})
})
