/**
 * EpisodicMemoryService
 *
 * Implements:
 *  - Persistent episodic memory (.njust_ai/memories/)
 *  - Two-Phase Retrieval (Phase A: cosine sim threshold, Phase B: z-score composite)
 *  - Monte Carlo Q-value update
 */

import * as fs from "fs/promises"
import * as path from "path"
import { safeWriteJson } from "../../../utils/safeWriteJson"
import { logger } from "../../../shared/logger"
import { MemoryEmbeddingAdapter } from "./MemoryEmbeddingAdapter"
import { currentEmbedFingerprint } from "./memory-embedder"
import type { MemrlOutcome, MemrlVerification } from "../interfaces/IMemoryManager"
import {
	ALPHA,
	EPISODIC_FILE,
	LAMBDA,
	LTM_DISTILL_INTERVAL,
	MEMRL_PRIMARY_DIR,
	Q_INIT,
	SIM_THRESHOLD,
	TOP_K1,
	TOP_K2,
} from "./constants"

export interface EpisodicEntry {
	id: string
	taskId?: string
	verification?: MemrlVerification
	tags?: string[]
	/** Plain-text intent / task description */
	intent: string
	/** Embedding vector for this intent */
	embedding: number[]
	/** Short-term memory summary from the task run */
	stmSummary: string
	/** Monte Carlo Q-value (expected reward) */
	qValue: number
	/** Number of times this entry has been updated */
	updateCount: number
	createdAt: number
	updatedAt: number
}

export interface EpisodicStore {
	entries: EpisodicEntry[]
	/** Total number of episodic writes ever (used to trigger LTM distillation) */
	totalWrites: number
	/** Embedding-model fingerprint of the vectors stored here (see memory-embedder). */
	embedFingerprint?: string
}

// Instances can outlive a task while an embedding/write is pending.
const fileWrites = new Map<string, Promise<void>>()

export class EpisodicMemoryService {
	private store: EpisodicStore = { entries: [], totalWrites: 0 }
	private loaded = false

	constructor(
		private readonly workspaceDir: string,
		private readonly embedder: MemoryEmbeddingAdapter,
		/** Called when totalWrites % LTM_DISTILL_INTERVAL === 0 */
		private readonly onDistillTrigger?: () => void,
	) {}

	// ── Persistence ────────────────────────────────────────────────────────────

	private get primaryPath(): string {
		return path.join(this.workspaceDir, MEMRL_PRIMARY_DIR, EPISODIC_FILE)
	}

	async load(): Promise<void> {
		if (this.loaded) return
		const current = currentEmbedFingerprint()
		try {
			const raw = await fs.readFile(this.primaryPath, "utf-8")
			const parsed = JSON.parse(raw) as EpisodicStore
			if (parsed.embedFingerprint === current) {
				this.store = parsed
			} else {
				// Embedding model changed (or legacy un-fingerprinted store): old vectors
				// live in a different space and would silently fail cosine similarity.
				// Auto-discard instead of mixing incompatible vectors.
				logger.warn(
					"MemRL",
					`episodic store embedding model changed (${parsed.embedFingerprint ?? "unknown"} → ${current}); resetting store`,
				)
				this.store = { entries: [], totalWrites: 0, embedFingerprint: current }
			}
		} catch (err) {
			logger.debug("MemRL", "cold start or failed to read episodic store", err)
			// Cold start — empty store is fine
			this.store = { entries: [], totalWrites: 0, embedFingerprint: current }
		}
		this.store.embedFingerprint = current
		this.loaded = true
	}

	private async persist(): Promise<void> {
		await safeWriteJson(this.primaryPath, this.store)
	}

	private enqueueWrite(operation: () => Promise<void>): Promise<void> {
		const absolutePath = path.resolve(this.primaryPath)
		const key = process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath
		const result = (fileWrites.get(key) ?? Promise.resolve()).then(async () => {
			// Reload under the same lock as the write, including for previously loaded instances.
			this.loaded = false
			await this.load()
			await operation()
		})
		const settled = result.catch((error) => logger.debug("MemRL", "Episodic write failed", error))
		fileWrites.set(key, settled)
		void settled.then(() => {
			if (fileWrites.get(key) === settled) fileWrites.delete(key)
		})
		return result
	}

	// ── Write ──────────────────────────────────────────────────────────────────

	/**
	 * Store a new episodic entry and update totalWrites.
	 * Triggers LTM distillation callback every LTM_DISTILL_INTERVAL writes.
	 */
	write(intent: string, stmSummary: string, outcome: MemrlOutcome): Promise<void> {
		return this.enqueueWrite(() => this.writeEntry(intent, stmSummary, outcome))
	}

