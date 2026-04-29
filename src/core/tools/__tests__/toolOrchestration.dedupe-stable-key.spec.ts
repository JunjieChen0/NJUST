// npx vitest src/core/tools/__tests__/toolOrchestration.dedupe-stable-key.spec.ts

import { describe, it, expect } from "vitest"
import { dedupeReadonlyToolCalls, stableStringify } from "../toolOrchestration"
import type { ToolUse } from "../../../shared/tools"

function makeToolUse(id: string, name: string, nativeArgs: Record<string, unknown>): ToolUse {
	return { type: "tool_use", id, name, partial: false, nativeArgs } as unknown as ToolUse
}

describe("stableStringify", () => {
	it("should produce identical output for objects with different key orders", () => {
		const a = { z: 1, a: 2, m: 3 }
		const b = { a: 2, m: 3, z: 1 }
		expect(stableStringify(a)).toBe(stableStringify(b))
	})

	it("should handle nested objects with different key orders", () => {
		const a = { outer: { z: 1, a: 2 }, first: true }
		const b = { first: true, outer: { a: 2, z: 1 } }
		expect(stableStringify(a)).toBe(stableStringify(b))
	})

	it("should handle null and undefined", () => {
		expect(stableStringify(null)).toBe("")
		expect(stableStringify(undefined)).toBe("")
	})

	it("should handle primitives", () => {
		expect(stableStringify("hello")).toBe("hello")
		expect(stableStringify(42)).toBe("42")
	})

	it("should handle arrays", () => {
		expect(stableStringify([1, 2, 3])).toBe("[1,2,3]")
	})

	it("should omit undefined values from objects", () => {
		const a = { path: "foo", extra: undefined }
		const b = { path: "foo" }
		expect(stableStringify(a)).toBe(stableStringify(b))
	})
})

describe("dedupeReadonlyToolCalls – stable key", () => {
	it("should deduplicate read_file calls with identical args in different key order", () => {
		const calls = [
			makeToolUse("t1", "read_file", { path: "src/a.ts", mode: "slice", offset: 1, limit: 100 }),
			makeToolUse("t2", "read_file", { limit: 100, offset: 1, path: "src/a.ts", mode: "slice" }),
		]

		const result = dedupeReadonlyToolCalls(calls)

		expect(result.uniqueCalls).toHaveLength(1)
		expect(result.uniqueCalls[0].id).toBe("t1")
		expect(result.duplicateToOriginal.get("t2")).toBe("t1")
	})

	it("should deduplicate list_files calls with same path and recursive", () => {
		const calls = [
			makeToolUse("t1", "list_files", { path: "src", recursive: true }),
			makeToolUse("t2", "list_files", { recursive: true, path: "src" }),
		]

		const result = dedupeReadonlyToolCalls(calls)

		expect(result.uniqueCalls).toHaveLength(1)
		expect(result.duplicateToOriginal.get("t2")).toBe("t1")
	})

	it("should deduplicate search_files calls with same semantic fields", () => {
		const calls = [
			makeToolUse("t1", "search_files", { path: ".", regex: "foo", file_pattern: "*.ts" }),
			makeToolUse("t2", "search_files", { file_pattern: "*.ts", path: ".", regex: "foo" }),
		]

		const result = dedupeReadonlyToolCalls(calls)

		expect(result.uniqueCalls).toHaveLength(1)
		expect(result.duplicateToOriginal.get("t2")).toBe("t1")
	})

	it("should NOT deduplicate calls with different parameter values", () => {
		const calls = [
			makeToolUse("t1", "read_file", { path: "src/a.ts", offset: 1 }),
			makeToolUse("t2", "read_file", { path: "src/b.ts", offset: 1 }),
		]

		const result = dedupeReadonlyToolCalls(calls)

		expect(result.uniqueCalls).toHaveLength(2)
		expect(result.duplicateToOriginal.size).toBe(0)
	})

	it("should pass through non-readonly tools without dedup", () => {
		const calls = [
			makeToolUse("t1", "write_to_file", { path: "a.ts", content: "x" }),
			makeToolUse("t2", "write_to_file", { path: "a.ts", content: "x" }),
		]

		const result = dedupeReadonlyToolCalls(calls)

		expect(result.uniqueCalls).toHaveLength(2)
		expect(result.duplicateToOriginal.size).toBe(0)
	})

	it("should handle three identical read_file calls, keeping only the first", () => {
		const calls = [
			makeToolUse("t1", "read_file", { path: "x.ts" }),
			makeToolUse("t2", "read_file", { path: "x.ts" }),
			makeToolUse("t3", "read_file", { path: "x.ts" }),
		]

		const result = dedupeReadonlyToolCalls(calls)

		expect(result.uniqueCalls).toHaveLength(1)
		expect(result.duplicateToOriginal.get("t2")).toBe("t1")
		expect(result.duplicateToOriginal.get("t3")).toBe("t1")
	})
})
