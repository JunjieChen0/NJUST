/**
 * Task lifecycle orchestration (plan Task 4).
 * Concrete `startTask` / `resumeTaskFromHistory` / `abort` / `dispose` remain on {@link Task}
 * pending a private-surface pass; reuse utilities from {@link module:./TaskLifecycle}.
 */
export {
	cleanHistoryForResumption,
	getResumeAskType,
	checkSubtaskBudget,
	type SubtaskBudgetStatus,
} from "./TaskLifecycle"
