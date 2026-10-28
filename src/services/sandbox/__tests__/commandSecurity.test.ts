import { describe, it, expect, vi } from "vitest"

import { containsShellIoRedirection } from "../commandSecurity"

describe("containsShellIoRedirection", () => {
	it.each([
		"cmd > out.txt",
		"cmd < in.txt",
		"cmd >> log.txt",
		"cmd 2>&1",
		"cmd >out.txt 2>err.txt",
		"cat file | tee out > /dev/null",
		"echo a>b",
	])("detects shell IO redirection in %j", (command) => {
		expect(containsShellIoRedirection(command)).toBe(true)
	})

	it.each(['echo "a>b"', "echo 'a<b'", "git log --oneline", "node --version"])(
		"ignores angle brackets inside quoted arguments in %j",
		(command) => {
			expect(containsShellIoRedirection(command)).toBe(false)
		},
	)

	it.each(["cmd\n> out", "{ x }\ncmd > out", "echo hi\ncmd < in"])(
		"detects redirection smuggled after a line terminator in %j",
		(command) => {
			expect(containsShellIoRedirection(command)).toBe(true)
		},
	)

	it("detects redirection following a comment-like token", () => {
		expect(containsShellIoRedirection("{x}\ncmd > out")).toBe(true)
	})

	it("fails closed and reports redirection when the parser throws", async () => {
		vi.resetModules()
		vi.doMock("shell-quote", () => ({
			parse: () => {
				throw new Error("parse failure")
			},
		}))

		try {
			const isolated = await import("../commandSecurity")
			expect(isolated.containsShellIoRedirection("echo '<x>'")).toBe(true)
			expect(isolated.containsShellIoRedirection("echo hi")).toBe(false)
		} finally {
			vi.doUnmock("shell-quote")
			vi.resetModules()
		}
	})
})