	private async writeEntry(intent: string, stmSummary: string, outcome: MemrlOutcome): Promise<void> {
		await this.load()

		const embedding = await this.embedder.embed(intent)
		const now = Date.now()
		const id = `ep_${now}_${Math.random().toString(36).slice(2, 9)}`
		const existing = this.store.entries.find((entry) => entry.taskId === outcome.taskId)
		const known = outcome.overall === "verified" || outcome.overall === "failed"
		const qValue = known ? Q_INIT + ALPHA * ((outcome.overall === "verified" ? 1 : 0) - Q_INIT) : Q_INIT
		const tags = (existing?.tags ?? []).filter((tag) => tag !== "verification_unknown")
		if (!known) tags.push("verification_unknown")

		const entry: EpisodicEntry = {
			id: existing?.id ?? id,
			taskId: outcome.taskId,
			verification: { overall: outcome.overall, acceptance: outcome.acceptance },
			tags,
			intent,
			embedding,
			stmSummary,
			qValue,
			updateCount: (existing?.updateCount ?? 0) + 1,
			createdAt: existing?.createdAt ?? now,
			updatedAt: now,
		}

		if (existing) Object.assign(existing, entry)
		else {
			this.store.entries.push(entry)
			this.store.totalWrites++
		}

		await this.persist()

		if (!existing && this.store.totalWrites % LTM_DISTILL_INTERVAL === 0) {
			this.onDistillTrigger?.()
		}
	}

	/** Accepting history never embeds again or changes the original verification reward. */
	updateAcceptance(taskId: string, acceptance: MemrlVerification["acceptance"]): Promise<void> {
		return this.enqueueWrite(async () => {
			const entry = this.store.entries.find((item) => item.taskId === taskId)
			if (!entry?.verification) return
			entry.verification.acceptance = acceptance
			entry.updatedAt = Date.now()
			await this.persist()
		})
	}

	/**
	 * Update Q-value for an existing entry via Monte Carlo rule:
	 *   Q_new = Q_old + α·(r - Q_old)
	 */
	async updateQ(entryId: string, reward: number): Promise<void> {
		return this.enqueueWrite(async () => {
			const entry = this.store.entries.find((e) => e.id === entryId)
			if (!entry) return

			entry.qValue = entry.qValue + ALPHA * (reward - entry.qValue)
			entry.updateCount++
			entry.updatedAt = Date.now()

			await this.persist()
		})
	}

	// ── Two-Phase Retrieval ────────────────────────────────────────────────────

	/**
	 * Retrieve the most relevant episodic entries for a given query intent.
	 *
	 * Phase A: cosine similarity ≥ SIM_THRESHOLD → candidate set (up to TOP_K1)
	 * Phase B: z-score normalise sim and Q, then score = (1-λ)·sim̂ + λ·Q̂ → top TOP_K2
	 */
	async retrieve(queryIntent: string): Promise<EpisodicEntry[]> {
		await this.load()

		const candidates = this.store.entries.filter(usableEpisode)
		if (candidates.length === 0) return []

		const queryVec = await this.embedder.embed(queryIntent)
		if (queryVec.length === 0) return []

		// ── Phase A ──────────────────────────────────────────────────────────
		const withSim = candidates
			.map((entry) => ({
				entry,
				sim: MemoryEmbeddingAdapter.cosineSim(queryVec, entry.embedding),
			}))
			.filter((x) => x.sim >= SIM_THRESHOLD)
			.sort((a, b) => b.sim - a.sim)
			.slice(0, TOP_K1)

		if (withSim.length === 0) return []

		// ── Phase B ──────────────────────────────────────────────────────────
		const sims = withSim.map((x) => x.sim)
		const qVals = withSim.map((x) => x.entry.qValue)

		const simHat = MemoryEmbeddingAdapter.zScore(sims)
		const qHat = MemoryEmbeddingAdapter.zScore(qVals)

		const scored = withSim.map((x, i) => ({
			entry: x.entry,
			score: (1 - LAMBDA) * (simHat[i] ?? 0) + LAMBDA * (qHat[i] ?? 0),
		}))

		scored.sort((a, b) => b.score - a.score)

		return scored.slice(0, TOP_K2).map((x) => x.entry)
	}

	/** Return up to `n` most-recent entries (for LTM distillation). */
	getRecent(n: number): EpisodicEntry[] {
		return this.store.entries
			.filter(usableEpisode)
			.sort((a, b) => b.createdAt - a.createdAt)
			.slice(0, n)
	}

	get totalWrites(): number {
		return this.store.totalWrites
	}
}

function usableEpisode(entry: EpisodicEntry): boolean {
	return (
		!entry.tags?.includes("verification_unknown") &&
		(entry.verification?.overall === "verified" || entry.verification?.overall === "failed")
	)
}
