import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { afterEach, describe, expect, it } from "vitest"

import { buildCloudWorkspaceOpToolMessage } from "../buildCloudWorkspaceOpToolMessage"

describe("buildCloudWorkspaceOpToolMessage", () => {
	let tmpDir: string

	afterEach(async () => {
		if (tmpDir) {
			await fs.rm(tmpDir, { recursive: true, force: true })
		}
	})

	it("builds newFileCreated JSON for write_file when file does not exist", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-tool-msg-"))
		const json = await buildCloudWorkspaceOpToolMessage(
			tmpDir,
			{ op: "write_file", path: "new.md", content: "hello" },
			{ isWriteProtected: false },
		)
		const tool = JSON.parse(json) as { tool: string; path: string; content: string }
		expect(tool.tool).toBe("newFileCreated")
		expect(tool.path).toContain("new.md")
		expect(tool.content.length).toBeGreaterThan(0)
	})

	it("builds editedExistingFile JSON for write_file when file exists", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-tool-msg-"))
		await fs.writeFile(path.join(tmpDir, "x.txt"), "old", "utf-8")
		const json = await buildCloudWorkspaceOpToolMessage(
			tmpDir,
			{ op: "write_file", path: "x.txt", content: "new" },
			{ isWriteProtected: false },
		)
		const tool = JSON.parse(json) as { tool: string; path: string; content: string }
		expect(tool.tool).toBe("editedExistingFile")
		expect(tool.content).toContain("old")
		expect(tool.content).toContain("new")
	})

	it("builds appliedDiff JSON for apply_diff", async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cloud-tool-msg-"))
		await fs.writeFile(path.join(tmpDir, "f.ts"), "const x = 1\n", "utf-8")
		const diff = `<<<<<<< SEARCH
const x = 1
=======
const x = 2
>>>>>>> REPLACE`
		const json = await buildCloudWorkspaceOpToolMessage(
			tmpDir,
			{ op: "apply_diff", path: "f.ts", diff },
			{ isWriteProtected: true },
		)
		const tool = JSON.parse(json) as { tool: string; diff: string; isProtected?: boolean }
		expect(tool.tool).toBe("appliedDiff")
		expect(tool.diff).toContain("SEARCH")
		expect(tool.isProtected).toBe(true)
	})
})
