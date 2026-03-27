import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { afterEach, describe, expect, it } from "vitest"

import { applyCloudWorkspaceOps, applySingleCloudWorkspaceOp } from "../applyCloudWorkspaceOps"

describe("applyCloudWorkspaceOps", () => {
	let tmpDir: string

	afterEach(async () => {
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true })
		}
	})

	it("writes a new file", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-ws-"))
		const r = await applyCloudWorkspaceOps(tmpDir, [
			{ op: "write_file", path: "hello.txt", content: "world" },
		])
		expect(r.ok).toBe(true)
		expect(r.results).toHaveLength(1)
		expect(r.results[0].ok).toBe(true)
		const text = await fs.readFile(path.join(tmpDir, "hello.txt"), "utf-8")
		expect(text).toBe("world")
	})

	it("applySingleCloudWorkspaceOp writes one file", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-ws-"))
		const one = await applySingleCloudWorkspaceOp(tmpDir, {
			op: "write_file",
			path: "single.txt",
			content: "x",
		})
		expect(one.ok).toBe(true)
		const text = await fs.readFile(path.join(tmpDir, "single.txt"), "utf-8")
		expect(text).toBe("x")
	})

	it("fail-fast on apply_diff when file missing", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-ws-"))
		const r = await applyCloudWorkspaceOps(tmpDir, [
			{ op: "write_file", path: "a.txt", content: "line1\n" },
			{ op: "apply_diff", path: "missing.txt", diff: "<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE" },
		])
		expect(r.ok).toBe(false)
		expect(r.failedAtIndex).toBe(1)
		expect(r.results).toHaveLength(2)
		expect(r.results[0].ok).toBe(true)
		expect(r.results[1].ok).toBe(false)
	})

	it("stops when isAborted becomes true before the next op", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-ws-"))
		let iteration = 0
		const r = await applyCloudWorkspaceOps(
			tmpDir,
			[
				{ op: "write_file", path: "e.txt", content: "e" },
				{ op: "write_file", path: "f.txt", content: "f" },
			],
			() => {
				iteration++
				return iteration >= 2
			},
		)
		expect(r.ok).toBe(false)
		expect(r.failedAtIndex).toBe(1)
		expect(r.results).toHaveLength(1)
	})
})
