// npx vitest services/code-index/processors/__tests__/scanner.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

import { createHash } from "crypto"

import { DirectoryScanner } from "../scanner"
import { INDEX_INCOMPLETE_HASH } from "../../constants"
import * as vscode from "vscode"
import { stat } from "fs/promises"

// Mock TelemetryService
vi.mock("../../../../../packages/telemetry/src/TelemetryService", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

vi.mock("fs/promises", () => ({
	default: {
		readFile: vi.fn(),
		writeFile: vi.fn(),
		mkdir: vi.fn(),
		access: vi.fn(),
		rename: vi.fn(),
		constants: {},
	},
	stat: vi.fn(),
}))

// Create a simple mock for vscode since we can't access the real one
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		],
		getWorkspaceFolder: vi.fn().mockReturnValue({
			uri: {
				fsPath: "/mock/workspace",
			},
		}),
		fs: {
			readFile: vi.fn().mockResolvedValue(Buffer.from("test content")),
		},
	},
	Uri: {
		file: vi.fn().mockImplementation((path) => path),
	},
	window: {
		activeTextEditor: {
			document: {
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		},
	},
}))

vi.mock("../../../../core/ignore/RooIgnoreController")
vi.mock("ignore")

// Override the Jest-based mock with a vitest-compatible version
vi.mock("../../../glob/list-files", () => ({
	listFiles: vi.fn(),
}))

