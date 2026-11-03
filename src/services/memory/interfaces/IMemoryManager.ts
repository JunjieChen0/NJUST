import type { ApiHandler } from "../../../api"
import type { IEmbedder } from "../../code-index/interfaces/embedder"
import type { IShortTermMemory } from "./IShortTermMemory"
import type { VerificationSummary } from "@njust-ai/types"

export type MemrlVerification = Pick<VerificationSummary, "overall" | "acceptance">
export type MemrlOutcome = MemrlVerification & { taskId: string }

export interface MemrlBeforeRunResult {
	/** Formatted episodic hints for prompt injection */
	episodicHints: string
	/** Formatted LTM rule bullets for prompt injection */
	ltmRules: string
}

/**
 * Public surface of MemoryManager.
 */
export interface IMemoryManager {
	readonly workspaceDir: string
	updateDependencies(api: ApiHandler, embedder?: IEmbedder): void
	ensureReady(api: ApiHandler): void
	updateAcceptance(taskId: string, acceptance: MemrlVerification["acceptance"]): Promise<void>
	beforeRun(taskId: string, intent: string): Promise<MemrlBeforeRunResult>
	afterRun(taskId: string, intent: string, stmSummary: string, outcome: MemrlVerification): Promise<void>
	getStm(taskId: string): IShortTermMemory
	dispose(): void
}
