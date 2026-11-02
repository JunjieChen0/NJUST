// npx vitest services/code-index/processors/__tests__/file-watcher.spec.ts

import { describe, it, expect, vi, beforeEach } from "vitest"

import * as vscode from "vscode"

import { createHash } from "crypto"
import { v5 as uuidv5 } from "uuid"

import { FileWatcher } from "../file-watcher"
import { codeParser } from "../parser"
import { INDEX_INCOMPLETE_HASH, QDRANT_CODE_BLOCK_NAMESPACE } from "../../constants"

function makeBlock(overrides: { segmentHash: string }) {
	return {
		file_path: "/mock/workspace/src/long-line.ts",
		identifier: null,
		type: "line_segment",
		start_line: 1,
		end_line: 1,
		content: `content of ${overrides.segmentHash}`,
		fileHash: "file-hash",
		...overrides,
	}
}

// Mock TelemetryService
vi.mock("../../../../../packages/telemetry/src/TelemetryService", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
}))

// Mock dependencies
vi.mock("../../cache-manager")
vi.mock("../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: class {
		validateAccess = vi.fn().mockReturnValue(true)
	},
}))
vi.mock("ignore")
vi.mock("../parser", () => ({
	codeParser: {
		parseFile: vi.fn().mockResolvedValue([]),
	},
}))
vi.mock("../../../glob/ignore-utils", () => ({
	isPathInIgnoredDirectory: vi.fn().mockReturnValue(false),
}))

// Mock vscode module
vi.mock("vscode", () => ({
	workspace: {
		createFileSystemWatcher: vi.fn(),
		workspaceFolders: [
			{
				uri: {
					fsPath: "/mock/workspace",
				},
			},
		],
		fs: {
			stat: vi.fn().mockResolvedValue({ size: 1000 }),
			readFile: vi.fn().mockResolvedValue(Buffer.from("test content")),
		},
	},
	RelativePattern: vi.fn(function (base, pattern) {
		return { base, pattern }
	}),
	Uri: {
		file: vi.fn(function (path) {
			return {
				fsPath: path,
			}
		}),
	},
	EventEmitter: vi.fn(function () {
		return {
			event: vi.fn(),
			fire: vi.fn(),
			dispose: vi.fn(),
		}
	}),
	ExtensionContext: vi.fn(function () {}),
}))

