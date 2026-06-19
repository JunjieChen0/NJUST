import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { resolveWithinWorkspace, resolveWithinWorkspaceAsync } from "../resolveWithinWorkspace"

describe("resolveWithinWorkspace", () => {
	let tmpRoot: string
	let workspace: string
	let outsideDir: string

	beforeAll(() => {
		tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "njust-resolve-workspace-"))
		workspace = path.join(tmpRoot, "workspace")
		outsideDir = path.join(tmpRoot, "outside")
		fs.mkdirSync(workspace, { recursive: true })
		fs.mkdirSync(outsideDir, { recursive: true })
		fs.mkdirSync(path.join(workspace, "sub"), { recursive: true })
	})

	afterAll(() => {
		try {
			fs.rmSync(tmpRoot, { recursive: true, force: true })
		} catch {
			/* best-effort cleanup */
		}
	})

	it("resolves an empty target to the workspace base", () => {
		const r = resolveWithinWorkspace(workspace, "")
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.resolved.toLowerCase()).toBe(fs.realpathSync(workspace).toLowerCase())
		}
	})

	it("accepts a relative path inside the workspace", () => {
		const r = resolveWithinWorkspace(workspace, "sub")
		expect(r.ok).toBe(true)
		if (r.ok) {
			expect(r.resolved.toLowerCase()).toBe(fs.realpathSync(path.join(workspace, "sub")).toLowerCase())
		}
	})

	it("rejects a relative path that climbs out via '..'", () => {
		const r = resolveWithinWorkspace(workspace, "../outside")
		expect(r.ok).toBe(false)
		if (!r.ok) {
			expect(r.reason).toMatch(/outside workspace/)
		}
	})

	it("rejects an absolute path outside the workspace", () => {
		const r = resolveWithinWorkspace(workspace, outsideDir)
		expect(r.ok).toBe(false)
	})

	it("accepts an absolute path inside the workspace", () => {
		const r = resolveWithinWorkspace(workspace, path.join(workspace, "sub"))
		expect(r.ok).toBe(true)
	})

	it("rejects null bytes in target", () => {
		const r = resolveWithinWorkspace(workspace, "good\0/../etc")
		expect(r.ok).toBe(false)
	})

	it("rejects symlink that escapes the workspace", () => {
		// Creating symlinks on Windows requires elevated privileges; skip if it fails.
		const linkPath = path.join(workspace, "escape-link")
		try {
			fs.symlinkSync(outsideDir, linkPath, "dir")
		} catch {
			return // privilege not granted, skip
		}

		const r = resolveWithinWorkspace(workspace, "escape-link")
		expect(r.ok).toBe(false)
	})

	it("handles a non-existent nested path inside the workspace", () => {
		const r = resolveWithinWorkspace(workspace, "sub/does-not-exist/yet")
		expect(r.ok).toBe(true)
	})

	it("rejects a non-existent path that resolves outside the workspace", () => {
		const r = resolveWithinWorkspace(workspace, "../also-missing")
		expect(r.ok).toBe(false)
	})

	it("async variant matches sync behaviour for valid input", async () => {
		const r = await resolveWithinWorkspaceAsync(workspace, "sub")
		expect(r.ok).toBe(true)
	})

	it("async variant rejects traversal", async () => {
		const r = await resolveWithinWorkspaceAsync(workspace, "../outside")
		expect(r.ok).toBe(false)
	})

	it("rejects when base is empty", () => {
		const r = resolveWithinWorkspace("", "anything")
		expect(r.ok).toBe(false)
	})

	it("treats a Windows drive-root workspace as a real root, not its CWD form", () => {
		// Repro for the stripTrailingSep regression: when the workspace is
		// `C:\` exactly, `isInside("C:\\", "C:\\Users\\test")` must be true.
		// On non-Windows platforms `path.isAbsolute("C:\\")` is false and
		// the helper would reject the base anyway, so we skip there.
		if (process.platform !== "win32") return
		const r = resolveWithinWorkspace("C:\\", "C:\\Users\\test")
		expect(r.ok).toBe(true)
	})
})
