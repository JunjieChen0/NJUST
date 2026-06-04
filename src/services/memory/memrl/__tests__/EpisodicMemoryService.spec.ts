import { describe, it, expect, vi, beforeEach } from "vitest"
import * as fs from "fs/promises"
import { EpisodicMemoryService } from "../EpisodicMemoryService"
import { MemoryEmbeddingAdapter } from "../MemoryEmbeddingAdapter"

vi.mock("fs/promises")

const mockFs = vi.mocked(fs)

function makeAdapter(vec: number[] = [0.1, 0.2, 0.3]): MemoryEmbeddingAdapter {
	return {
		embed: vi.fn().mockResolvedValue(vec),
		embedBatch: vi.fn().mockResolvedValue([vec]),
	} as unknown as MemoryEmbeddingAdapter
}

describe("EpisodicMemoryService", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockFs.mkdir = vi.fn().mockResolvedValue(undefined)
		mockFs.writeFile = vi.fn().mockResolvedValue(undefined)
	})

	describe("load()", () => {
		it("initializes empty store when file does not exist", async () => {
			mockFs.readFile = vi.fn().mockRejectedValue({ code: "ENOENT" })
			const svc = new EpisodicMemoryService("/ws", makeAdapter())
			await svc.load()
			expect(svc.totalWrites).toBe(0)
		})

		it("reads existing store from disk", async () => {
			const stored = {
				entries: [
					{
						id: "ep_1",
						intent: "test",
						embedding: [],
						stmSummary: "",
						qValue: 0.5,
						updateCount: 1,
						createdAt: 1,
						updatedAt: 1,
					},
				],
				totalWrites: 1,
			}
			mockFs.readFile = vi.fn().mockResolvedValue(JSON.stringify(stored))
			const svc = new EpisodicMemoryService("/ws", makeAdapter())
			await svc.load()
			expect(svc.totalWrites).toBe(1)
		})

		it("calls load only once (idempotent)", async () => {
			mockFs.readFile = vi.fn().mockResolvedValue(JSON.stringify({ entries: [], totalWrites: 0 }))
			const svc = new EpisodicMemoryService("/ws", makeAdapter())
			await svc.load()
			await svc.load()
			expect(mockFs.readFile).toHaveBeenCalledTimes(1)
		})
	})

	describe("write()", () => {
		it("writes entry and increments totalWrites", async () => {
			mockFs.readFile = vi.fn().mockRejectedValue({ code: "ENOENT" })
			const svc = new EpisodicMemoryService("/ws", makeAdapter())
			await svc.write("fix a bug", "assistant called tools", 1.0)
			expect(svc.totalWrites).toBe(1)
			expect(mockFs.writeFile).toHaveBeenCalled()
		})

		it("appends to existing entries", async () => {
			const stored = {
				entries: [
					{
						id: "ep_0",
						intent: "old",
						embedding: [0.1],
						stmSummary: "",
						qValue: 0.5,
						updateCount: 1,
						createdAt: 1,
						updatedAt: 1,
					},
				],
				totalWrites: 1,
			}
			mockFs.readFile = vi.fn().mockResolvedValue(JSON.stringify(stored))
			const svc = new EpisodicMemoryService("/ws", makeAdapter())
			await svc.write("new task", "new summary", 0.8)
			expect(svc.totalWrites).toBe(2)
			const written = JSON.parse((mockFs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string)
			expect(written.entries).toHaveLength(2)
		})

		it("fires onDistillTrigger every LTM_DISTILL_INTERVAL writes", async () => {
			mockFs.readFile = vi.fn().mockRejectedValue({ code: "ENOENT" })
			const trigger = vi.fn()
			const svc = new EpisodicMemoryService("/ws", makeAdapter(), trigger)
			// Write 10 times (LTM_DISTILL_INTERVAL default = 10)
			for (let i = 0; i < 10; i++) {
				await svc.write(`intent ${i}`, "summary", 1.0)
			}
			expect(trigger).toHaveBeenCalledTimes(1)
		})

		it("stores correct qValue from reward", async () => {
			mockFs.readFile = vi.fn().mockRejectedValue({ code: "ENOENT" })
			const svc = new EpisodicMemoryService("/ws", makeAdapter())
			await svc.write("task", "summary", 1.0)
			const written = JSON.parse((mockFs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string)
			const entry = written.entries[0]
			// Q_INIT=0.5, ALPHA=0.1: 0.5 + 0.1*(1.0-0.5) = 0.55
			expect(entry.qValue).toBeCloseTo(0.55)
		})
	})

	describe("retrieve()", () => {
		it("returns empty array when store is empty", async () => {
			mockFs.readFile = vi.fn().mockRejectedValue({ code: "ENOENT" })
			const svc = new EpisodicMemoryService("/ws", makeAdapter())
			const results = await svc.retrieve("query")
			expect(results).toEqual([])
		})

		it("returns empty array when embedding is empty (no embedder)", async () => {
			const stored = {
				entries: [
					{
						id: "ep_1",
						intent: "test",
						embedding: [0.1, 0.2],
						stmSummary: "",
						qValue: 0.5,
						updateCount: 1,
						createdAt: 1,
						updatedAt: 1,
					},
				],
				totalWrites: 1,
			}
			mockFs.readFile = vi.fn().mockResolvedValue(JSON.stringify(stored))
			const noopAdapter = { embed: vi.fn().mockResolvedValue([]) } as unknown as MemoryEmbeddingAdapter
			const svc = new EpisodicMemoryService("/ws", noopAdapter)
			const results = await svc.retrieve("query")
			expect(results).toEqual([])
		})

		it("returns matching entries above similarity threshold", async () => {
			const vec = [1, 0, 0]
			const stored = {
				entries: [
					{
						id: "ep_1",
						intent: "relevant",
						embedding: [1, 0, 0],
						stmSummary: "s",
						qValue: 0.8,
						updateCount: 1,
						createdAt: 1,
						updatedAt: 1,
					},
					{
						id: "ep_2",
						intent: "unrelated",
						embedding: [0, 1, 0],
						stmSummary: "u",
						qValue: 0.5,
						updateCount: 1,
						createdAt: 2,
						updatedAt: 2,
					},
				],
				totalWrites: 2,
			}
			mockFs.readFile = vi.fn().mockResolvedValue(JSON.stringify(stored))
			const adapter = { embed: vi.fn().mockResolvedValue(vec) } as unknown as MemoryEmbeddingAdapter
			const svc = new EpisodicMemoryService("/ws", adapter)
			const results = await svc.retrieve("query")
			// Only ep_1 should match (cosine sim = 1.0 >= 0.5 threshold)
			expect(results.length).toBeGreaterThan(0)
			expect(results[0]!.id).toBe("ep_1")
		})
	})

	describe("getRecent()", () => {
		it("returns n most recent entries by createdAt", async () => {
			const stored = {
				entries: [
					{
						id: "ep_1",
						intent: "old",
						embedding: [],
						stmSummary: "",
						qValue: 0.5,
						updateCount: 1,
						createdAt: 100,
						updatedAt: 100,
					},
					{
						id: "ep_2",
						intent: "new",
						embedding: [],
						stmSummary: "",
						qValue: 0.5,
						updateCount: 1,
						createdAt: 200,
						updatedAt: 200,
					},
				],
				totalWrites: 2,
			}
			mockFs.readFile = vi.fn().mockResolvedValue(JSON.stringify(stored))
			const svc = new EpisodicMemoryService("/ws", makeAdapter())
			await svc.load()
			const recent = svc.getRecent(1)
			expect(recent).toHaveLength(1)
			expect(recent[0]!.id).toBe("ep_2")
		})
	})
})
