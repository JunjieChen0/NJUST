import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "fs/promises"
import { MemoryManager } from "../MemoryManager"
import type { IEmbedder } from "../../../code-index/interfaces/embedder"

vi.mock("fs/promises")

const mockFs = vi.mocked(fs)

function makeEmbedder(): IEmbedder {
	return {
		createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.1, 0.2, 0.3]] }),
		validateConfiguration: vi.fn().mockResolvedValue({ valid: true }),
		get embedderInfo() {
			return { name: "openai" as const }
		},
	}
}

function makeApi() {
	return {
		createMessage: vi.fn().mockReturnValue((async function* () {})()),
	} as any
}

describe("MemoryManager", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockFs.readFile = vi.fn().mockRejectedValue({ code: "ENOENT" })
		mockFs.mkdir = vi.fn().mockResolvedValue(undefined)
		mockFs.writeFile = vi.fn().mockResolvedValue(undefined)
	})

	it("workspaceDir is stored correctly", () => {
		const mgr = new MemoryManager("/workspace")
		expect(mgr.workspaceDir).toBe("/workspace")
	})

	describe("beforeRun()", () => {
		it("returns empty hints when no dependencies initialized", async () => {
			const mgr = new MemoryManager("/ws")
			const result = await mgr.beforeRun("task-1", "fix a bug")
			expect(result.episodicHints).toBe("")
			expect(result.ltmRules).toBe("")
		})

		it("clears STM for taskId", async () => {
			const mgr = new MemoryManager("/ws")
			mgr.getStm("task-1").push("user", "old data")
			mgr.updateDependencies(makeApi(), makeEmbedder())
			await mgr.beforeRun("task-1", "new task")
			expect(mgr.getStm("task-1").getEntries()).toHaveLength(0)
		})

		it("returns empty hints when episodic store is empty", async () => {
			const mgr = new MemoryManager("/ws")
			mgr.updateDependencies(makeApi(), makeEmbedder())
			const result = await mgr.beforeRun("task-1", "do something")
			expect(result.episodicHints).toBe("")
			expect(result.ltmRules).toBe("")
		})
	})

	describe("afterRun()", () => {
		it("writes episode to disk", async () => {
			const mgr = new MemoryManager("/ws")
			mgr.updateDependencies(makeApi(), makeEmbedder())
			mgr.afterRun("task-1", "fix bug", "assistant called tools", 1.0)
			// Allow async write to start
			await new Promise((r) => setTimeout(r, 10))
			expect(mockFs.writeFile).toHaveBeenCalled()
		})

		it("does not throw when episodic is not initialized", () => {
			const mgr = new MemoryManager("/ws")
			expect(() => mgr.afterRun("task-1", "intent", "summary", 1.0)).not.toThrow()
		})
	})

	describe("getStm()", () => {
		it("returns STM for a given taskId", () => {
			const mgr = new MemoryManager("/ws")
			const stm = mgr.getStm("task-1")
			expect(stm).toBeDefined()
			stm.push("user", "hello")
			expect(mgr.getStm("task-1").getEntries()).toHaveLength(1)
		})
	})

	describe("updateDependencies()", () => {
		it("uses noop embedder when none provided", async () => {
			const mgr = new MemoryManager("/ws")
			mgr.updateDependencies(makeApi())
			// Should not throw, noop embedder returns []
			const result = await mgr.beforeRun("task-1", "test")
			expect(result.episodicHints).toBe("")
		})

		it("accepts a real embedder", () => {
			const mgr = new MemoryManager("/ws")
			expect(() => mgr.updateDependencies(makeApi(), makeEmbedder())).not.toThrow()
		})
	})
})
