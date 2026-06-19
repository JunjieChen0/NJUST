import { describe, expect, it } from "vitest"

import { parseWorkspaceOps, WORKSPACE_OPS_MAX_BODY_CHARS, WORKSPACE_OPS_MAX_COUNT } from "../parseWorkspaceOps"

describe("parseWorkspaceOps", () => {
	it("returns empty when workspace_ops is absent", () => {
		expect(parseWorkspaceOps({ ok: true })).toEqual({ operations: [] })
	})

	it("parses valid write_file and apply_diff", () => {
		const r = parseWorkspaceOps({
			workspace_ops: {
				version: 1,
				operations: [
					{ op: "write_file", path: "a.md", content: "hello" },
					{ op: "apply_diff", path: "b.ts", diff: "<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE" },
				],
			},
		})
		expect(r.error).toBeUndefined()
		expect(r.operations).toHaveLength(2)
		expect(r.operations[0]).toEqual({ op: "write_file", path: "a.md", content: "hello" })
	})

	it("rejects too many operations", () => {
		const ops = Array.from({ length: WORKSPACE_OPS_MAX_COUNT + 1 }, (_, i) => ({
			op: "write_file" as const,
			path: `f${i}.txt`,
			content: "x",
		}))
		const r = parseWorkspaceOps({ workspace_ops: { operations: ops } })
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("rejects content over max length", () => {
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "write_file", path: "x", content: "a".repeat(WORKSPACE_OPS_MAX_BODY_CHARS + 1) }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("rejects unknown op discriminator", () => {
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "delete_file", path: "x" }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("rejects absolute paths", () => {
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "write_file", path: "/etc/passwd", content: "evil" }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("rejects paths with null bytes", () => {
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "write_file", path: "safe.txt\0/../../etc/passwd", content: "evil" }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("rejects URL-encoded traversal", () => {
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "apply_diff", path: "%2e%2e/etc/shadow", diff: "x" }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("rejects double-encoded traversal", () => {
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "write_file", path: "%252e%252e/secret", content: "evil" }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("rejects mixed-case encoded traversal", () => {
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "write_file", path: "%2E%2e/etc/passwd", content: "evil" }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("rejects deeply double-encoded traversal", () => {
		// %25252e%25252e decodes via three passes: %2525 → %25 → %2e/2e then '..'
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "write_file", path: "%25252e%25252e/etc/passwd", content: "evil" }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("rejects 7-layer encoded traversal (decoder budget exhausted)", () => {
		// Wrap '..' in 7 layers of percent-encoding. Earlier versions exited
		// the decode loop at depth 6 without re-checking the residual string,
		// admitting the path. The fixed loop checks every decoded form AND
		// rejects when the budget is exhausted while the string is still
		// changing under decode.
		let path = "../etc/passwd"
		for (let i = 0; i < 7; i++) {
			path = path.replace(/%/g, "%25").replace(/\./g, "%2e")
		}
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "write_file", path, content: "evil" }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("rejects 8-layer encoded traversal", () => {
		let path = "../etc/passwd"
		for (let i = 0; i < 8; i++) {
			path = path.replace(/%/g, "%25").replace(/\./g, "%2e")
		}
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "write_file", path, content: "evil" }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})

	it("accepts a benign filename containing '%20' (encoded space)", () => {
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "write_file", path: "docs/my%20file.md", content: "x" }],
			},
		})
		expect(r.error).toBeUndefined()
		expect(r.operations).toHaveLength(1)
	})

	it("rejects a Windows absolute path on any platform", () => {
		const r = parseWorkspaceOps({
			workspace_ops: {
				operations: [{ op: "write_file", path: "C:/Windows/System32/config", content: "evil" }],
			},
		})
		expect(r.operations).toEqual([])
		expect(r.error).toBeDefined()
	})
})
