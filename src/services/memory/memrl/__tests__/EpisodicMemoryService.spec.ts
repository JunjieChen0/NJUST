import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"
import { EpisodicMemoryService } from "../EpisodicMemoryService"
import { MemoryEmbeddingAdapter } from "../MemoryEmbeddingAdapter"
import type { IEmbedder } from "../../../code-index/interfaces/embedder"
import { ALPHA, Q_INIT } from "../constants"
import { safeWriteJson } from "../../../../utils/safeWriteJson"

// Mock safeWriteJson to avoid real file I/O in most tests
vi.mock("../../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (file: string, data: unknown) => {
		await fs.mkdir(path.dirname(file), { recursive: true })
		await fs.writeFile(file, JSON.stringify(data), "utf8")
	}),
}))

function makeVec(seed: number): number[] {
	// Deterministic "embedding": unit vector in direction [seed, 1-seed]
	const x = seed
	const y = Math.sqrt(1 - x * x)
	return [x, y]
}

function makeEmbedder(vecFn: (text: string) => number[]): MemoryEmbeddingAdapter {
	const embedder: IEmbedder = {
		createEmbeddings: vi.fn().mockImplementation(async (texts: string[]) => ({
			embeddings: texts.map(vecFn),
		})),
		validateConfiguration: vi.fn().mockResolvedValue({ valid: true }),
		get embedderInfo() {
			return { name: "openai" as const }
		},
	}
	return new MemoryEmbeddingAdapter(embedder)
}

