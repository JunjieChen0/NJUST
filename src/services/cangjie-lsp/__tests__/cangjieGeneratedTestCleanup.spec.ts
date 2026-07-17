import { describe, it, expect, vi, beforeEach } from "vitest"
import * as crypto from "crypto"
import * as path from "path"

const {
	mockExistsSync,
	mockStatSync,
	mockUnlinkSync,
	mockReadFileSync,
	mockLstat,
	mockRealpath,
	mockReadFile,
	mockUnlink,
} = vi.hoisted(() => ({
	mockExistsSync: vi.fn(),
	mockStatSync: vi.fn(),
	mockUnlinkSync: vi.fn(),
	mockReadFileSync: vi.fn(),
	mockLstat: vi.fn(),
	mockRealpath: vi.fn(),
	mockReadFile: vi.fn(),
	mockUnlink: vi.fn(),
}))

vi.mock("fs", async () => {
	const actual = await vi.importActual<typeof import("fs")>("fs")
	return {
		...actual,
		default: {
			...actual,
			existsSync: mockExistsSync,
			statSync: mockStatSync,
			unlinkSync: mockUnlinkSync,
			readFileSync: mockReadFileSync,
		},
		existsSync: mockExistsSync,
		statSync: mockStatSync,
		unlinkSync: mockUnlinkSync,
		readFileSync: mockReadFileSync,
	}
})

vi.mock("fs/promises", () => ({
	lstat: mockLstat,
	realpath: mockRealpath,
	readFile: mockReadFile,
	unlink: mockUnlink,
}))

vi.mock("../../../shared/logger", () => ({
	logger: { warn: vi.fn(), info: vi.fn() },
}))

vi.mock("../../../shared/security-audit", () => ({
	logSecurityEvent: vi.fn(),
}))

vi.mock("@njust-ai/telemetry", () => ({
	TelemetryService: { reportError: vi.fn() },
}))

vi.mock("@njust-ai/types", () => ({
	TelemetryEventName: { CANGJIE_LSP_ERROR: "cangjie_lsp_error" },
}))

import {
	initTestCleanup,
	registerGeneratedCangjieTestFile,
	transitionTaskFilesToDetached,
	transitionStaleRegistrationsToDetached,
	scanGeneratedFilesForCleanup,
	deleteConfirmedCangjieTestFiles,
	reassociateLegacyFiles,
	getRecordsForTask,
	clearAllRegistrations,
	WORKSPACE_STATE_KEY,
	NO_TASK_KEY,
} from "../cangjieGeneratedTestCleanup"

function createMockMemento(initial?: Record<string, unknown>): {
	get: <T>(key: string, defaultValue?: T) => T
	update: ReturnType<typeof vi.fn>
} {
	const store: Record<string, unknown> = { ...initial }
	return {
		get: <T>(key: string, defaultValue?: T): T => (key in store ? (store[key] as T) : (defaultValue as T)),
		update: vi.fn(async (key: string, value: unknown) => {
			store[key] = value
		}),
	}
}

function makeHash(content: string): string {
	return crypto.createHash("sha256").update(content).digest("hex")
}

let uniqueCounter = 0
function uniqueTaskId(): string {
	return `task_${Date.now()}_${++uniqueCounter}`
}

