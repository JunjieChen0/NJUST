import { describe, expect, it } from "vitest"

import {
	buildTokenRegex,
	buildWhitespaceTolerantRegex,
	countOccurrences,
	countRegexMatches,
	detectLineEnding,
	escapeRegExp,
	normalizeToLF,
	restoreLineEnding,
	safeLiteralReplace,
} from "../editMatching"

describe("editMatching", () => {
	it.each([
		["aaaa", "aa", 2],
		["abcabcabc", "abc", 3],
		["abc", "", 0],
		["abc", "x", 0],
	] as const)("counts occurrences of %s / %s", (text, needle, expected) => {
		expect(countOccurrences(text, needle)).toBe(expected)
	})

	it("replaces literal strings and preserves dollar signs", () => {
		expect(safeLiteralReplace("a b a", "a", "$1")).toBe("$1 b $1")
		expect(safeLiteralReplace("abc", "", "x")).toBe("abc")
		expect(safeLiteralReplace("abc", "z", "x")).toBe("abc")
	})

	it("detects normalizes and restores line endings", () => {
		expect(detectLineEnding("a\r\nb")).toBe("\r\n")
		expect(detectLineEnding("a\nb")).toBe("\n")
		expect(normalizeToLF("a\r\nb\r\n")).toBe("a\nb\n")
		expect(restoreLineEnding("a\nb\n", "\r\n")).toBe("a\r\nb\r\n")
		expect(restoreLineEnding("a\nb", "\n")).toBe("a\nb")
	})

	it("escapes regular expression metacharacters", () => {
		const escaped = escapeRegExp("a+b.(c)[d]$")
		expect(new RegExp(escaped).test("a+b.(c)[d]$")).toBe(true)
	})

	it("builds whitespace tolerant regex for spaces and newlines", () => {
		const regex = buildWhitespaceTolerantRegex("foo \n bar")

		expect(countRegexMatches("foo \n bar foo\t\nbar", regex)).toBe(2)
	})

	it("builds Cangjie-aware whitespace tolerant regex without splitting composite operators", () => {
		const regex = buildWhitespaceTolerantRegex("a |> b", { cangjie: true })

		expect("a |> b").toMatch(regex)
		expect("a | > b").not.toMatch(regex)
	})

	it("returns never-matching regex for empty patterns", () => {
		expect(countRegexMatches("abc", buildWhitespaceTolerantRegex(""))).toBe(0)
		expect(countRegexMatches("abc", buildTokenRegex(""))).toBe(0)
	})

	it("rejects oversized whitespace-tolerant patterns", () => {
		expect(() => buildWhitespaceTolerantRegex("x".repeat(201))).toThrow("Pattern too long")
	})

	it("builds token regex across flexible whitespace", () => {
		const regex = buildTokenRegex("alpha beta gamma")

		expect(countRegexMatches("alpha beta gamma\nalpha\tbeta   gamma", regex)).toBe(2)
	})

	it("counts matches without mutating the original regex state", () => {
		const regex = /a/g
		regex.lastIndex = 2

		expect(countRegexMatches("aaa", regex)).toBe(3)
		expect(regex.lastIndex).toBe(2)
	})
})