describe("FileWatcher", () => {
	let fileWatcher: FileWatcher
	let mockWatcher: any
	let mockOnDidCreate: any
	let mockOnDidChange: any
	let mockOnDidDelete: any
	let mockContext: any
	let mockCacheManager: any
	let mockEmbedder: any
	let mockVectorStore: any
	let mockIgnoreInstance: any

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks()

		// Create mock event handlers
		mockOnDidCreate = vi.fn()
		mockOnDidChange = vi.fn()
		mockOnDidDelete = vi.fn()

		// Create mock watcher
		mockWatcher = {
			onDidCreate: vi.fn(function (handler) {
				mockOnDidCreate = handler
				return { dispose: vi.fn() }
			}),
			onDidChange: vi.fn(function (handler) {
				mockOnDidChange = handler
				return { dispose: vi.fn() }
			}),
			onDidDelete: vi.fn(function (handler) {
				mockOnDidDelete = handler
				return { dispose: vi.fn() }
			}),
			dispose: vi.fn(),
		}

		// Mock createFileSystemWatcher to return our mock watcher
		vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(mockWatcher)

		// Create mock dependencies
		mockContext = {
			subscriptions: [],
		}

		mockCacheManager = {
			getHash: vi.fn(),
			updateHash: vi.fn(),
			deleteHash: vi.fn(),
			markIncomplete: vi.fn().mockResolvedValue(undefined),
		}

		mockEmbedder = {
			createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
		}

		mockVectorStore = {
			upsertPoints: vi.fn().mockResolvedValue(undefined),
			deletePointsByFilePath: vi.fn().mockResolvedValue(undefined),
			deletePointsByMultipleFilePaths: vi.fn().mockResolvedValue(undefined),
		}

		mockIgnoreInstance = {
			ignores: vi.fn().mockReturnValue(false),
		}

		fileWatcher = new FileWatcher(
			"/mock/workspace",
			mockContext,
			mockCacheManager,
			mockEmbedder,
			mockVectorStore,
			mockIgnoreInstance,
		)
	})

	describe("file filtering", () => {
		beforeEach(() => {
			vi.useFakeTimers()
		})

		afterEach(() => {
			vi.useRealTimers()
		})

		it("should ignore files in hidden directories on create events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Spy on the vector store to see which files are actually processed
			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async function (points: any[]) {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			// Simulate file creation events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.git/config", shouldProcess: false },
				{ path: "/mock/workspace/.hidden/file.ts", shouldProcess: false },
				{ path: "/mock/workspace/src/.next/static/file.js", shouldProcess: false },
				{ path: "/mock/workspace/node_modules/package/index.js", shouldProcess: false },
				{ path: "/mock/workspace/normal/file.js", shouldProcess: true },
			]

			// Trigger file creation events
			for (const { path } of testCases) {
				await mockOnDidCreate({ fsPath: path })
			}

			// Wait for batch processing
			await vi.advanceTimersByTimeAsync(600)

			// Check that files in hidden directories were not processed
			expect(processedFiles).not.toContain("src/.next/static/file.js")
			expect(processedFiles).not.toContain(".git/config")
			expect(processedFiles).not.toContain(".hidden/file.ts")
		})

		it("should ignore files in hidden directories on change events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Track which files are processed
			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async function (points: any[]) {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			// Simulate file change events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.vscode/settings.json", shouldProcess: false },
				{ path: "/mock/workspace/src/.cache/data.json", shouldProcess: false },
				{ path: "/mock/workspace/dist/bundle.js", shouldProcess: false },
			]

			// Trigger file change events
			for (const { path } of testCases) {
				await mockOnDidChange({ fsPath: path })
			}

			// Wait for batch processing
			await vi.advanceTimersByTimeAsync(600)

			// Check that files in hidden directories were not processed
			expect(processedFiles).not.toContain(".vscode/settings.json")
			expect(processedFiles).not.toContain("src/.cache/data.json")
		})

		it("should ignore files in hidden directories on delete events", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Track which files are deleted
			const deletedFiles: string[] = []
			mockVectorStore.deletePointsByFilePath.mockImplementation(async function (filePath: string) {
				deletedFiles.push(filePath)
			})

			// Simulate file deletion events
			const testCases = [
				{ path: "/mock/workspace/src/file.ts", shouldProcess: true },
				{ path: "/mock/workspace/.git/objects/abc123", shouldProcess: false },
				{ path: "/mock/workspace/.DS_Store", shouldProcess: false },
				{ path: "/mock/workspace/build/.cache/temp.js", shouldProcess: false },
			]

			// Trigger file deletion events
			for (const { path } of testCases) {
				await mockOnDidDelete({ fsPath: path })
			}

			// Wait for batch processing
			await vi.advanceTimersByTimeAsync(600)

			// Check that files in hidden directories were not processed
			expect(deletedFiles).not.toContain(".git/objects/abc123")
			expect(deletedFiles).not.toContain(".DS_Store")
			expect(deletedFiles).not.toContain("build/.cache/temp.js")
		})

		it("should handle nested hidden directories correctly", async () => {
			// Initialize the file watcher
			await fileWatcher.initialize()

			// Track which files are processed
			const processedFiles: string[] = []
			mockVectorStore.upsertPoints.mockImplementation(async function (points: any[]) {
				points.forEach((point) => {
					if (point.payload?.file_path) {
						processedFiles.push(point.payload.file_path)
					}
				})
			})

			// Test deeply nested hidden directories
			const testCases = [
				{ path: "/mock/workspace/src/components/Button.tsx", shouldProcess: true },
				{ path: "/mock/workspace/src/.hidden/components/Button.tsx", shouldProcess: false },
				{ path: "/mock/workspace/.hidden/src/components/Button.tsx", shouldProcess: false },
				{ path: "/mock/workspace/src/components/.hidden/Button.tsx", shouldProcess: false },
			]

			// Trigger file creation events
			for (const { path } of testCases) {
				await mockOnDidCreate({ fsPath: path })
			}

			// Wait for batch processing
			await vi.advanceTimersByTimeAsync(600)

			// Check that files in hidden directories were not processed
			expect(processedFiles).not.toContain("src/.hidden/components/Button.tsx")
			expect(processedFiles).not.toContain(".hidden/src/components/Button.tsx")
			expect(processedFiles).not.toContain("src/components/.hidden/Button.tsx")
		})
	})

	describe("change handling", () => {
		const filePath = "/mock/workspace/src/file.ts"
		// vscode.workspace.fs.readFile is mocked to return "test content".
		const currentHash = createHash("sha256").update("test content").digest("hex")

		beforeEach(() => {
			vi.useFakeTimers()
		})

		afterEach(() => {
			vi.useRealTimers()
		})

		it("keeps existing points when a change event has unchanged content", async () => {
			mockCacheManager.getHash.mockReturnValue(currentHash)
			await fileWatcher.initialize()

			await mockOnDidChange({ fsPath: filePath })
			await vi.advanceTimersByTimeAsync(600)

			expect(mockVectorStore.deletePointsByMultipleFilePaths).not.toHaveBeenCalled()
			expect(mockCacheManager.updateHash).not.toHaveBeenCalled()
		})

		it("replaces points when a change event has new content", async () => {
			mockCacheManager.getHash.mockReturnValue("old-hash")
			vi.mocked(codeParser.parseFile).mockResolvedValueOnce([makeBlock({ segmentHash: "seg-1" }) as never])
			await fileWatcher.initialize()

			await mockOnDidChange({ fsPath: filePath })
			await vi.advanceTimersByTimeAsync(600)

			expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalledWith([filePath])
			expect(mockVectorStore.upsertPoints).toHaveBeenCalled()
			expect(mockCacheManager.updateHash).toHaveBeenCalledWith(filePath, currentHash)
		})

		describe("with a cache and store that keep state", () => {
			const emptyHash = createHash("sha256").update("").digest("hex")

			function useStatefulStores(initialHash: string) {
				const hashes = new Map<string, string>([[filePath, initialHash]])
				mockCacheManager.getHash.mockImplementation((p: string) => hashes.get(p))
				mockCacheManager.updateHash.mockImplementation((p: string, h: string) => {
					hashes.set(p, h)
				})
				mockCacheManager.markIncomplete.mockImplementation(async (paths: string[]) => {
					paths.forEach((p) => hashes.set(p, INDEX_INCOMPLETE_HASH))
				})
				const stored = new Set<string>(["old-point"])
				mockVectorStore.deletePointsByMultipleFilePaths.mockImplementation(async () => {
					stored.clear()
				})
				const storePoints = async (points: Array<{ id: string }>) => {
					points.forEach((p) => stored.add(p.id))
				}
				mockVectorStore.upsertPoints.mockImplementation(storePoints)
				return { hashes, stored, storePoints }
			}

			async function changeTo(content: string, blocks: unknown[]) {
				vi.mocked(vscode.workspace.fs.readFile).mockResolvedValueOnce(Buffer.from(content) as never)
				vi.mocked(codeParser.parseFile).mockResolvedValueOnce(blocks as never)
				await mockOnDidChange({ fsPath: filePath })
				await vi.advanceTimersByTimeAsync(600)
			}

			it("saves the marker before deleting, and changes nothing if that save fails", async () => {
				const { hashes, stored } = useStatefulStores(currentHash)
				await fileWatcher.initialize()

				mockCacheManager.markIncomplete.mockRejectedValueOnce(new Error("disk full"))
				await changeTo("new content", [makeBlock({ segmentHash: "seg-new" })])
				expect(mockVectorStore.deletePointsByMultipleFilePaths).not.toHaveBeenCalled()
				expect(mockVectorStore.upsertPoints).not.toHaveBeenCalled()
				expect(stored.has("old-point")).toBe(true)
				expect(hashes.get(filePath)).toBe(currentHash)

				await changeTo("new content", [makeBlock({ segmentHash: "seg-new" })])
				expect(mockCacheManager.markIncomplete.mock.invocationCallOrder.at(-1)).toBeLessThan(
					mockVectorStore.deletePointsByMultipleFilePaths.mock.invocationCallOrder[0],
				)
			})

			it("re-indexes A after the file went A -> empty -> A", async () => {
				const { hashes, stored } = useStatefulStores(currentHash)
				await fileWatcher.initialize()

				await changeTo("", [])
				expect(stored.size).toBe(0)
				expect(hashes.get(filePath)).toBe(emptyHash)

				await changeTo("test content", [makeBlock({ segmentHash: "seg-a" })])
				expect(stored.size).toBe(1)
				expect(hashes.get(filePath)).toBe(currentHash)
			})

			it("re-indexes the old content after a failed replacement is reverted", async () => {
				const { hashes, stored, storePoints } = useStatefulStores(currentHash)
				await fileWatcher.initialize()

				mockVectorStore.upsertPoints.mockRejectedValue(new Error("qdrant down"))
				await changeTo("new content", [makeBlock({ segmentHash: "seg-new" })])
				await vi.advanceTimersByTimeAsync(10_000)
				expect(stored.size).toBe(0)
				expect(hashes.get(filePath)).not.toBe(currentHash)

				mockVectorStore.upsertPoints.mockImplementation(storePoints)
				await changeTo("test content", [makeBlock({ segmentHash: "seg-a" })])
				expect(stored.size).toBe(1)
				expect(hashes.get(filePath)).toBe(currentHash)
			})
		})

		it("clears old points for a file deleted and recreated within the debounce window", async () => {
			mockCacheManager.getHash.mockReturnValue("old-hash")
			vi.mocked(codeParser.parseFile).mockResolvedValueOnce([makeBlock({ segmentHash: "seg-1" }) as never])
			await fileWatcher.initialize()

			// Coalesced into a single "create" event for the path.
			await mockOnDidDelete({ fsPath: filePath })
			await mockOnDidCreate({ fsPath: filePath })
			await vi.advanceTimersByTimeAsync(600)

			expect(mockVectorStore.deletePointsByMultipleFilePaths).toHaveBeenCalledWith([filePath])
			expect(mockVectorStore.deletePointsByMultipleFilePaths.mock.invocationCallOrder[0]).toBeLessThan(
				mockVectorStore.upsertPoints.mock.invocationCallOrder[0],
			)
			expect(mockCacheManager.updateHash).toHaveBeenCalledWith(filePath, currentHash)
		})
	})

	describe("point ids", () => {
		it("gives segments split from one line distinct ids derived from segmentHash", async () => {
			mockCacheManager.getHash.mockReturnValue(undefined)
			mockEmbedder.createEmbeddings.mockResolvedValueOnce({ embeddings: [[0.1], [0.2], [0.3]] })
			vi.mocked(codeParser.parseFile).mockResolvedValueOnce(
				["seg-a", "seg-b", "seg-c"].map((segmentHash) => makeBlock({ segmentHash })) as never,
			)

			const result = await fileWatcher.processFile("/mock/workspace/src/long-line.ts")

			const points = (result as { pointsToUpsert?: Array<{ id: string; payload: Record<string, unknown> }> })
				.pointsToUpsert
			expect(points).toHaveLength(3)
			expect(new Set(points!.map((p) => p.id)).size).toBe(3)
			expect(points![0]!.id).toBe(uuidv5("seg-a", QDRANT_CODE_BLOCK_NAMESPACE))
			expect(points![0]!.payload.segmentHash).toBe("seg-a")
		})
	})

	describe("dispose", () => {
		it("should dispose of the watcher when disposed", async () => {
			await fileWatcher.initialize()
			fileWatcher.dispose()

			expect(mockWatcher.dispose).toHaveBeenCalled()
		})
	})
})
