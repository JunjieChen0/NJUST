import { describe, it, expect, afterEach } from "vitest"

import { formatHostExecuteCommandHints, normalizeDotSlashCommandForWindowsShell } from "../hostShellCommand"

describe("hostShellCommand", () => {
	describe("formatHostExecuteCommandHints", () => {
		it("includes OS facts and platform-specific guidance", () => {
			const text = formatHostExecuteCommandHints()
			expect(text).toContain("Tailor **compile and run** commands")
			expect(text).toContain("Detected OS")
			expect(text).toMatch(/Node platform `(win32|darwin|linux|.+)`/)
		})
	})

	describe("normalizeDotSlashCommandForWindowsShell", () => {
		const originalPlatform = process.platform

		afterEach(() => {
			Object.defineProperty(process, "platform", { value: originalPlatform })
		})

		it("rewrites ./ on win32 for cmd-style shells", () => {
			Object.defineProperty(process, "platform", { value: "win32" })
			expect(normalizeDotSlashCommandForWindowsShell("./a", undefined)).toBe(".\\a")
		})
	})
})