describe("cangjieGeneratedTestCleanup", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockExistsSync.mockReturnValue(false)
		mockReadFileSync.mockReturnValue(Buffer.from("test content"))
		mockReadFile.mockResolvedValue(Buffer.from("test content"))
		clearAllRegistrations()
	})

	describe("initTestCleanup", () => {
		it("loads valid new format records from memento", () => {
			const validHash = makeHash("content")
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					task1: [
						{
							taskId: "task1",
							status: "detached",
							workspaceRoot: "/ws",
							absolutePath: "/path/to/test_test.cj",
							contentSha256: validHash,
							createdAt: 1000,
							kind: "cangjie-test",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			const records = getRecordsForTask("task1")
			expect(records).toHaveLength(1)
			expect(records[0].status).toBe("detached")
		})

		it("migrates legacy string[] format to legacy status", () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: { task1: ["/path/to/test_test.cj"] },
			})
			initTestCleanup(memento as any)
			const records = getRecordsForTask("task1")
			expect(records).toHaveLength(1)
			expect(records[0].status).toBe("legacy")
			expect(records[0].contentSha256).toBeUndefined()
		})

		it("handles empty memento", () => {
			const memento = createMockMemento()
			expect(() => initTestCleanup(memento as any)).not.toThrow()
		})

		it("ignores non-array entries in saved state", () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: { task1: "not-an-array" } as any,
			})
			expect(() => initTestCleanup(memento as any)).not.toThrow()
		})

		it("rejects records with invalid status", () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					task1: [
						{
							taskId: "task1",
							status: "malicious",
							workspaceRoot: "/ws",
							absolutePath: "/path/to/test_test.cj",
							createdAt: 1000,
							kind: "cangjie-test",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			expect(getRecordsForTask("task1")).toHaveLength(0)
		})

		it("rejects records with wrong kind", () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					task1: [
						{
							taskId: "task1",
							status: "active",
							workspaceRoot: "/ws",
							absolutePath: "/path/to/test_test.cj",
							createdAt: 1000,
							kind: "other",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			expect(getRecordsForTask("task1")).toHaveLength(0)
		})

		it("rejects records with invalid contentSha256 (not 64 hex)", () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					task1: [
						{
							taskId: "task1",
							status: "active",
							workspaceRoot: "/ws",
							absolutePath: "/path/to/test_test.cj",
							contentSha256: "short",
							createdAt: 1000,
							kind: "cangjie-test",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			expect(getRecordsForTask("task1")).toHaveLength(0)
		})

		it("rejects records with non-finite createdAt", () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					task1: [
						{
							taskId: "task1",
							status: "active",
							workspaceRoot: "/ws",
							absolutePath: "/path/to/test_test.cj",
							createdAt: Infinity,
							kind: "cangjie-test",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			expect(getRecordsForTask("task1")).toHaveLength(0)
		})

		it("rejects records with negative createdAt", () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					task1: [
						{
							taskId: "task1",
							status: "active",
							workspaceRoot: "/ws",
							absolutePath: "/path/to/test_test.cj",
							createdAt: -1,
							kind: "cangjie-test",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			expect(getRecordsForTask("task1")).toHaveLength(0)
		})

		it("rejects records where taskId does not match key", () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					task1: [
						{
							taskId: "task2",
							status: "active",
							workspaceRoot: "/ws",
							absolutePath: "/path/to/test_test.cj",
							createdAt: 1000,
							kind: "cangjie-test",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			expect(getRecordsForTask("task1")).toHaveLength(0)
		})

		it("rejects records with empty absolutePath", () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					task1: [
						{
							taskId: "task1",
							status: "active",
							workspaceRoot: "/ws",
							absolutePath: "",
							createdAt: 1000,
							kind: "cangjie-test",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			expect(getRecordsForTask("task1")).toHaveLength(0)
		})
	})

	describe("registerGeneratedCangjieTestFile", () => {
		it("registers file as active with hash", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			const content = "package test\n"
			mockReadFile.mockResolvedValue(Buffer.from(content))
			await registerGeneratedCangjieTestFile(taskId, "/path/to/test_test.cj", "/ws")
			const records = getRecordsForTask(taskId)
			expect(records).toHaveLength(1)
			expect(records[0].status).toBe("active")
			expect(records[0].contentSha256).toBe(makeHash(content))
			expect(records[0].workspaceRoot).toBe("/ws")
			expect(memento.update).toHaveBeenCalled()
		})

		it("registers file with NO_TASK_KEY when task id is undefined", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			await registerGeneratedCangjieTestFile(undefined, "/path/to/test_test.cj")
			const records = getRecordsForTask(NO_TASK_KEY)
			expect(records).toHaveLength(1)
			expect(records[0].status).toBe("active")
		})

		it("normalizes paths", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			await registerGeneratedCangjieTestFile(uniqueTaskId(), "/path/to/../to/test_test.cj")
			expect(memento.update).toHaveBeenCalled()
		})

		it("sets status to detached when hash computation fails", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			mockReadFile.mockRejectedValue(new Error("ENOENT"))
			await registerGeneratedCangjieTestFile(taskId, "/path/to/test_test.cj", "/ws")
			const records = getRecordsForTask(taskId)
			expect(records).toHaveLength(1)
			expect(records[0].status).toBe("detached")
			expect(records[0].contentSha256).toBeUndefined()
		})
	})

	describe("transitionTaskFilesToDetached", () => {
		it("transitions active files to detached without deleting", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(taskId, "/path/to/test_test.cj")
			const count = transitionTaskFilesToDetached(taskId)
			expect(count).toBe(1)
			const records = getRecordsForTask(taskId)
			expect(records[0].status).toBe("detached")
			expect(mockUnlinkSync).not.toHaveBeenCalled()
		})

		it("returns 0 for unknown task", () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			expect(transitionTaskFilesToDetached("nonexistent")).toBe(0)
		})

		it("does not transition already-detached files", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(taskId, "/path/to/test_test.cj")
			transitionTaskFilesToDetached(taskId)
			const count = transitionTaskFilesToDetached(taskId)
			expect(count).toBe(0)
		})
	})

	describe("transitionStaleRegistrationsToDetached", () => {
		it("transitions non-retained tasks to detached", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const task1 = uniqueTaskId()
			const task2 = uniqueTaskId()
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(task1, "/path/to/test_test.cj")
			await registerGeneratedCangjieTestFile(task2, "/path/to/test2_test.cj")
			const result = transitionStaleRegistrationsToDetached((id) => id === task2)
			expect(result.taskEntriesTransitioned).toBe(1)
			expect(getRecordsForTask(task1)[0].status).toBe("detached")
			expect(getRecordsForTask(task2)[0].status).toBe("active")
		})

		it("retains entries where shouldRetainTaskId returns true", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(taskId, "/path/to/test_test.cj")
			const result = transitionStaleRegistrationsToDetached(() => true)
			expect(result.taskEntriesTransitioned).toBe(0)
		})
	})

	describe("scanGeneratedFilesForCleanup", () => {
		it("returns detached and legacy files but not active", async () => {
			const validHash = makeHash("content")
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					legacyTask: [
						{
							taskId: "legacyTask",
							status: "legacy",
							workspaceRoot: "",
							absolutePath: "/path/to/legacy_test.cj",
							createdAt: 0,
							kind: "cangjie-test",
						},
					],
					detachedTask: [
						{
							taskId: "detachedTask",
							status: "detached",
							workspaceRoot: "",
							absolutePath: "/path/to/detached_test.cj",
							contentSha256: validHash,
							createdAt: 1000,
							kind: "cangjie-test",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(uniqueTaskId(), "/path/to/active_test.cj")

			const scan = scanGeneratedFilesForCleanup()
			expect(scan.active.length).toBe(1)
			expect(scan.detached.length).toBe(1)
			expect(scan.legacy.length).toBe(1)
		})

		it("returns empty when nothing tracked", () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const scan = scanGeneratedFilesForCleanup()
			expect(scan.active).toHaveLength(0)
			expect(scan.detached).toHaveLength(0)
			expect(scan.legacy).toHaveLength(0)
		})
	})

	describe("deleteConfirmedCangjieTestFiles", () => {
		it("deletes files with matching hash", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			const content = "test content"
			mockReadFile.mockResolvedValue(Buffer.from(content))
			await registerGeneratedCangjieTestFile(taskId, "/ws/test_test.cj", "/ws")
			const records = getRecordsForTask(taskId)

			mockLstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false, isBlockDevice: () => false, isCharacterDevice: () => false } as any)
			mockRealpath.mockImplementation((p: string) => Promise.resolve(p))
			mockUnlink.mockResolvedValue(undefined)

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.deleted).toContain(path.normalize("/ws/test_test.cj"))
			expect(mockUnlink).toHaveBeenCalled()
		})

		it("skips files with modified hash", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			mockReadFile.mockResolvedValueOnce(Buffer.from("original"))
			await registerGeneratedCangjieTestFile(taskId, "/ws/test_test.cj", "/ws")
			const records = getRecordsForTask(taskId)

			mockLstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false, isBlockDevice: () => false, isCharacterDevice: () => false } as any)
			mockRealpath.mockImplementation((p: string) => Promise.resolve(p))
			mockReadFile.mockResolvedValue(Buffer.from("modified"))

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.skippedModified).toHaveLength(1)
			expect(result.deleted).toHaveLength(0)
			expect(mockUnlink).not.toHaveBeenCalled()
		})

		it("skips non-_test.cj files", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(taskId, "/path/to/regular.cj")
			const records = getRecordsForTask(taskId)

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.skippedModified).toContain(path.normalize("/path/to/regular.cj"))
		})

		it("skips legacy files without allowLegacy", async () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: { task1: ["/path/to/legacy_test.cj"] },
			})
			initTestCleanup(memento as any)
			const records = getRecordsForTask("task1")

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.skippedLegacyNotConfirmed).toHaveLength(1)
		})

		it("denies legacy files even with allowLegacy when workspaceRoot is empty", async () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: { task1: ["/path/to/legacy_test.cj"] },
			})
			initTestCleanup(memento as any)
			const records = getRecordsForTask("task1")

			const result = await deleteConfirmedCangjieTestFiles(records, { allowLegacy: true })
			expect(result.deleted).toHaveLength(0)
			expect(result.skippedOutsideWorkspace).toHaveLength(1)
		})

		it("skips symlinks", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(taskId, "/ws/test_test.cj", "/ws")
			const records = getRecordsForTask(taskId)

			mockLstat.mockResolvedValue({
				isFile: () => false,
				isSymbolicLink: () => true,
				isFIFO: () => false,
				isSocket: () => false,
				isBlockDevice: () => false,
				isCharacterDevice: () => false,
			} as any)

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.skippedModified).toHaveLength(1)
			expect(mockUnlink).not.toHaveBeenCalled()
		})

		it("skips FIFO files", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(taskId, "/ws/test_test.cj", "/ws")
			const records = getRecordsForTask(taskId)

			mockLstat.mockResolvedValue({
				isFile: () => false,
				isSymbolicLink: () => false,
				isFIFO: () => true,
				isSocket: () => false,
				isBlockDevice: () => false,
				isCharacterDevice: () => false,
			} as any)

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.skippedModified).toHaveLength(1)
			expect(mockUnlink).not.toHaveBeenCalled()
		})

		it("skips files outside workspace", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(taskId, "/ws/test_test.cj", "/ws")
			const records = getRecordsForTask(taskId)

			mockLstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false, isBlockDevice: () => false, isCharacterDevice: () => false } as any)
			mockRealpath.mockImplementation((p: string) => {
				if (p === "/ws") return Promise.resolve("/ws")
				return Promise.resolve("/etc/passwd")
			})

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.skippedOutsideWorkspace).toHaveLength(1)
		})

		it("denies deletion when workspaceRoot is empty (fail-closed)", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			const _validHash = makeHash("content")
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(taskId, "/path/to/test_test.cj")
			const records = getRecordsForTask(taskId)
			expect(records[0].workspaceRoot).toBe("")

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.deleted).toHaveLength(0)
			expect(result.skippedOutsideWorkspace).toHaveLength(1)
			expect(mockUnlink).not.toHaveBeenCalled()
		})

		it("denies deletion when record has no contentSha256", async () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					task1: [
						{
							taskId: "task1",
							status: "detached",
							workspaceRoot: "/ws",
							absolutePath: "/ws/test_test.cj",
							createdAt: 1000,
							kind: "cangjie-test",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			const records = getRecordsForTask("task1")

			mockLstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false, isBlockDevice: () => false, isCharacterDevice: () => false } as any)
			mockRealpath.mockImplementation((p: string) => Promise.resolve(p))

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.deleted).toHaveLength(0)
			expect(result.skippedInvalid).toHaveLength(1)
			expect(mockUnlink).not.toHaveBeenCalled()
		})

		it("handles file not existing (lstat throws)", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			mockReadFile.mockResolvedValue(Buffer.from("content"))
			await registerGeneratedCangjieTestFile(taskId, "/ws/test_test.cj", "/ws")
			const records = getRecordsForTask(taskId)

			mockLstat.mockRejectedValue(new Error("ENOENT"))

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.deleted).toHaveLength(0)
			expect(result.skippedInvalid).toHaveLength(1)
		})

		it("persists deleted status after deletion", async () => {
			const memento = createMockMemento()
			initTestCleanup(memento as any)
			const taskId = uniqueTaskId()
			const content = "test content"
			mockReadFile.mockResolvedValue(Buffer.from(content))
			await registerGeneratedCangjieTestFile(taskId, "/ws/test_test.cj", "/ws")
			const records = getRecordsForTask(taskId)

			mockLstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false, isBlockDevice: () => false, isCharacterDevice: () => false } as any)
			mockRealpath.mockImplementation((p: string) => Promise.resolve(p))
			mockUnlink.mockResolvedValue(undefined)

			await deleteConfirmedCangjieTestFiles(records)

			const persistedCalls = (memento.update as ReturnType<typeof vi.fn>).mock.calls.filter(
				(c: unknown[]) => c[0] === WORKSPACE_STATE_KEY,
			)
			expect(persistedCalls.length).toBeGreaterThan(0)
			const lastCall = persistedCalls[persistedCalls.length - 1]!
			const persisted = lastCall[1] as Record<string, unknown[]>
			expect(persisted[taskId]).toBeUndefined()
		})

		it("rejects fabricated detached record with tampered hash", async () => {
			const memento = createMockMemento({
				[WORKSPACE_STATE_KEY]: {
					task1: [
						{
							taskId: "task1",
							status: "detached",
							workspaceRoot: "/ws",
							absolutePath: "/ws/test_test.cj",
							contentSha256: "a".repeat(64),
							createdAt: 1000,
							kind: "cangjie-test",
						},
					],
				},
			})
			initTestCleanup(memento as any)
			const records = getRecordsForTask("task1")

			mockLstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false, isBlockDevice: () => false, isCharacterDevice: () => false } as any)
			mockRealpath.mockImplementation((p: string) => Promise.resolve(p))
			mockReadFile.mockResolvedValue(Buffer.from("different content"))

			const result = await deleteConfirmedCangjieTestFiles(records)
			expect(result.deleted).toHaveLength(0)
			expect(result.skippedModified).toHaveLength(1)
			expect(mockUnlink).not.toHaveBeenCalled()
		})
	})
})