describe("EpisodicMemoryService", () => {
	let tmpDir: string
	let service: EpisodicMemoryService
	let distillCalled: boolean

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memrl-test-"))
		distillCalled = false
		// Use a fixed vec for all texts so retrieval is deterministic
		const adapter = makeEmbedder(() => makeVec(0.6))
		service = new EpisodicMemoryService(tmpDir, adapter, () => {
			distillCalled = true
		})
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true })
	})

	it("starts with empty store", async () => {
		const results = await service.retrieve("anything")
		expect(results).toHaveLength(0)
	})

	it("write stores an entry and increments totalWrites", async () => {
		await service.write("fix bug", "user: fix\nassistant: fixed", {
			taskId: "task-1",
			overall: "verified",
			acceptance: "pending",
		})
		expect(service.totalWrites).toBe(1)
	})

	it("Q-value update follows Monte Carlo rule", async () => {
		await service.write("fix bug", "summary", { taskId: "task-1", overall: "verified", acceptance: "pending" })
		const expectedQ = Q_INIT + ALPHA * (1.0 - Q_INIT)
		// retrieve to get the entry back
		const entries = await service.retrieve("fix bug")
		expect(entries[0].qValue).toBeCloseTo(expectedQ, 5)
	})

	it("retrieve returns relevant entry above threshold", async () => {
		await service.write("fix bug in auth", "summary", {
			taskId: "task-1",
			overall: "verified",
			acceptance: "pending",
		})
		const results = await service.retrieve("fix auth bug")
		// Cosine sim of identical vecs = 1.0 > SIM_THRESHOLD
		expect(results.length).toBeGreaterThan(0)
	})

	it("retrieve returns empty when sim < threshold", async () => {
		// Use orthogonal vectors
		const adapterHigh = makeEmbedder((text) => (text === "query" ? [1, 0] : [0, 1]))
		const svc = new EpisodicMemoryService(path.join(tmpDir, "orthogonal"), adapterHigh)
		await svc.write("intent", "summary", { taskId: "task-1", overall: "verified", acceptance: "pending" })
		const results = await svc.retrieve("query")
		expect(results).toHaveLength(0)
	})

	it("triggers distillation callback every LTM_DISTILL_INTERVAL writes", async () => {
		// LTM_DISTILL_INTERVAL = 10
		for (let i = 0; i < 9; i++) {
			await service.write(`intent ${i}`, "s", { taskId: `task-${i}`, overall: "verified", acceptance: "pending" })
		}
		expect(distillCalled).toBe(false)
		await service.write("intent 10", "s", { taskId: "task-10", overall: "verified", acceptance: "pending" })
		expect(distillCalled).toBe(true)
	})

	it("getRecent returns most recent n entries", async () => {
		for (let i = 0; i < 5; i++) {
			await service.write(`intent ${i}`, "s", { taskId: `task-${i}`, overall: "verified", acceptance: "pending" })
		}
		const recent = service.getRecent(3)
		expect(recent).toHaveLength(3)
	})

	it.each(["verified", "failed", "incomplete", "no_record"] as const)(
		"derives Q and trust tags from %s facts",
		async (overall) => {
			await service.write("intent", "summary", { taskId: "task", overall, acceptance: "accepted" })
			const store = vi
				.mocked(safeWriteJson)
				.mock.calls.at(-1)?.[1] as import("../EpisodicMemoryService").EpisodicStore
			const known = overall === "verified" || overall === "failed"
			expect(store.entries[0].qValue).toBeCloseTo(
				known ? Q_INIT + ALPHA * ((overall === "verified" ? 1 : 0) - Q_INIT) : Q_INIT,
			)
			expect(store.entries[0].tags?.includes("verification_unknown")).toBe(!known)
			expect((await service.retrieve("intent")).length).toBe(known ? 1 : 0)
			expect(service.getRecent(10).length).toBe(known ? 1 : 0)
		},
	)

	it("deduplicates concurrent completion and acceptance updates without compounding Q", async () => {
		await Promise.all([
			service.write("intent", "first", { taskId: "task", overall: "verified", acceptance: "pending" }),
			service.write("intent", "accepted", { taskId: "task", overall: "verified", acceptance: "accepted" }),
		])
		expect(service.totalWrites).toBe(1)
		const entries = await service.retrieve("intent")
		expect(entries).toHaveLength(1)
		expect(entries[0].stmSummary).toBe("accepted")
		expect(entries[0].verification?.acceptance).toBe("accepted")
		expect(entries[0].qValue).toBeCloseTo(Q_INIT + ALPHA * (1 - Q_INIT))
	})

	it("updates the same task after reloading history without adding a new write", async () => {
		await service.write("intent", "first", { taskId: "task", overall: "incomplete", acceptance: "pending" })
		const restored = new EpisodicMemoryService(
			tmpDir,
			makeEmbedder(() => makeVec(0.6)),
		)
		await restored.write("intent", "now verified", { taskId: "task", overall: "verified", acceptance: "accepted" })
		expect(restored.totalWrites).toBe(1)
		expect((await restored.retrieve("intent"))[0].tags).not.toContain("verification_unknown")
	})

	it("does not retrigger distillation when a task already at the threshold is updated", async () => {
		const distill = vi.fn()
		const svc = new EpisodicMemoryService(
			tmpDir,
			makeEmbedder(() => makeVec(0.6)),
			distill,
		)
		for (let i = 0; i < 10; i++)
			await svc.write("intent", "summary", { taskId: `task-${i}`, overall: "verified", acceptance: "pending" })
		expect(distill).toHaveBeenCalledOnce()
		await svc.write("intent", "accepted", { taskId: "task-9", overall: "verified", acceptance: "accepted" })
		expect(distill).toHaveBeenCalledOnce()
		expect(svc.totalWrites).toBe(10)
	})

	it("retains old entries on disk while excluding them from hints and distillation", async () => {
		await service.write("intent", "old successful claim", {
			taskId: "task",
			overall: "verified",
			acceptance: "pending",
		})
		const file = path.join(tmpDir, ".njust_ai/memories/episodic.json")
		const data = JSON.parse(await fs.readFile(file, "utf8"))
		delete data.entries[0].verification
		await fs.writeFile(file, JSON.stringify(data))
		const restored = new EpisodicMemoryService(
			tmpDir,
			makeEmbedder(() => makeVec(0.6)),
		)
		await expect(restored.retrieve("intent")).resolves.toEqual([])
		expect(restored.getRecent(10)).toEqual([])
		expect(JSON.parse(await fs.readFile(file, "utf8")).entries).toHaveLength(1)
	})
})
