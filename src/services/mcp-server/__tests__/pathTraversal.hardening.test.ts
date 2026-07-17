/**
 * P10 Path Traversal Security Hardening — Attack Path Tests
 *
 * Tests the pre-flight validation in ensureWithinWorkspace against:
 * - Null byte injection
 * - Windows device paths (\\.\, \\?\)
 * - Windows UNC network paths (\\server\share)
 * - Unix device paths (/dev/)
 * - Path traversal combinations
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { execReadFile, execWriteFile } from "../tool-executors"

let tmpWorkspace: string

beforeAll(async () => {
	tmpWorkspace = await fs.mkdtemp(path.join(os.tmpdir(), "p10-path-test-"))
	// Create a file inside the workspace for read tests
	await fs.writeFile(path.join(tmpWorkspace, "safe.txt"), "safe content")
})

afterAll(async () => {
	await fs.rm(tmpWorkspace, { recursive: true, force: true })
})

// ─── Null byte injection ─────────────────────────────────────────────────────

describe("null byte path injection", () => {
	it("rejects path with null byte in filename", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "safe.txt\0.jpg" })).rejects.toThrow("null byte")
	})

	it("rejects path with null byte at start", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "\0safe.txt" })).rejects.toThrow("null byte")
	})

	it("rejects path with null byte in directory", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "dir\0evil/safe.txt" })).rejects.toThrow("null byte")
	})

	it("rejects write with null byte in path", async () => {
		await expect(
			execWriteFile(tmpWorkspace, { path: "evil\0.txt", content: "pwned" }),
		).rejects.toThrow("null byte")
	})
})

// ─── Windows device paths ────────────────────────────────────────────────────

describe("Windows device path rejection", () => {
	it("rejects \\\\.\\CON device path", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "\\\\.\\CON" })).rejects.toThrow(
			/device path|UNC/i,
		)
	})

	it("rejects \\\\.\\NUL device path", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "\\\\.\\NUL" })).rejects.toThrow(
			/device path|UNC/i,
		)
	})

	it("rejects \\\\?\\C:\\Windows device path", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "\\\\?\\C:\\Windows" })).rejects.toThrow(
			/device path|UNC/i,
		)
	})
})

// ─── UNC network paths ─────────────────────────────────────────────────────

describe("UNC network path rejection", () => {
	it("rejects \\\\server\\share UNC path", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "\\\\server\\share\\file.txt" })).rejects.toThrow(
			/UNC|device/i,
		)
	})

	it("rejects \\\\attacker\\exfil UNC path", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "\\\\attacker\\exfil\\data" })).rejects.toThrow(
			/UNC|device/i,
		)
	})
})

// ─── Unix device paths ───────────────────────────────────────────────────────

describe("Unix device path rejection", () => {
	it("rejects /dev/null", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "/dev/null" })).rejects.toThrow(
			/Device path|escapes workspace/i,
		)
	})

	it("rejects /dev/urandom", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "/dev/urandom" })).rejects.toThrow(
			/Device path|escapes workspace/i,
		)
	})

	it("rejects write to /dev/sda", async () => {
		await expect(execWriteFile(tmpWorkspace, { path: "/dev/sda", content: "pwned" })).rejects.toThrow(
			/Device path|escapes workspace/i,
		)
	})
})

// ─── Path traversal ──────────────────────────────────────────────────────────

describe("path traversal attack paths", () => {
	it("rejects ../ to escape workspace", async () => {
		await expect(execReadFile(tmpWorkspace, { path: "../../../etc/passwd" })).rejects.toThrow(
			/escapes workspace|not found/i,
		)
	})

	it("rejects encoded traversal (%2e%2e%2f)", async () => {
		// URL encoding — should fail since path.resolve doesn't decode
		await expect(
			execReadFile(tmpWorkspace, { path: "%2e%2e%2f%2e%2e%2fetc/passwd" }),
		).rejects.toThrow(/not found|escapes/i)
	})

	it("rejects double-encoded traversal", async () => {
		await expect(
			execReadFile(tmpWorkspace, { path: "%252e%252e%252f" }),
		).rejects.toThrow(/not found|escapes/i)
	})

	it("rejects path with excessive ../ segments", async () => {
		await expect(
			execReadFile(tmpWorkspace, { path: "../../../../../../../../etc/shadow" }),
		).rejects.toThrow(/escapes workspace|not found/i)
	})

	it("allows reading files within workspace", async () => {
		const result = await execReadFile(tmpWorkspace, { path: "safe.txt" })
		expect(result).toContain("safe content")
	})

	it("allows reading with relative path inside workspace", async () => {
		const subDir = path.join(tmpWorkspace, "subdir")
		await fs.mkdir(subDir, { recursive: true })
		await fs.writeFile(path.join(subDir, "nested.txt"), "nested content")
		const result = await execReadFile(tmpWorkspace, { path: "subdir/nested.txt" })
		expect(result).toContain("nested content")
	})
})