// ─── reassociateLegacyFiles ──────────────────────────────────────────────

describe("reassociateLegacyFiles", () => {
	beforeEach(() => {
		const memento = createMockMemento()
		initTestCleanup(memento as any)
	})

	it("re-associates legacy files within a workspace root", () => {
		const memento = createMockMemento({
			[WORKSPACE_STATE_KEY]: {
				task1: [
					{
						taskId: "task1",
						status: "legacy",
						workspaceRoot: "",
						absolutePath: "/workspace/src/foo_test.cj",
						createdAt: 0,
						kind: "cangjie-test",
					},
				],
			},
		})
		initTestCleanup(memento as any)

		const result = reassociateLegacyFiles(["/workspace"])
		expect(result.reassociated).toBe(1)
		expect(result.outsideWorkspace).toBe(0)

		const records = getRecordsForTask("task1")
		expect(records[0].workspaceRoot).toBe(path.normalize("/workspace"))
	})

	it("leaves non-workspace legacy files unchanged", () => {
		const memento = createMockMemento({
			[WORKSPACE_STATE_KEY]: {
				task1: [
					{
						taskId: "task1",
						status: "legacy",
						workspaceRoot: "",
						absolutePath: "/other/path/foo_test.cj",
						createdAt: 0,
						kind: "cangjie-test",
					},
				],
			},
		})
		initTestCleanup(memento as any)

		const result = reassociateLegacyFiles(["/workspace"])
		expect(result.reassociated).toBe(0)
		expect(result.outsideWorkspace).toBe(1)

		const records = getRecordsForTask("task1")
		expect(records[0].workspaceRoot).toBe("")
	})

	it("ignores empty workspace roots", () => {
		const memento = createMockMemento({
			[WORKSPACE_STATE_KEY]: {
				task1: [
					{
						taskId: "task1",
						status: "legacy",
						workspaceRoot: "",
						absolutePath: "/workspace/src/foo_test.cj",
						createdAt: 0,
						kind: "cangjie-test",
					},
				],
			},
		})
		initTestCleanup(memento as any)

		const result = reassociateLegacyFiles(["", "/workspace"])
		expect(result.reassociated).toBe(1)
		expect(result.outsideWorkspace).toBe(0)
	})

	it("does not modify non-legacy records", () => {
		const memento = createMockMemento({
			[WORKSPACE_STATE_KEY]: {
				task1: [
					{
						taskId: "task1",
						status: "detached",
						workspaceRoot: "/old-root",
						absolutePath: "/workspace/src/foo_test.cj",
						contentSha256: "a".repeat(64),
						createdAt: 100,
						kind: "cangjie-test",
					},
				],
			},
		})
		initTestCleanup(memento as any)

		const result = reassociateLegacyFiles(["/workspace"])
		expect(result.reassociated).toBe(0)
		expect(result.outsideWorkspace).toBe(0)

		const records = getRecordsForTask("task1")
		expect(records[0].workspaceRoot).toBe("/old-root")
	})

	it("handles multiple workspace roots — picks first match", () => {
		const memento = createMockMemento({
			[WORKSPACE_STATE_KEY]: {
				task1: [
					{
						taskId: "task1",
						status: "legacy",
						workspaceRoot: "",
						absolutePath: "/project-b/src/foo_test.cj",
						createdAt: 0,
						kind: "cangjie-test",
					},
				],
			},
		})
		initTestCleanup(memento as any)

		const result = reassociateLegacyFiles(["/project-a", "/project-b"])
		expect(result.reassociated).toBe(1)

		const records = getRecordsForTask("task1")
		expect(records[0].workspaceRoot).toBe(path.normalize("/project-b"))
	})
})

