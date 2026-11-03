import { afterEach, describe, expect, it, vi } from "vitest"
import * as path from "path"

import { attributeChanges, diffSnapshots } from "../changeAttribution"

afterEach(() => vi.unstubAllGlobals())

describe("change attribution", () => {
	it("sorts added, modified and deleted inputs and ignores unchanged ones", () => {
		expect(
			diffSnapshots(
				{ fingerprint: "before", files: { "z.cj": "old", "a.cj": "old", "keep.cj": "same" } },
				{ fingerprint: "after", files: { "a.cj": "new", "b.cj": "new", "keep.cj": "same" } },
			),
		).toEqual([
			{ path: "a.cj", change: "modified" },
			{ path: "b.cj", change: "added" },
			{ path: "z.cj", change: "deleted" },
		])
	})

	it("separates paths touched by task tools from other changes", () => {
		const root = path.resolve("/workspace/app")
		expect(
			attributeChanges(
				[
					{ path: "src/a.cj", change: "modified" },
					{ path: "src/b.cj", change: "added" },
				],
				root,
				[path.join(root, "src", "a.cj")],
			),
		).toEqual([
			{ path: "src/a.cj", change: "modified", source: "task_tool" },
			{ path: "src/b.cj", change: "added", source: "other" },
		])
	})

	it("compares Windows paths without case sensitivity", () => {
		vi.stubGlobal("process", { ...process, platform: "win32" })
		const root = path.resolve("/workspace/app")
		expect(
			attributeChanges([{ path: "src/a.cj", change: "deleted" }], root, [path.join(root, "SRC", "A.CJ")])[0]
				?.source,
		).toBe("task_tool")
	})
})
