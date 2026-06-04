import { describe, it, expect, vi } from "vitest"
import { MemoryEmbeddingAdapter } from "../MemoryEmbeddingAdapter"
import type { IEmbedder } from "../../../code-index/interfaces/embedder"

function makeEmbedder(embeddings: number[][]): IEmbedder {
	return {
		createEmbeddings: vi.fn().mockResolvedValue({ embeddings }),
		validateConfiguration: vi.fn().mockResolvedValue({ valid: true }),
		get embedderInfo() {
			return { name: "openai" as const }
		},
	}
}

describe("MemoryEmbeddingAdapter", () => {
	describe("cosineSim", () => {
		it("returns 1 for identical vectors", () => {
			const v = [1, 0, 0]
			expect(MemoryEmbeddingAdapter.cosineSim(v, v)).toBeCloseTo(1)
		})

		it("returns 0 for orthogonal vectors", () => {
			expect(MemoryEmbeddingAdapter.cosineSim([1, 0], [0, 1])).toBeCloseTo(0)
		})

		it("returns -1 for opposite vectors", () => {
			expect(MemoryEmbeddingAdapter.cosineSim([1, 0], [-1, 0])).toBeCloseTo(-1)
		})

		it("returns 0 for empty vectors", () => {
			expect(MemoryEmbeddingAdapter.cosineSim([], [])).toBe(0)
		})

		it("returns 0 for mismatched lengths", () => {
			expect(MemoryEmbeddingAdapter.cosineSim([1, 2], [1])).toBe(0)
		})

		it("returns 0 for zero vector", () => {
			expect(MemoryEmbeddingAdapter.cosineSim([0, 0], [1, 1])).toBe(0)
		})
	})

	describe("zScore", () => {
		it("returns all zeros for constant array", () => {
			const result = MemoryEmbeddingAdapter.zScore([5, 5, 5])
			result.forEach((v) => expect(v).toBe(0))
		})

		it("returns empty array for empty input", () => {
			expect(MemoryEmbeddingAdapter.zScore([])).toEqual([])
		})

		it("normalizes a simple array", () => {
			const result = MemoryEmbeddingAdapter.zScore([1, 2, 3])
			// mean=2, std≈0.816; z-scores: [-1.22, 0, 1.22]
			expect(result[1]).toBeCloseTo(0)
			expect(result[2]).toBeGreaterThan(0)
			expect(result[0]).toBeLessThan(0)
		})

		it("preserves array length", () => {
			const input = [10, 20, 30, 40]
			expect(MemoryEmbeddingAdapter.zScore(input)).toHaveLength(4)
		})
	})

	describe("embed", () => {
		it("returns embeddings from the underlying embedder", async () => {
			const vec = [0.1, 0.2, 0.3]
			const adapter = new MemoryEmbeddingAdapter(makeEmbedder([vec]))
			const result = await adapter.embed("test text")
			expect(result).toEqual(vec)
		})

		it("returns empty array on embedder error", async () => {
			const failingEmbedder: IEmbedder = {
				createEmbeddings: vi.fn().mockRejectedValue(new Error("network error")),
				validateConfiguration: vi.fn().mockResolvedValue({ valid: false }),
				get embedderInfo() {
					return { name: "openai" as const }
				},
			}
			const adapter = new MemoryEmbeddingAdapter(failingEmbedder)
			const result = await adapter.embed("test")
			expect(result).toEqual([])
		})

		it("returns empty array when embedding is undefined", async () => {
			const adapter = new MemoryEmbeddingAdapter(makeEmbedder([]))
			const result = await adapter.embed("test")
			expect(result).toEqual([])
		})
	})

	describe("embedBatch", () => {
		it("returns empty array for empty input", async () => {
			const adapter = new MemoryEmbeddingAdapter(makeEmbedder([]))
			expect(await adapter.embedBatch([])).toEqual([])
		})

		it("returns batch of embeddings", async () => {
			const vecs = [
				[0.1, 0.2],
				[0.3, 0.4],
			]
			const adapter = new MemoryEmbeddingAdapter(makeEmbedder(vecs))
			const result = await adapter.embedBatch(["a", "b"])
			expect(result).toEqual(vecs)
		})

		it("returns empty arrays on error", async () => {
			const failingEmbedder: IEmbedder = {
				createEmbeddings: vi.fn().mockRejectedValue(new Error("fail")),
				validateConfiguration: vi.fn().mockResolvedValue({ valid: false }),
				get embedderInfo() {
					return { name: "openai" as const }
				},
			}
			const adapter = new MemoryEmbeddingAdapter(failingEmbedder)
			const result = await adapter.embedBatch(["a", "b"])
			expect(result).toEqual([[], []])
		})
	})
})
