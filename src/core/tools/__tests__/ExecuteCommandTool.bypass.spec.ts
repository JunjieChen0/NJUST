import { describe, it, expect } from "vitest"

import { BYPASS_PROTECTED_PATTERNS } from "../ExecuteCommandTool"

/**
 * Direct tests for the catastrophic-command patterns that still require
 * confirmation even in bypass mode.
 *
 * These patterns err toward matching: a false positive costs one extra click,
 * a false negative means silent data loss / force-push. So each case below
 * asserts both the "must block" and "must not block" directions.
 */
describe("BYPASS_PROTECTED_PATTERNS", () => {
	const matches = (cmd: string) => BYPASS_PROTECTED_PATTERNS.some((p) => p.test(cmd))

	describe("recursive/forced rm", () => {
		const blocked = [
			"rm -rf /tmp",
			"rm -fr /tmp",
			"rm -r /tmp",
			"rm -R /tmp",
			"rm -rvf /tmp",
			"rm --recursive /tmp",
			"rm --force /tmp",
			"rm -rf",
		]
		for (const cmd of blocked) {
			it(`blocks "${cmd}"`, () => {
				expect(matches(cmd)).toBe(true)
			})
		}

		it("does not block plain rm of a single file", () => {
			expect(matches("rm foo.txt")).toBe(false)
		})
	})

	describe("git push --force", () => {
		const blocked = ["git push --force", "git push origin --force", "git push origin main --force"]
		for (const cmd of blocked) {
			it(`blocks "${cmd}"`, () => {
				expect(matches(cmd)).toBe(true)
			})
		}

		// Safe variants that refuse to push when the remote has moved.
		const safe = [
			"git push --force-with-lease",
			"git push origin --force-with-lease",
			"git push --force-if-includes",
		]
		for (const cmd of safe) {
			it(`does not block safe variant "${cmd}"`, () => {
				expect(matches(cmd)).toBe(false)
			})
		}

		it("does not block a normal push", () => {
			expect(matches("git push origin main")).toBe(false)
		})
	})

	describe("git push -f (short form)", () => {
		// The short form must match even with a refspec in the middle.
		const blocked = ["git push -f", "git push origin -f", "git push origin -f main"]
		for (const cmd of blocked) {
			it(`blocks "${cmd}"`, () => {
				expect(matches(cmd)).toBe(true)
			})
		}
	})

	describe("git reset --hard / git clean", () => {
		it("blocks git reset --hard", () => {
			expect(matches("git reset --hard HEAD~1")).toBe(true)
		})

		it("blocks git clean -fd", () => {
			expect(matches("git clean -fd")).toBe(true)
		})

		it("blocks git clean -fdx", () => {
			expect(matches("git clean -fdx")).toBe(true)
		})
	})

	describe("truncate", () => {
		it("blocks truncate -s 0", () => {
			expect(matches("truncate -s 0 important.log")).toBe(true)
		})

		it("does not block truncate to a non-zero size", () => {
			expect(matches("truncate -s 100 file")).toBe(false)
		})
	})

	describe("fork bomb", () => {
		// Multiple whitespace/spacing variants of the classic :(){ :|:& } bomb.
		const blocked = [":(){ :|:& }", ":(){:|:&}", ": () { : | : & }", "  :(){ :|:& }"]
		for (const cmd of blocked) {
			it(`blocks "${cmd}"`, () => {
				expect(matches(cmd)).toBe(true)
			})
		}
	})

	describe("benign commands are not blocked", () => {
		const safe = ["ls -la", "npm run build", "git status", "git push origin main", "echo hello", "cd /tmp && ls"]
		for (const cmd of safe) {
			it(`does not block "${cmd}"`, () => {
				expect(matches(cmd)).toBe(false)
			})
		}
	})
})