describe("DirectoryScanner", () => {
	let scanner: DirectoryScanner
	let mockEmbedder: any
	let mockVectorStore: any
	let mockCodeParser: any
	let mockCacheManager: any
	let mockIgnoreInstance: any
	let mockStats: any

	beforeEach(async () => {
		mockEmbedder = {
			createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
			embedderInfo: { name: "mock-embedder", dimensions: 384 },
		}
		mockVectorStore = {
			upsertPoints: vi.fn().mockResolvedValue(undefined),
			deletePointsByFilePath: vi.fn().mockResolvedValue(undefined),
			deletePointsByMultipleFilePaths: vi.fn().mockResolvedValue(undefined),
			initialize: vi.fn().mockResolvedValue(true),
			search: vi.fn().mockResolvedValue([]),
			clearCollection: vi.fn().mockResolvedValue(undefined),
			deleteCollection: vi.fn().mockResolvedValue(undefined),
			collectionExists: vi.fn().mockResolvedValue(true),
		}
		mockCodeParser = {
			parseFile: vi.fn().mockResolvedValue([]),
		}
		mockCacheManager = {
			getHash: vi.fn().mockReturnValue(undefined),
			getAllHashes: vi.fn().mockReturnValue({}),
			updateHash: vi.fn().mockResolvedValue(undefined),
			deleteHash: vi.fn().mockResolvedValue(undefined),
			markIncomplete: vi.fn().mockResolvedValue(undefined),
			initialize: vi.fn().mockResolvedValue(undefined),
			clearCacheFile: vi.fn().mockResolvedValue(undefined),
		}
		mockIgnoreInstance = {
			ignores: vi.fn().mockReturnValue(false),
		}

		scanner = new DirectoryScanner(
			mockEmbedder,
			mockVectorStore,
			mockCodeParser,
			mockCacheManager,
			mockIgnoreInstance,
		)

		// Mock default implementations - create proper Stats object
		mockStats = {
			size: 1024,
			isFile: () => true,
			isDirectory: () => false,
			isBlockDevice: () => false,
			isCharacterDevice: () => false,
			isSymbolicLink: () => false,
			isFIFO: () => false,
			isSocket: () => false,
			dev: 0,
			ino: 0,
			mode: 0,
			nlink: 0,
			uid: 0,
			gid: 0,
			rdev: 0,
			blksize: 0,
			blocks: 0,
			atimeMs: 0,
			mtimeMs: 0,
			ctimeMs: 0,
			birthtimeMs: 0,
			atime: new Date(),
			mtime: new Date(),
			ctime: new Date(),
			birthtime: new Date(),
			atimeNs: BigInt(0),
			mtimeNs: BigInt(0),
			ctimeNs: BigInt(0),
			birthtimeNs: BigInt(0),
		}
		vi.mocked(stat).mockResolvedValue(mockStats)

		// Get and mock the listFiles function
		const { listFiles } = await import("../../../glob/list-files")
		vi.mocked(listFiles).mockResolvedValue([["test/file1.js", "test/file2.js"], false])
	})

	describe("scanDirectory", () => {
		it("should skip files larger than MAX_FILE_SIZE_BYTES", async () => {
			const { listFiles } = await import("../../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["test/file1.js"], false])

			// Create large file mock stats
			const largeFileStats = {
				...mockStats,
				size: 2 * 1024 * 1024, // 2MB > 1MB limit
			}
			vi.mocked(stat).mockResolvedValueOnce(largeFileStats)

			const result = await scanner.scanDirectory("/test")
			expect(result.stats.skipped).toBe(1)
			expect(mockCodeParser.parseFile).not.toHaveBeenCalled()
		})

		it("should parse changed files and return empty codeBlocks array", async () => {
			// Create scanner without embedder to test the non-embedding path
			const scannerNoEmbeddings = new DirectoryScanner(
				null as any, // No embedder
				null as any, // No vector store
				mockCodeParser,
				mockCacheManager,
				mockIgnoreInstance,
			)

			const { listFiles } = await import("../../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["test/file1.js"], false])
			const mockBlocks: any[] = [
				{
					file_path: "test/file1.js",
					content: "test content",
					start_line: 1,
					end_line: 5,
					identifier: "test",
					type: "function",
					fileHash: "hash",
					segmentHash: "segment-hash",
				},
			]
			;(mockCodeParser.parseFile as any).mockResolvedValue(mockBlocks)

			const result = await scannerNoEmbeddings.scanDirectory("/test")
			expect(result.stats.processed).toBe(1)
		})

		it("should process embeddings for new/changed files", async () => {
			const mockBlocks: any[] = [
				{
					file_path: "test/file1.js",
					content: "test content",
					start_line: 1,
					end_line: 5,
					identifier: "test",
					type: "function",
					fileHash: "hash",
					segmentHash: "segment-hash",
				},
			]
			;(mockCodeParser.parseFile as any).mockResolvedValue(mockBlocks)

			await scanner.scanDirectory("/test")
			expect(mockEmbedder.createEmbeddings).toHaveBeenCalled()
			expect(mockVectorStore.upsertPoints).toHaveBeenCalled()
		})

		it("should delete points for removed files", async () => {
			;(mockCacheManager.getAllHashes as any).mockReturnValue({ "old/file.js": "old-hash" })

			await scanner.scanDirectory("/test")
			expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalledWith(["old/file.js"])
			expect(mockCacheManager.deleteHash).toHaveBeenCalledWith("old/file.js")
		})

		it("should filter out files in hidden directories", async () => {
			const { listFiles } = await import("../../../glob/list-files")
			// Mock listFiles to return files including some in hidden directories
			vi.mocked(listFiles).mockResolvedValue([
				[
					"test/file1.js",
					"test/.hidden/file2.js",
					".git/config",
					"src/.next/static/file3.js",
					"normal/file4.js",
				],
				false,
			])

			// Mock parseFile to track which files are actually processed
			const processedFiles: string[] = []
			;(mockCodeParser.parseFile as any).mockImplementation(function (filePath: string) {
				processedFiles.push(filePath)
				return []
			})

			await scanner.scanDirectory("/test")

			// Verify that only non-hidden files were processed
			expect(processedFiles).toEqual(["test/file1.js", "normal/file4.js"])
			expect(processedFiles).not.toContain("test/.hidden/file2.js")
			expect(processedFiles).not.toContain(".git/config")
			expect(processedFiles).not.toContain("src/.next/static/file3.js")

			// Verify the stats
			expect(mockCodeParser.parseFile).toHaveBeenCalledTimes(2)
		})

		it("should process markdown files alongside code files", async () => {
			// Create scanner without embedder to test the non-embedding path
			const scannerNoEmbeddings = new DirectoryScanner(
				null as any, // No embedder
				null as any, // No vector store
				mockCodeParser,
				mockCacheManager,
				mockIgnoreInstance,
			)

			const { listFiles } = await import("../../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["test/README.md", "test/app.js", "docs/guide.markdown"], false])

			const mockMarkdownBlocks: any[] = [
				{
					file_path: "test/README.md",
					content: "# Introduction\nThis is a comprehensive guide...",
					start_line: 1,
					end_line: 10,
					identifier: "Introduction",
					type: "markdown_header_h1",
					fileHash: "md-hash",
					segmentHash: "md-segment-hash",
				},
			]

			const mockJsBlocks: any[] = [
				{
					file_path: "test/app.js",
					content: "function main() { return 'hello'; }",
					start_line: 1,
					end_line: 3,
					identifier: "main",
					type: "function",
					fileHash: "js-hash",
					segmentHash: "js-segment-hash",
				},
			]

			const mockMarkdownBlocks2: any[] = [
				{
					file_path: "docs/guide.markdown",
					content: "## Getting Started\nFollow these steps...",
					start_line: 1,
					end_line: 8,
					identifier: "Getting Started",
					type: "markdown_header_h2",
					fileHash: "markdown-hash",
					segmentHash: "markdown-segment-hash",
				},
			]

			// Mock parseFile to return different blocks based on file extension
			;(mockCodeParser.parseFile as any).mockImplementation(function (filePath: string) {
				if (filePath.endsWith(".md")) {
					return mockMarkdownBlocks
				} else if (filePath.endsWith(".markdown")) {
					return mockMarkdownBlocks2
				} else if (filePath.endsWith(".js")) {
					return mockJsBlocks
				}
				return []
			})

			const result = await scannerNoEmbeddings.scanDirectory("/test")

			// Verify all files were processed
			expect(mockCodeParser.parseFile).toHaveBeenCalledTimes(3)
			expect(mockCodeParser.parseFile).toHaveBeenCalledWith("test/README.md", expect.any(Object))
			expect(mockCodeParser.parseFile).toHaveBeenCalledWith("test/app.js", expect.any(Object))
			expect(mockCodeParser.parseFile).toHaveBeenCalledWith("docs/guide.markdown", expect.any(Object))

			// Verify processing still works without codeBlocks accumulation
			expect(result.stats.processed).toBe(3)
		})

		it("should generate unique point IDs for each block from the same file", async () => {
			const { listFiles } = await import("../../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["test/large-doc.md"], false])

			// Mock multiple blocks from the same file with different segmentHash values
			const mockBlocks: any[] = [
				{
					file_path: "test/large-doc.md",
					content: "# Introduction\nThis is the intro section...",
					start_line: 1,
					end_line: 10,
					identifier: "Introduction",
					type: "markdown_header_h1",
					fileHash: "same-file-hash",
					segmentHash: "unique-segment-hash-1",
				},
				{
					file_path: "test/large-doc.md",
					content: "## Getting Started\nHere's how to begin...",
					start_line: 11,
					end_line: 20,
					identifier: "Getting Started",
					type: "markdown_header_h2",
					fileHash: "same-file-hash",
					segmentHash: "unique-segment-hash-2",
				},
				{
					file_path: "test/large-doc.md",
					content: "## Advanced Topics\nFor advanced users...",
					start_line: 21,
					end_line: 30,
					identifier: "Advanced Topics",
					type: "markdown_header_h2",
					fileHash: "same-file-hash",
					segmentHash: "unique-segment-hash-3",
				},
			]

			;(mockCodeParser.parseFile as any).mockResolvedValue(mockBlocks)

			await scanner.scanDirectory("/test")

			// Verify that upsertPoints was called with unique IDs for each block
			expect(mockVectorStore.upsertPoints).toHaveBeenCalledTimes(1)
			const upsertCall = mockVectorStore.upsertPoints.mock.calls[0]
			const points = upsertCall[0]

			// Extract the IDs from the points
			const pointIds = points.map((point: any) => point.id)

			// Verify all IDs are unique
			expect(pointIds).toHaveLength(3)
			expect(new Set(pointIds).size).toBe(3) // All IDs should be unique

			// Verify that each point has the correct payload
			expect(points[0].payload.segmentHash).toBe("unique-segment-hash-1")
			expect(points[1].payload.segmentHash).toBe("unique-segment-hash-2")
			expect(points[2].payload.segmentHash).toBe("unique-segment-hash-3")
		})

		it("should stop processing files when signal is aborted", async () => {
			const { listFiles } = await import("../../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["test/file1.js", "test/file2.js", "test/file3.js"], false])

			// Create an already-aborted signal
			const controller = new AbortController()
			controller.abort()

			const result = await scanner.scanDirectory("/test", undefined, undefined, undefined, controller.signal)

			// No files should have been processed since signal was already aborted
			expect(mockCodeParser.parseFile).not.toHaveBeenCalled()
			expect(result.stats.processed).toBe(0)
		})

		it("should stop processing batches when signal is aborted mid-scan", async () => {
			const { listFiles } = await import("../../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["test/file1.js", "test/file2.js"], false])

			const controller = new AbortController()

			const mockBlocks: any[] = [
				{
					file_path: "test/file1.js",
					content: "function hello() {}",
					start_line: 1,
					end_line: 3,
					identifier: "hello",
					type: "function",
					fileHash: "hash1",
					segmentHash: "seg-hash-1",
				},
			]

			// Abort after first file is parsed
			;(mockCodeParser.parseFile as any).mockImplementation(async function () {
				controller.abort()
				return mockBlocks
			})

			// AbortError should propagate up (the orchestrator handles it in its catch block)
			await expect(
				scanner.scanDirectory("/test", undefined, undefined, undefined, controller.signal),
			).rejects.toThrow("Indexing aborted")
		})

		it("should not process deleted files when signal is aborted", async () => {
			const { listFiles } = await import("../../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([[], false])

			// Set up cached files that would normally be detected as deleted
			;(mockCacheManager.getAllHashes as any).mockReturnValue({ "old/file.js": "old-hash" })

			// Create an already-aborted signal
			const controller = new AbortController()
			controller.abort()

			await scanner.scanDirectory("/test", undefined, undefined, undefined, controller.signal)

			// Deleted file cleanup should not have run
			expect(mockVectorStore.deletePointsByMultipleFilePaths).not.toHaveBeenCalled()
		})
	})

	describe("modified file spanning batch boundaries", () => {
		// vscode.workspace.fs.readFile is mocked to return "test content".
		const newHash = createHash("sha256").update("test content").digest("hex")

		/** Single-file fake store: delete clears the file, upsert adds points by id. */
		function useFakeStore() {
			const stored = new Set<string>()
			mockVectorStore.deletePointsByMultipleFilePaths.mockImplementation(async () => {
				stored.clear()
			})
			mockVectorStore.upsertPoints.mockImplementation(async (points: Array<{ id: string }>) => {
				points.forEach((p) => stored.add(p.id))
			})
			mockEmbedder.createEmbeddings.mockImplementation(async (texts: string[]) => ({
				embeddings: texts.map(() => [0.1]),
			}))
			return stored
		}

		function makeBlocks(count: number) {
			return Array.from({ length: count }, (_, i) => ({
				file_path: "test/file1.js",
				content: `block ${i}`,
				start_line: i + 1,
				end_line: i + 1,
				identifier: null,
				type: "function",
				fileHash: newHash,
				segmentHash: `segment-${i}`,
			}))
		}

		beforeEach(async () => {
			const { listFiles } = await import("../../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["test/file1.js"], false])
			mockCacheManager.getHash.mockReturnValue("old-hash")
			scanner = new DirectoryScanner(
				mockEmbedder,
				mockVectorStore,
				mockCodeParser,
				mockCacheManager,
				mockIgnoreInstance,
				60,
			)
		})

		it.each([63, 60, 120])(
			"keeps all %i new blocks, deletes old points once, then updates the hash",
			async (blockCount) => {
				const stored = useFakeStore()
				mockCodeParser.parseFile.mockResolvedValue(makeBlocks(blockCount))

				await scanner.scanDirectory("/test")

				expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalledTimes(1)
				expect(stored.size).toBe(blockCount)
				expect(mockCacheManager.updateHash).toHaveBeenLastCalledWith("test/file1.js", newHash)
				expect(mockCacheManager.updateHash.mock.calls.filter((c: unknown[]) => c[1] === newHash)).toHaveLength(
					1,
				)
			},
		)

		it("does not update the hash when one of the file's batches fails", async () => {
			useFakeStore()
			mockCodeParser.parseFile.mockResolvedValue(makeBlocks(63))
			mockVectorStore.upsertPoints.mockRejectedValue(new Error("qdrant down"))

			await scanner.scanDirectory("/test")

			expect(mockCacheManager.updateHash).not.toHaveBeenCalledWith("test/file1.js", newHash)
		})

		it.each([
			["no blocks", []],
			["only blank blocks", [{ ...makeBlocks(1)[0], content: "   \n" }]],
		])("deletes old points and updates the hash when the file now parses to %s", async (_label, blocks) => {
			const stored = useFakeStore()
			stored.add("old-point")
			mockCodeParser.parseFile.mockResolvedValue(blocks)

			await scanner.scanDirectory("/test")

			expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalledTimes(1)
			expect(stored.size).toBe(0)
			expect(mockCacheManager.updateHash).toHaveBeenCalledWith("test/file1.js", newHash)
		})

		it("keeps old points and the old hash when parsing fails", async () => {
			const stored = useFakeStore()
			stored.add("old-point")
			mockCodeParser.parseFile.mockRejectedValue(new Error("No parser available for file extension: js"))

			await scanner.scanDirectory("/test")

			expect(mockVectorStore.deletePointsByMultipleFilePaths).not.toHaveBeenCalled()
			expect(stored.has("old-point")).toBe(true)
			expect(mockCacheManager.updateHash).not.toHaveBeenCalled()
		})

		describe("new file that was only partly indexed", () => {
			const emptiedHash = createHash("sha256").update("").digest("hex")

			/** Cache and store that keep state across scans, starting with no hash for the file. */
			function useStatefulStores() {
				const hashes = new Map<string, string>()
				mockCacheManager.getHash.mockImplementation((p: string) => hashes.get(p))
				mockCacheManager.getAllHashes.mockImplementation(() => Object.fromEntries(hashes))
				mockCacheManager.updateHash.mockImplementation((p: string, h: string) => {
					hashes.set(p, h)
				})
				mockCacheManager.deleteHash.mockImplementation((p: string) => {
					hashes.delete(p)
				})
				mockCacheManager.markIncomplete.mockImplementation(async (paths: string[]) => {
					paths.forEach((p) => hashes.set(p, INDEX_INCOMPLETE_HASH))
				})
				const stored = new Set<string>()
				mockVectorStore.deletePointsByMultipleFilePaths.mockImplementation(async () => {
					stored.clear()
				})
				mockEmbedder.createEmbeddings.mockImplementation(async (texts: string[]) => ({
					embeddings: texts.map(() => [0.1]),
				}))
				const storePoints = async (points: Array<{ id: string }>) => {
					points.forEach((p) => stored.add(p.id))
				}
				return { hashes, stored, storePoints }
			}

			async function rescanEmptied() {
				vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(Buffer.from("") as never)
				mockCodeParser.parseFile.mockResolvedValueOnce([])
				await scanner.scanDirectory("/test")
			}

			it("clears stale points when it is emptied after a failed first scan", async () => {
				const { hashes, stored, storePoints } = useStatefulStores()
				mockVectorStore.upsertPoints
					.mockImplementationOnce(storePoints)
					.mockRejectedValue(new Error("qdrant down"))
				mockCodeParser.parseFile.mockResolvedValueOnce(makeBlocks(63))

				await scanner.scanDirectory("/test")
				expect(stored.size).toBeGreaterThan(0)

				await rescanEmptied()

				expect(stored.size).toBe(0)
				expect(hashes.get("test/file1.js")).toBe(emptiedHash)
			})

			it("restores points when a modified file that failed to re-index goes back to its old content", async () => {
				const { hashes, stored, storePoints } = useStatefulStores()
				const oldContent = "old content"
				const oldHash = createHash("sha256").update(oldContent).digest("hex")
				hashes.set("test/file1.js", oldHash)
				stored.add("old-point")

				// Content changes to "test content", but writing its blocks fails.
				mockVectorStore.upsertPoints.mockRejectedValue(new Error("qdrant down"))
				mockCodeParser.parseFile.mockResolvedValueOnce(makeBlocks(3))
				await scanner.scanDirectory("/test")
				expect(stored.size).toBe(0)
				expect(hashes.get("test/file1.js")).not.toBe(oldHash)

				// The file goes back to its old content and is rescanned.
				mockVectorStore.upsertPoints.mockImplementation(storePoints)
				vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(Buffer.from(oldContent) as never)
				mockCodeParser.parseFile.mockResolvedValueOnce(makeBlocks(2))
				await scanner.scanDirectory("/test")

				expect(stored.size).toBe(2)
				expect(hashes.get("test/file1.js")).toBe(oldHash)
			})

			it("leaves the old points and hash alone when the marker cannot be saved", async () => {
				const { hashes, stored } = useStatefulStores()
				hashes.set("test/file1.js", "old-hash")
				stored.add("old-point")
				mockCacheManager.markIncomplete.mockRejectedValue(new Error("disk full"))
				mockCodeParser.parseFile.mockResolvedValueOnce(makeBlocks(3))

				await scanner.scanDirectory("/test")

				expect(mockVectorStore.deletePointsByMultipleFilePaths).not.toHaveBeenCalled()
				expect(mockVectorStore.upsertPoints).not.toHaveBeenCalled()
				expect(stored.has("old-point")).toBe(true)
				expect(hashes.get("test/file1.js")).toBe("old-hash")
			})

			it("saves the marker before deleting old points", async () => {
				const { hashes } = useStatefulStores()
				hashes.set("test/file1.js", "old-hash")
				mockCodeParser.parseFile.mockResolvedValueOnce(makeBlocks(3))

				await scanner.scanDirectory("/test")

				expect(mockCacheManager.markIncomplete).toHaveBeenCalledWith(["test/file1.js"])
				expect(mockCacheManager.markIncomplete.mock.invocationCallOrder[0]).toBeLessThan(
					mockVectorStore.deletePointsByMultipleFilePaths.mock.invocationCallOrder[0],
				)
			})

			it("clears stale points when it is emptied after an aborted first scan", async () => {
				const { hashes, stored, storePoints } = useStatefulStores()
				const controller = new AbortController()
				mockVectorStore.upsertPoints.mockImplementation(async (points: Array<{ id: string }>) => {
					await storePoints(points)
					controller.abort()
				})
				mockCodeParser.parseFile.mockResolvedValueOnce(makeBlocks(63))

				await scanner
					.scanDirectory("/test", undefined, undefined, undefined, controller.signal)
					.catch(() => undefined)
				expect(stored.size).toBeGreaterThan(0)
				expect(stored.size).toBeLessThan(63)

				mockVectorStore.upsertPoints.mockImplementation(storePoints)
				await rescanEmptied()

				expect(stored.size).toBe(0)
				expect(hashes.get("test/file1.js")).toBe(emptiedHash)
			})
		})
	})
})
