import { describe, it, expect } from "vitest"
import { parseUnifiedDiff } from "../parseUnifiedDiff"

describe("parseUnifiedDiff", () => {
	it("returns empty array for empty source", () => {
		expect(parseUnifiedDiff("")).toEqual([])
	})

	it("returns empty array for invalid diff", () => {
		expect(parseUnifiedDiff("invalid diff content")).toEqual([])
	})

	it("parses single hunk unified diff correctly", () => {
		const diff = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-old line 1
+new line 1
 context line 1
-old line 2
+new line 2`

		const result = parseUnifiedDiff(diff)
		expect(result).toHaveLength(5)

		expect(result[0]).toEqual({
			oldLineNum: 1,
			newLineNum: null,
			type: "deletion",
			content: "old line 1",
		})
		expect(result[1]).toEqual({
			oldLineNum: null,
			newLineNum: 1,
			type: "addition",
			content: "new line 1",
		})
		expect(result[2]).toEqual({
			oldLineNum: 2,
			newLineNum: 2,
			type: "context",
			content: "context line 1",
		})
		expect(result[3]).toEqual({
			oldLineNum: 3,
			newLineNum: null,
			type: "deletion",
			content: "old line 2",
		})
		expect(result[4]).toEqual({
			oldLineNum: null,
			newLineNum: 3,
			type: "addition",
			content: "new line 2",
		})
	})

	it("matches patch by filePath if provided", () => {
		const diff = `diff --git a/foo.ts b/foo.ts
--- a/foo.ts
+++ b/foo.ts
@@ -1,1 +1,1 @@
-foo old
+foo new
diff --git a/bar.ts b/bar.ts
--- a/bar.ts
+++ b/bar.ts
@@ -1,1 +1,1 @@
-bar old
+bar new`

		// Match foo.ts
		const resultFoo = parseUnifiedDiff(diff, "foo.ts")
		expect(resultFoo[0]).toBeDefined()
		expect(resultFoo[0]!.content).toBe("foo old")

		// Match bar.ts
		const resultBar = parseUnifiedDiff(diff, "bar.ts")
		expect(resultBar[0]).toBeDefined()
		expect(resultBar[0]!.content).toBe("bar old")

		// Fallback to first if not matched
		const resultFallback = parseUnifiedDiff(diff, "baz.ts")
		expect(resultFallback[0]).toBeDefined()
		expect(resultFallback[0]!.content).toBe("foo old")
	})

	it("inserts gap line between hunks", () => {
		const diff = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-old 1
+new 1
 context 2
@@ -10,2 +10,2 @@
-old 10
+new 10
 context 11`

		const result = parseUnifiedDiff(diff)

		// Hunk 1: oldStart = 1, oldLines = 2, newStart = 1, newLines = 2 (lines: deletion, addition, context)
		// Hunk 2: oldStart = 10, oldLines = 2, newStart = 10, newLines = 2 (lines: deletion, addition, context)
		// Gap size: 10 - (1 + 2) = 7
		expect(result).toHaveLength(7) // (3 lines hunk 1) + (1 gap line) + (3 lines hunk 2)
		expect(result[3]).toEqual({
			oldLineNum: null,
			newLineNum: null,
			type: "gap",
			content: "",
			hiddenCount: 7,
		})
	})

	it("swallows exceptions and returns empty array on parse failure", () => {
		// Mock throwing inside loop by passing a bad diff that parsePatch might parse but causes crash inside
		const result = parseUnifiedDiff(null as any)
		expect(result).toEqual([])
	})
})
