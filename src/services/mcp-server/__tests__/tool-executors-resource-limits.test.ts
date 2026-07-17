import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

import { execReadFile, execWriteFile, execApplyDiff } from "../tool-executors"
import { ResourceLimitsService } from "../ResourceLimitsService"

let tmpDir: string

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "mcp-resource-test-"))
})

afterEach(async () => {
	await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("execReadFile with resource limits", () => {
	it("truncates read when exceeding read byte budget", async () => {
		const filePath = path.join(tmpDir, "large.txt")
		const content = "x".repeat(10000)
		await fs.writeFile(filePath, content, "utf-8")

		const limits = new ResourceLimitsService({ maxReadBytes: 500, maxWriteBytes: 999999, maxOpenFileHandles: 5 })
		const result = await execReadFile(tmpDir, { path: "large.txt" }, limits)

		expect(result).toContain("[Resource limit: read truncated")
		expect(result.length).toBeLessThan(content.length)
		expect(limits.getUsage().readBytes).toBeGreaterThan(0)
	})

	it("rejects when file handle limit is zero", async () => {
		const filePath = path.join(tmpDir, "test.txt")
		await fs.writeFile(filePath, "hello", "utf-8")

		const limits = new ResourceLimitsService({ maxReadBytes: 999999, maxWriteBytes: 999999, maxOpenFileHandles: 0 })
		await expect(execReadFile(tmpDir, { path: "test.txt" }, limits)).rejects.toThrow("too many open file handles")
	})

	it("releases file handle after read completes", async () => {
		const filePath = path.join(tmpDir, "test.txt")
		await fs.writeFile(filePath, "hello", "utf-8")

		const limits = new ResourceLimitsService({ maxReadBytes: 999999, maxWriteBytes: 999999, maxOpenFileHandles: 1 })
		await execReadFile(tmpDir, { path: "test.txt" }, limits)
		expect(limits.getUsage().openFileHandles).toBe(0)
	})

	it("releases file handle even when read throws", async () => {
		const filePath = path.join(tmpDir, "binary.dat")
		const buf = Buffer.alloc(100, 0)
		await fs.writeFile(filePath, buf)

		const limits = new ResourceLimitsService({ maxReadBytes: 999999, maxWriteBytes: 999999, maxOpenFileHandles: 1 })
		try {
			await execReadFile(tmpDir, { path: "binary.dat" }, limits)
		} catch {
			// Expected - binary content
		}
		expect(limits.getUsage().openFileHandles).toBe(0)
	})

	it("works without resource limits (backward compatible)", async () => {
		const filePath = path.join(tmpDir, "test.txt")
		await fs.writeFile(filePath, "hello world", "utf-8")

		const result = await execReadFile(tmpDir, { path: "test.txt" })
		expect(result).toContain("hello world")
	})

	it("does not accumulate read budget across separate calls (per-request isolation)", async () => {
		const filePath = path.join(tmpDir, "test.txt")
		await fs.writeFile(filePath, "hello", "utf-8")

		const limits1 = new ResourceLimitsService({ maxReadBytes: 100 })
		const limits2 = new ResourceLimitsService({ maxReadBytes: 100 })
		await execReadFile(tmpDir, { path: "test.txt" }, limits1)
		await execReadFile(tmpDir, { path: "test.txt" }, limits2)
		expect(limits1.getUsage().readBytes).toBeGreaterThan(0)
		expect(limits2.getUsage().readBytes).toBeGreaterThan(0)
	})
})

describe("execWriteFile with resource limits", () => {
	it("rejects write exceeding write byte budget", async () => {
		const limits = new ResourceLimitsService({ maxReadBytes: 999999, maxWriteBytes: 10, maxOpenFileHandles: 5 })
		await expect(
			execWriteFile(tmpDir, { path: "big.txt", content: "x".repeat(1000) }, undefined, limits),
		).rejects.toThrow("write budget insufficient")
	})

	it("allows write within budget", async () => {
		const limits = new ResourceLimitsService({ maxReadBytes: 999999, maxWriteBytes: 100, maxOpenFileHandles: 5 })
		const result = await execWriteFile(tmpDir, { path: "ok.txt", content: "hello" }, undefined, limits)
		expect(result).toContain("Created new file")
		expect(limits.getUsage().writeBytes).toBe(5)
	})

	it("accumulates write budget across calls within same request", async () => {
		const limits = new ResourceLimitsService({ maxReadBytes: 999999, maxWriteBytes: 15, maxOpenFileHandles: 5 })
		await execWriteFile(tmpDir, { path: "f1.txt", content: "hello" }, undefined, limits)
		await execWriteFile(tmpDir, { path: "f2.txt", content: "world" }, undefined, limits)
		await expect(
			execWriteFile(tmpDir, { path: "f3.txt", content: "toolong" }, undefined, limits),
		).rejects.toThrow("write budget insufficient")
	})

	it("works without resource limits (backward compatible)", async () => {
		const result = await execWriteFile(tmpDir, { path: "ok.txt", content: "hello" })
		expect(result).toContain("Created new file")
	})
})

describe("execApplyDiff with resource limits", () => {
	it("rejects diff result exceeding write byte budget", async () => {
		const filePath = path.join(tmpDir, "test.txt")
		const original = "line1\nline2\nline3\n"
		await fs.writeFile(filePath, original, "utf-8")

		const limits = new ResourceLimitsService({ maxReadBytes: 999999, maxWriteBytes: 50, maxOpenFileHandles: 5 })
		await expect(
			execApplyDiff(
				tmpDir,
				{ path: "test.txt", diff: "<<<<<<< SEARCH\nline2\n=======\n" + "x".repeat(1000) + "\n>>>>>>> REPLACE" },
				undefined,
				limits,
			),
		).rejects.toThrow("write budget insufficient")
	})

	it("allows diff within budget", async () => {
		const filePath = path.join(tmpDir, "test.txt")
		const original = "line1\nline2\nline3\n"
		await fs.writeFile(filePath, original, "utf-8")

		const limits = new ResourceLimitsService({ maxReadBytes: 999999, maxWriteBytes: 999999, maxOpenFileHandles: 5 })
		const result = await execApplyDiff(
			tmpDir,
			{ path: "test.txt", diff: "<<<<<<< SEARCH\nline2\n=======\nreplaced\n>>>>>>> REPLACE" },
			undefined,
			limits,
		)
		expect(result).toContain("Successfully applied diff")
	})

	it("works without resource limits (backward compatible)", async () => {
		const filePath = path.join(tmpDir, "test.txt")
		await fs.writeFile(filePath, "line1\nline2\nline3\n", "utf-8")

		const result = await execApplyDiff(
			tmpDir,
			{ path: "test.txt", diff: "<<<<<<< SEARCH\nline2\n=======\nreplaced\n>>>>>>> REPLACE" },
		)
		expect(result).toContain("Successfully applied diff")
	})
})
