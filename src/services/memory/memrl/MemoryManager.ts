/**
 * MemoryManager — Façade for the MemRL memory system.
 *
 * Coordinates:
 *  - SessionShortTermManager (per-task STM)
 *  - EpisodicMemoryService (persistent episodic + Q-learning)
 *  - LongTermMemoryService (LLM-distilled RuleCards)
 *
 * Integration points:
 *  - beforeRun(taskId, intent) → returns hints to inject into prompt
 *  - afterRun(taskId, intent, stmSummary, outcome) → upserts verification facts
 *  - updateDependencies(embedder, api) → call when provider initialises
 */

import type { ApiHandler } from "../../../api"
import type { IEmbedder } from "../../code-index/interfaces/embedder"
import { logger } from "../../../shared/logger"
import { MemoryEmbeddingAdapter } from "./MemoryEmbeddingAdapter"
import { SessionShortTermManager } from "./SessionShortTermManager"
import { EpisodicMemoryService } from "./EpisodicMemoryService"
import { LongTermMemoryService, type RuleCard } from "./LongTermMemoryService"
import type { EpisodicEntry } from "./EpisodicMemoryService"
import { LTM_DISTILL_BATCH } from "./constants"
import { createMemoryEmbedder } from "./memory-embedder"
import type { MemrlVerification } from "../interfaces/IMemoryManager"

export interface MemrlBeforeRunResult {
	/** Formatted episodic hints for prompt injection */
	episodicHints: string
	/** Formatted LTM rule bullets for prompt injection */
	ltmRules: string
}

export class MemoryManager {
	private embedAdapter?: MemoryEmbeddingAdapter
	private episodic?: EpisodicMemoryService
	private ltm?: LongTermMemoryService
	private readonly stmManager = new SessionShortTermManager()

	constructor(public readonly workspaceDir: string) {}

	/**
	 * Call once provider/context is ready to supply API handler.
	 * embedder is optional — if absent, a no-op stub is used so Q-value
	 * updates and STM still work (retrieval just returns nothing).
	 * Safe to call multiple times.
	 */
	updateDependencies(api: ApiHandler, embedder?: IEmbedder): void {
		// Precedence: an explicitly-supplied embedder wins (used by tests / callers
		// that inject their own); otherwise use MemRL's dedicated OpenAI-compatible
		// embedder (dev-configured default key); finally fall back to a no-op stub.
		const resolved = embedder ?? createMemoryEmbedder() ?? MemoryManager.makeNoopEmbedder()
		this.embedAdapter = new MemoryEmbeddingAdapter(resolved)
		this.ltm = new LongTermMemoryService(this.workspaceDir, this.embedAdapter, api)
		this.episodic = new EpisodicMemoryService(this.workspaceDir, this.embedAdapter, () =>
			this.triggerDistillation(),
		)
	}

	ensureReady(api: ApiHandler): void {
		if (!this.episodic) this.updateDependencies(api)
	}

	async updateAcceptance(taskId: string, acceptance: MemrlVerification["acceptance"]): Promise<void> {
		await this.episodic?.updateAcceptance(taskId, acceptance)
	}

	private static makeNoopEmbedder(): IEmbedder {
		return {
			createEmbeddings: async () => ({ embeddings: [] }),
			validateConfiguration: async () => ({ valid: false, error: "no embedder configured" }),
			get embedderInfo() {
				return { name: "openai" as const }
			},
		}
	}

	// ── Public lifecycle hooks ─────────────────────────────────────────────────

	/**
	 * Called at the start of a task loop.
	 * Retrieves relevant episodic hints and LTM rules.
	 * Returns empty strings if memory not yet initialised (cold start).
	 */
	async beforeRun(taskId: string, intent: string): Promise<MemrlBeforeRunResult> {
		// Ensure fresh STM for this task
		this.stmManager.get(taskId).clear()

		if (!this.episodic || !this.ltm) {
			return { episodicHints: "", ltmRules: "" }
		}

		const [episodicEntries, ltmCards] = await Promise.all([
			this.episodic.retrieve(intent).catch((err) => {
				logger.debug("MemoryManager", "episodic retrieve failed", err)
				return []
			}),
			this.ltm.retrieve(intent).catch((err) => {
				logger.debug("MemoryManager", "LTM retrieve failed", err)
				return []
			}),
		])

		// Mark LTM rules as used
		if (ltmCards.length > 0) {
			this.ltm.markUsed(ltmCards.map((r) => r.id)).catch(() => {
				logger.debug("MemoryManager", "markUsed failed (best-effort)")
			})
		}

		const episodicHints = this.formatEpisodicHints(episodicEntries)
		const ltmRules = this.formatLtmRules(ltmCards)

		return { episodicHints, ltmRules }
	}

	/**
	 * Store verification facts when a task ends or the user decides on a delivery.
	 */
	async afterRun(taskId: string, intent: string, stmSummary: string, outcome: MemrlVerification): Promise<void> {
		if (!this.episodic) return
		try {
			await this.episodic.write(intent, stmSummary, { ...outcome, taskId })
		} catch (error) {
			logger.warn("MemoryManager", "afterRun write failed", error)
		} finally {
			this.stmManager.delete(taskId)
		}
	}

	/** Access the STM for a task (for recording steps). */
	getStm(taskId: string) {
		return this.stmManager.get(taskId)
	}

	// ── Private helpers ────────────────────────────────────────────────────────

	private triggerDistillation(): void {
		if (!this.episodic || !this.ltm) return
		const recent = this.episodic.getRecent(LTM_DISTILL_BATCH)
		// Fire-and-forget LLM distillation
		this.ltm.distill(recent).catch((err) => {
			logger.debug("MemoryManager", "distillation trigger failed", err)
		})
	}

	private formatEpisodicHints(entries: EpisodicEntry[]): string {
		if (entries.length === 0) return ""
		const lines = entries.map(
			(e, i) =>
				`${i + 1}. [${e.verification?.overall}] [Q=${e.qValue.toFixed(2)}] Intent: ${e.intent}\n   Summary: ${e.stmSummary.slice(0, 300)}`,
		)
		return `### Relevant Past Episodes\n${lines.join("\n\n")}`
	}

	private formatLtmRules(rules: RuleCard[]): string {
		if (rules.length === 0) return ""
		const lines = rules.map(
			(r, i) =>
				`${i + 1}. **${r.topic}** (confidence=${r.confidence.toFixed(2)}): ${r.rule}` +
				(r.examples.length > 0 ? `\n   Examples: ${r.examples.slice(0, 2).join("; ")}` : ""),
		)
		return `### Learned Rules\n${lines.join("\n\n")}`
	}

	dispose(): void {
		// No-op for now — MemRL services clean up via their own lifecycle
	}
}