// ─── deleteConfirmedCangjieTestFiles with re-associated legacy ────────────

describe("deleteConfirmedCangjieTestFiles — legacy with allowLegacy and workspace", () => {
	beforeEach(() => {
		const memento = createMockMemento()
		initTestCleanup(memento as any)
		mockUnlink.mockClear()
		mockLstat.mockClear()
		mockRealpath.mockClear()
		mockReadFile.mockClear()
	})

	it("deletes re-associated legacy file without hash when allowLegacy and workspaceRoot is set", async () => {
		const memento = createMockMemento({
			[WORKSPACE_STATE_KEY]: {
				task1: [
					{
						taskId: "task1",
						status: "legacy",
						workspaceRoot: "/workspace",
						absolutePath: "/workspace/src/foo_test.cj",
						createdAt: 0,
						kind: "cangjie-test",
					},
				],
			},
		})
		initTestCleanup(memento as any)

		mockLstat.mockResolvedValue({ isFile: () => true, isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false, isBlockDevice: () => false, isCharacterDevice: () => false })
		mockRealpath.mockResolvedValue("/workspace/src/foo_test.cj")
		mockUnlink.mockResolvedValue(undefined)

		const records = getRecordsForTask("task1")
		const result = await deleteConfirmedCangjieTestFiles(records, { allowLegacy: true })

		expect(result.deleted).toHaveLength(1)
		expect(result.skippedInvalid).toHaveLength(0)
		expect(mockUnlink).toHaveBeenCalled()
	})

	it("still skips non-re-associated legacy (empty workspaceRoot) even with allowLegacy", async () => {
		const memento = createMockMemento({
			[WORKSPACE_STATE_KEY]: {
				task1: [
					{
						taskId: "task1",
						status: "legacy",
						workspaceRoot: "",
						absolutePath: "/outside/foo_test.cj",
						createdAt: 0,
						kind: "cangjie-test",
					},
				],
			},
		})
		initTestCleanup(memento as any)

		const records = getRecordsForTask("task1")
		const result = await deleteConfirmedCangjieTestFiles(records, { allowLegacy: true })

		expect(result.deleted).toHaveLength(0)
		expect(result.skippedOutsideWorkspace).toHaveLength(1)
		expect(mockUnlink).not.toHaveBeenCalled()
	})
})
