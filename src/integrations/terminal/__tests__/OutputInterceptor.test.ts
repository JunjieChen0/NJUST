import * as fs from "fs"
import * as path from "path"
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"

import { OutputInterceptor } from "../OutputInterceptor"

// Mock filesystem operations
vi.mock("fs", () => ({
	default: {
		existsSync: vi.fn(),
		mkdirSync: vi.fn(),
		createWriteStream: vi.fn(),
		promises: {
			readdir: vi.fn(),
			unlink: vi.fn(),
		},
	},
	existsSync: vi.fn(),
	mkdirSync: vi.fn(),
	createWriteStream: vi.fn(),
	promises: {
		readdir: vi.fn(),
		unlink: vi.fn(),
	},
}))

describe("OutputInterceptor", () => {
	let mockWriteStream: any
	let storageDir: string

	beforeEach(() => {
		vi.clearAllMocks()

		storageDir = path.normalize("/tmp/test-storage")

		// Setup mock write stream with callback support for end()
		mockWriteStream = {
			write: vi.fn(),
			end: vi.fn(function (callback?: () => void) {
				// Immediately call the callback to simulate stream flush completing
				if (callback) callback()
			}),
			on: vi.fn(),
		}

		vi.mocked(fs.existsSync).mockReturnValue(true)
		vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream as any)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("Buffering behavior", () => {
		it("should keep small output in memory without spilling to disk", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "echo test",
				storageDir,
				previewSize: "small", // 5KB
			})

			const smallOutput = "Hello World\n"
			interceptor.write(smallOutput)

			expect(interceptor.hasSpilledToDisk()).toBe(false)
			expect(fs.createWriteStream).not.toHaveBeenCalled()

			const result = await interceptor.finalize()
			expect(result.preview).toBe(smallOutput)
			expect(result.truncated).toBe(false)
			expect(result.artifactPath).toBe(null)
			expect(result.totalBytes).toBe(Buffer.byteLength(smallOutput, "utf8"))
		})

		it("should spill to disk when output exceeds threshold", () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "echo test",
				storageDir,
				previewSize: "small", // 5KB = 5120 bytes
			})

			// Write enough data to exceed 5KB threshold
			const chunk = "x".repeat(2 * 1024) // 2KB chunk
			interceptor.write(chunk) // 2KB - should stay in memory
			expect(interceptor.hasSpilledToDisk()).toBe(false)

			interceptor.write(chunk) // 4KB - should stay in memory
			expect(interceptor.hasSpilledToDisk()).toBe(false)

			interceptor.write(chunk) // 6KB - should trigger spill
			expect(interceptor.hasSpilledToDisk()).toBe(true)
			expect(fs.createWriteStream).toHaveBeenCalledWith(path.join(storageDir, "cmd-12345.txt"))
			expect(mockWriteStream.write).toHaveBeenCalled()
		})

		it("should truncate preview after spilling to disk using head/tail split", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "echo test",
				storageDir,
				previewSize: "small", // 5KB
			})

			// Write data that exceeds threshold
			const chunk = "x".repeat(6000)
			interceptor.write(chunk)

			expect(interceptor.hasSpilledToDisk()).toBe(true)

			const result = await interceptor.finalize()
			expect(result.truncated).toBe(true)
			expect(result.artifactPath).toBe(path.join(storageDir, "cmd-12345.txt"))
			// Preview is head (1024) + omission indicator + tail (1024)
			// The omission indicator adds some extra bytes
			expect(result.preview).toContain("[...")
			expect(result.preview).toContain("bytes omitted...]")
		})

		it("should write subsequent chunks directly to disk after spilling", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "echo test",
				storageDir,
				previewSize: "small",
			})

			// Trigger spill (must exceed 5KB = 5120 bytes)
			const largeChunk = "x".repeat(6000)
			interceptor.write(largeChunk)
			expect(interceptor.hasSpilledToDisk()).toBe(true)

			// Clear mock to track next write
			mockWriteStream.write.mockClear()

			// Write another chunk - should go directly to disk. The redaction
			// carry may hold the trailing 256 chars back until the next write
			// or finalize(), so verify the union of writes contains nextChunk.
			const nextChunk = "y".repeat(1000)
			interceptor.write(nextChunk)
			await interceptor.finalize()

			const written = mockWriteStream.write.mock.calls.map((c: unknown[]) => String(c[0])).join("")
			expect(written).toContain(nextChunk)
		})
	})

	describe("Threshold settings", () => {
		it("should handle small (5KB) threshold correctly", () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small",
			})

			// Write exactly 5KB
			interceptor.write("x".repeat(5 * 1024))
			expect(interceptor.hasSpilledToDisk()).toBe(false)

			// Write more to exceed 5KB
			interceptor.write("x")
			expect(interceptor.hasSpilledToDisk()).toBe(true)
		})

		it("should handle medium (10KB) threshold correctly", () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "medium",
			})

			// Write exactly 10KB
			interceptor.write("x".repeat(10 * 1024))
			expect(interceptor.hasSpilledToDisk()).toBe(false)

			// Write more to exceed 10KB
			interceptor.write("x")
			expect(interceptor.hasSpilledToDisk()).toBe(true)
		})

		it("should handle large (20KB) threshold correctly", () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "large",
			})

			// Write exactly 20KB
			interceptor.write("x".repeat(20 * 1024))
			expect(interceptor.hasSpilledToDisk()).toBe(false)

			// Write more to exceed 20KB
			interceptor.write("x")
			expect(interceptor.hasSpilledToDisk()).toBe(true)
		})
	})

	describe("Artifact creation", () => {
		it("should create directory if it doesn't exist", () => {
			vi.mocked(fs.existsSync).mockReturnValue(false)

			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small",
			})

			// Trigger spill (must exceed 5KB = 5120 bytes)
			interceptor.write("x".repeat(6000))

			expect(fs.mkdirSync).toHaveBeenCalledWith(storageDir, { recursive: true })
		})

		it("should create artifact file with correct naming pattern", () => {
			const executionId = "1706119234567"
			const interceptor = new OutputInterceptor({
				executionId,
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small",
			})

			// Trigger spill (must exceed 5KB = 5120 bytes)
			interceptor.write("x".repeat(6000))

			expect(fs.createWriteStream).toHaveBeenCalledWith(path.join(storageDir, `cmd-${executionId}.txt`))
		})

		it("should write head and tail buffers to artifact when spilling", () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small", // 5KB = 5120 bytes, so head=2560, tail=2560
			})

			const fullOutput = "x".repeat(10000)
			interceptor.write(fullOutput)

			// The write stream should receive the head buffer content first
			// (spillToDisk writes head + tail that existed at spill time)
			expect(mockWriteStream.write).toHaveBeenCalled()
			// Verify that we're writing to disk
			expect(interceptor.hasSpilledToDisk()).toBe(true)
		})

		it("should get artifact path from getArtifactPath() method", () => {
			const executionId = "12345"
			const interceptor = new OutputInterceptor({
				executionId,
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small",
			})

			const expectedPath = path.join(storageDir, `cmd-${executionId}.txt`)
			expect(interceptor.getArtifactPath()).toBe(expectedPath)
		})
	})

	describe("finalize() method", () => {
		it("should return preview output for small commands", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "echo hello",
				storageDir,
				previewSize: "small",
			})

			const output = "Hello World\n"
			interceptor.write(output)

			const result = await interceptor.finalize()

			expect(result.preview).toBe(output)
			expect(result.totalBytes).toBe(Buffer.byteLength(output, "utf8"))
			expect(result.artifactPath).toBe(null)
			expect(result.truncated).toBe(false)
		})

		it("should return PersistedCommandOutput for large commands with head/tail preview", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small", // 5KB = 5120, head=2560, tail=2560
			})

			const largeOutput = "x".repeat(10000)
			interceptor.write(largeOutput)

			const result = await interceptor.finalize()

			expect(result.truncated).toBe(true)
			expect(result.artifactPath).toBe(path.join(storageDir, "cmd-12345.txt"))
			expect(result.totalBytes).toBe(Buffer.byteLength(largeOutput, "utf8"))
			// Preview should contain head + omission indicator + tail
			expect(result.preview).toContain("[...")
			expect(result.preview).toContain("bytes omitted...]")
		})

		it("should close write stream when finalizing", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small",
			})

			// Trigger spill (must exceed 5KB = 5120 bytes)
			interceptor.write("x".repeat(6000))
			await interceptor.finalize()

			expect(mockWriteStream.end).toHaveBeenCalled()
		})

		it("should include correct metadata (artifactId, size, truncated flag)", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small",
			})

			// Must exceed 5KB = 5120 bytes to trigger truncation
			const output = "x".repeat(6000)
			interceptor.write(output)

			const result = await interceptor.finalize()

			expect(result).toHaveProperty("preview")
			expect(result).toHaveProperty("totalBytes", 6000)
			expect(result).toHaveProperty("artifactPath")
			expect(result).toHaveProperty("truncated", true)
			expect(result.artifactPath).toMatch(/cmd-12345\.txt$/)
		})
	})

	describe("Cleanup methods", () => {
		it("should clean up all artifacts in directory", async () => {
			const mockFiles = ["cmd-12345.txt", "cmd-67890.txt", "other-file.txt", "cmd-11111.txt"]
			vi.mocked(fs.promises.readdir).mockResolvedValue(mockFiles as any)
			vi.mocked(fs.promises.unlink).mockResolvedValue(undefined)

			await OutputInterceptor.cleanup(storageDir)

			expect(fs.promises.readdir).toHaveBeenCalledWith(storageDir)
			expect(fs.promises.unlink).toHaveBeenCalledTimes(3)
			expect(fs.promises.unlink).toHaveBeenCalledWith(path.join(storageDir, "cmd-12345.txt"))
			expect(fs.promises.unlink).toHaveBeenCalledWith(path.join(storageDir, "cmd-67890.txt"))
			expect(fs.promises.unlink).toHaveBeenCalledWith(path.join(storageDir, "cmd-11111.txt"))
			expect(fs.promises.unlink).not.toHaveBeenCalledWith(path.join(storageDir, "other-file.txt"))
		})

		it("should handle cleanup when directory doesn't exist", async () => {
			vi.mocked(fs.promises.readdir).mockRejectedValue(new Error("ENOENT"))

			// Should not throw
			await expect(OutputInterceptor.cleanup(storageDir)).resolves.toBeUndefined()
		})

		it("should clean up specific artifacts by executionIds", async () => {
			const mockFiles = ["cmd-12345.txt", "cmd-67890.txt", "cmd-11111.txt"]
			vi.mocked(fs.promises.readdir).mockResolvedValue(mockFiles as any)
			vi.mocked(fs.promises.unlink).mockResolvedValue(undefined)

			// Keep 12345 and 67890, delete 11111
			const keepIds = new Set(["12345", "67890"])
			await OutputInterceptor.cleanupByIds(storageDir, keepIds)

			expect(fs.promises.unlink).toHaveBeenCalledTimes(1)
			expect(fs.promises.unlink).toHaveBeenCalledWith(path.join(storageDir, "cmd-11111.txt"))
			expect(fs.promises.unlink).not.toHaveBeenCalledWith(path.join(storageDir, "cmd-12345.txt"))
			expect(fs.promises.unlink).not.toHaveBeenCalledWith(path.join(storageDir, "cmd-67890.txt"))
		})

		it("should handle unlink errors gracefully", async () => {
			const mockFiles = ["cmd-12345.txt", "cmd-67890.txt"]
			vi.mocked(fs.promises.readdir).mockResolvedValue(mockFiles as any)
			vi.mocked(fs.promises.unlink).mockRejectedValue(new Error("Permission denied"))

			// Should not throw even if unlink fails
			await expect(OutputInterceptor.cleanup(storageDir)).resolves.toBeUndefined()
		})
	})

	describe("getBufferForUI() method", () => {
		it("should return current buffer for UI updates", () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small",
			})

			const output = "Hello World"
			interceptor.write(output)

			expect(interceptor.getBufferForUI()).toBe(output)
		})

		it("should return head + tail buffer after spilling to disk", () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small", // 5KB = 5120, head=2560, tail=2560
			})

			// Trigger spill
			const largeOutput = "x".repeat(10000)
			interceptor.write(largeOutput)

			const buffer = interceptor.getBufferForUI()
			// Buffer for UI is head + tail (no omission indicator for smooth streaming)
			expect(Buffer.byteLength(buffer, "utf8")).toBeLessThanOrEqual(5120)
		})
	})

	describe("Head/Tail split behavior", () => {
		it("should preserve first 50% and last 50% of output", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small", // 5KB = 5120, head=2560, tail=2560
			})

			// Create identifiable head and tail content
			const headContent = "HEAD".repeat(750) // 3000 bytes
			const middleContent = "M".repeat(6000) // 6000 bytes (will be omitted)
			const tailContent = "TAIL".repeat(750) // 3000 bytes

			interceptor.write(headContent)
			interceptor.write(middleContent)
			interceptor.write(tailContent)

			const result = await interceptor.finalize()

			// Should start with HEAD content (first 2560 bytes of head budget)
			expect(result.preview.startsWith("HEAD")).toBe(true)
			// Should end with TAIL content (last 2560 bytes)
			expect(result.preview.endsWith("TAIL")).toBe(true)
			// Should have omission indicator
			expect(result.preview).toContain("[...")
			expect(result.preview).toContain("bytes omitted...]")
		})

		it("should not add omission indicator when output fits in budget", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small", // 5KB
			})

			const smallOutput = "Hello World\n"
			interceptor.write(smallOutput)

			const result = await interceptor.finalize()

			// No omission indicator for small output
			expect(result.preview).toBe(smallOutput)
			expect(result.preview).not.toContain("[...")
		})

		it("should handle output that exactly fills head budget", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small", // 5KB = 5120, head=2560
			})

			// Write exactly 2560 bytes (head budget)
			const exactHeadContent = "x".repeat(2560)
			interceptor.write(exactHeadContent)

			const result = await interceptor.finalize()

			// Should fit entirely in head, no truncation
			expect(result.preview).toBe(exactHeadContent)
			expect(result.truncated).toBe(false)
		})

		it("should split single large chunk across head and tail", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "12345",
				taskId: "task-1",
				command: "test",
				storageDir,
				previewSize: "small", // 5KB = 5120, head=2560, tail=2560
			})

			// Write a single chunk larger than preview budget
			// First 2560 chars go to head, last 2560 chars go to tail
			const content = "A".repeat(2560) + "B".repeat(4000) + "C".repeat(2560)
			interceptor.write(content)

			const result = await interceptor.finalize()

			// Head should have A's
			expect(result.preview.startsWith("A")).toBe(true)
			// Tail should have C's
			expect(result.preview.endsWith("C")).toBe(true)
			// Should have omission indicator
			expect(result.preview).toContain("[...")
		})
	})

	describe("Secret redaction", () => {
		it("redacts api keys in small in-memory output before reaching the preview", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "redact-1",
				taskId: "task-r",
				command: "echo secret",
				storageDir,
				previewSize: "small",
			})

			interceptor.write("Authorization: Bearer abcdef0123456789ABCDEF\n")
			interceptor.write("api_key=sk-this-is-a-fake-but-formatted-secret-12345\n")

			const result = await interceptor.finalize()
			// Security objective: the raw secrets must not be present in the preview.
			expect(result.preview).not.toContain("abcdef0123456789ABCDEF")
			expect(result.preview).not.toContain("sk-this-is-a-fake-but-formatted-secret-12345")
			expect(result.preview).toMatch(/\[REDACTED\]/)
		})

		it("redacts secrets that have been spilled to disk", () => {
			const interceptor = new OutputInterceptor({
				executionId: "redact-2",
				taskId: "task-r",
				command: "echo secret",
				storageDir,
				previewSize: "small", // 5KB
			})

			const filler = "x".repeat(3000)
			interceptor.write(filler)
			interceptor.write("Authorization: Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ\n")
			interceptor.write(filler) // forces spill

			expect(interceptor.hasSpilledToDisk()).toBe(true)

			// Inspect what was written to the underlying mock stream — the
			// raw secret must NOT be present anywhere on disk.
			const writeCalls = mockWriteStream.write.mock.calls.map((c: unknown[]) => String(c[0])).join("")
			expect(writeCalls).not.toContain("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
			expect(writeCalls).toMatch(/\[REDACTED\]/)
		})

		it("redacts a Bearer token split across two writes via tail-carry", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "redact-3",
				taskId: "task-r",
				command: "echo secret",
				storageDir,
				previewSize: "small",
			})

			// Split mid-token — earlier this would have leaked the secret.
			// Pad so the split point falls within the carry window.
			const pad = "y".repeat(400)
			interceptor.write(pad + "Authorization: Bearer abcdef")
			interceptor.write("ghijkl0123456789\n")

			const result = await interceptor.finalize()
			expect(result.preview).not.toContain("abcdefghijkl0123456789")
			expect(result.preview).toMatch(/\[REDACTED\]/)
		})

		it("redacts a 300+ char Bearer token even when the value spans many writes", async () => {
			const interceptor = new OutputInterceptor({
				executionId: "redact-long",
				taskId: "task-r",
				command: "echo long-secret",
				storageDir,
				previewSize: "small",
			})

			// 600-char token — the previous fixed 256-char tail-carry leaked
			// the suffix (last 256 chars). The streaming redactor must hold
			// the entire sensitive line until the newline.
			const longToken = "A".repeat(600)
			interceptor.write("Authorization: Bearer ")
			// Stream the token in 50-char fragments to maximally stress the
			// boundary handling.
			for (let i = 0; i < longToken.length; i += 50) {
				interceptor.write(longToken.slice(i, i + 50))
			}
			interceptor.write("\nfollow-up line\n")

			const result = await interceptor.finalize()
			expect(result.preview).not.toContain(longToken)
			// Suffix-only check: the last 256 / 512 chars of the token must
			// not survive — directly addresses the reviewer's leak repro.
			expect(result.preview).not.toContain(longToken.slice(-256))
			expect(result.preview).not.toContain(longToken.slice(-512))
			expect(result.preview).toContain("follow-up line")
		})

		it("redacts a long token in the spilled-to-disk path", () => {
			const interceptor = new OutputInterceptor({
				executionId: "redact-long-disk",
				taskId: "task-r",
				command: "echo big",
				storageDir,
				previewSize: "small", // 5KB
			})

			const longToken = "Z".repeat(700)
			// Force spill: write enough non-sensitive padding, then the secret.
			interceptor.write("x".repeat(3000))
			interceptor.write(`Authorization: Bearer ${longToken}\n`)
			interceptor.write("x".repeat(3000)) // pushes us over threshold

			expect(interceptor.hasSpilledToDisk()).toBe(true)
			const written = mockWriteStream.write.mock.calls.map((c: unknown[]) => String(c[0])).join("")
			expect(written).not.toContain(longToken)
			expect(written).not.toContain(longToken.slice(-256))
			expect(written).toMatch(/\[REDACTED\]/)
		})
	})
})
