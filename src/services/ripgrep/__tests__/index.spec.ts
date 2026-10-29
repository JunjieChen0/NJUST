// npx vitest run src/services/ripgrep/__tests__/index.spec.ts

import { describe, it, expect, vi } from "vitest"

import { truncateLine } from "../index"

describe("Ripgrep line truncation", () => {
	// The default MAX_LINE_LENGTH is 500 in the implementation
	const MAX_LINE_LENGTH = 500

	it("should truncate lines longer than MAX_LINE_LENGTH", () => {
		const longLine = "a".repeat(600) // Line longer than MAX_LINE_LENGTH
		const truncated = truncateLine(longLine)

		expect(truncated).toContain("[truncated...]")
		expect(truncated.length).toBeLessThan(longLine.length)
		expect(truncated.length).toEqual(MAX_LINE_LENGTH + " [truncated...]".length)
	})

	it("should not truncate lines shorter than MAX_LINE_LENGTH", () => {
		const shortLine = "Short line of text"
		const truncated = truncateLine(shortLine)

		expect(truncated).toEqual(shortLine)
		expect(truncated).not.toContain("[truncated...]")
	})

	it("should correctly truncate a line at exactly MAX_LINE_LENGTH characters", () => {
		const exactLine = "a".repeat(MAX_LINE_LENGTH)
		const exactPlusOne = exactLine + "x"

		// Should not truncate when exactly MAX_LINE_LENGTH
		expect(truncateLine(exactLine)).toEqual(exactLine)

		// Should truncate when exceeding MAX_LINE_LENGTH by even 1 character
		expect(truncateLine(exactPlusOne)).toContain("[truncated...]")
	})

	it("should handle empty lines without errors", () => {
		expect(truncateLine("")).toEqual("")
	})

	it("should allow custom maximum length", () => {
		const customLength = 100
		const line = "a".repeat(customLength + 50)

		const truncated = truncateLine(line, customLength)

		expect(truncated.length).toEqual(customLength + " [truncated...]".length)
		expect(truncated).toContain("[truncated...]")
	})
})

describe("getBinPath resolution", () => {
	it("skips missing PATH candidates and returns the first path that exists", async () => {
		vi.resetModules()
		const broken = "C:\\broken\\rg.exe"
		const valid = "C:\\valid\\rg.exe"

		vi.doMock("child_process", () => ({
			execSync: () => `${broken}\r\n${valid}\r\n`,
			spawn: vi.fn(),
		}))
		vi.doMock("../../../utils/fs", () => ({
			fileExistsAtPath: async (candidate: string) => candidate === valid,
		}))

		try {
			const { getBinPath } = await import("../index")
			await expect(getBinPath("C:\\vscode")).resolves.toBe(valid)
		} finally {
			vi.doUnmock("child_process")
			vi.doUnmock("../../../utils/fs")
			vi.resetModules()
		}
	})

	it("returns undefined when no candidate exists", async () => {
		vi.resetModules()
		vi.doMock("child_process", () => ({
			execSync: () => "C:\\broken\\rg.exe\r\n",
			spawn: vi.fn(),
		}))
		vi.doMock("../../../utils/fs", () => ({
			fileExistsAtPath: async () => false,
		}))

		try {
			const { getBinPath } = await import("../index")
			await expect(getBinPath("C:\\vscode")).resolves.toBeUndefined()
		} finally {
			vi.doUnmock("child_process")
			vi.doUnmock("../../../utils/fs")
			vi.resetModules()
		}
	})

	it("finds ripgrep in the @vscode/ripgrep-universal layout (VS Code 1.144+)", async () => {
		vi.resetModules()
		const base = process.platform === "win32" ? "C:\\vscode" : "/opt/vscode"

		vi.doMock("child_process", () => ({
			execSync: () => {
				throw new Error("rg not in PATH")
			},
			spawn: vi.fn(),
		}))
		vi.doMock("../../../utils/fs", () => ({
			fileExistsAtPath: async (candidate: string) => candidate.includes("ripgrep-universal"),
		}))

		try {
			const { getBinPath } = await import("../index")
			const result = await getBinPath(base)

			expect(result).toContain("ripgrep-universal")
			expect(result).toContain(`${process.platform}-${process.arch}`)
		} finally {
			vi.doUnmock("child_process")
			vi.doUnmock("../../../utils/fs")
			vi.resetModules()
		}
	})
})
