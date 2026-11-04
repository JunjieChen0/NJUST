/**
 * Integration test: beforeRun → prompt hints → afterRun → Q update flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import os from "os"
import path from "path"
import * as fs from "fs/promises"
import { MemoryManager } from "../MemoryManager"
import { EpisodicMemoryService } from "../EpisodicMemoryService"
import type { IEmbedder } from "../../../code-index/interfaces/embedder"
import type { ApiHandler } from "../../../../api"
import { asMock } from "../../../../__tests__/helpers/asMock"

vi.mock("../../../../utils/safeWriteJson", () => ({
	safeWriteJson: vi.fn(async (file: string, data: unknown) => {
		await fs.mkdir(path.dirname(file), { recursive: true })
		await fs.writeFile(file, JSON.stringify(data), "utf8")
	}),
}))

function makeEmbedder(): IEmbedder {
	return {
		createEmbeddings: vi.fn().mockResolvedValue({ embeddings: [[0.6, 0.8]] }),
		validateConfiguration: vi.fn().mockResolvedValue({ valid: true }),
		get embedderInfo() {
			return { name: "openai" as const }
		},
	}
}

function makeApi(): ApiHandler {
	return asMock<ApiHandler>({
		createMessage: vi.fn().mockReturnValue((async function* () {})()),
		getModel: vi.fn().mockReturnValue({ id: "gpt-4o", info: {} }),
	})
}

describe("MemoryManager integration", () => {
	it("initializes a cold history manager once before updating acceptance", async () => {
		const cold = new MemoryManager(tmpDir)
		const initialize = vi.spyOn(cold, "updateDependencies")
		const update = vi.spyOn(EpisodicMemoryService.prototype, "updateAcceptance").mockResolvedValue(undefined)
		try {
			cold.ensureReady(makeApi())
			cold.ensureReady(makeApi())
			await cold.updateAcceptance("history", "accepted")
			expect(initialize).toHaveBeenCalledOnce()
			expect(update).toHaveBeenCalledWith("history", "accepted")
		} finally {
			update.mockRestore()
		}
	})
	let mgr: MemoryManager
	let tmpDir: string

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "memrl-mgr-"))
		mgr = new MemoryManager(tmpDir)
		mgr.updateDependencies(makeApi(), makeEmbedder())
	})

	afterEach(async () => {
		await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
	})

	it("beforeRun returns empty strings on cold start", async () => {
		const result = await mgr.beforeRun("task-1", "build the feature")
		expect(result.episodicHints).toBe("")
		expect(result.ltmRules).toBe("")
	})

	it("afterRun persists system facts without throwing", async () => {
		await expect(
			mgr.afterRun("task-1", "build the feature", "summary text", { overall: "verified", acceptance: "pending" }),
		).resolves.toBeUndefined()
	})

	it("getStm returns a ShortTermMemory", () => {
		const stm = mgr.getStm("task-1")
		expect(stm).toBeDefined()
		stm.push("user", "hello")
		expect(stm.getEntries()).toHaveLength(1)
	})

	it("returns empty results if updateDependencies was not called", async () => {
		const freshDir = path.join(os.tmpdir(), `memrl-fresh-${Date.now()}`)
		const fresh = new MemoryManager(freshDir)
		const result = await fresh.beforeRun("task-x", "intent")
		expect(result.episodicHints).toBe("")
		expect(result.ltmRules).toBe("")
	})

	it("full flow: write then retrieve produces formatted hints", async () => {
		// Write a high-reward episode
		await mgr.afterRun("task-1", "implement login feature", "user: implement\nassistant: done", {
			overall: "verified",
			acceptance: "pending",
		})
		// Now retrieve
		const result = await mgr.beforeRun("task-2", "implement login feature")
		// Should have episodic hints since we wrote with same vector
		expect(result.episodicHints).toContain("Past Episodes")
		expect(result.episodicHints).toContain("[verified]")
	})

	it("labels failures and excludes unknown outcomes from prompt hints", async () => {
		await mgr.afterRun("failed", "intent", "failure details", { overall: "failed", acceptance: "pending" })
		await mgr.afterRun("unknown", "intent", "unverified declaration", {
			overall: "no_record",
			acceptance: "accepted",
		})
		const result = await mgr.beforeRun("next", "intent")
		expect(result.episodicHints).toContain("[failed]")
		expect(result.episodicHints).not.toContain("unverified declaration")
	})
})
