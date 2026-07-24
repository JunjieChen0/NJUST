export type DeferredPhase = "idle" | "pending" | "running" | "done" | "aborted"

export interface LifecycleGuardConfig {
	maxIterations: number
	maxDurationMs: number
	pendingToRunningTimeoutMs: number
}

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleGuardConfig = {
	maxIterations: 50,
	maxDurationMs: 120_000,
	pendingToRunningTimeoutMs: 300_000,
}

export type LifecycleGuardAction = "continue" | "abort"

export interface LifecycleCheckResult {
	action: LifecycleGuardAction
	reason?: string
	iteration: number
	elapsedMs: number
	phase: DeferredPhase
}

export class DeferredLifecycleGuard {
	private config: LifecycleGuardConfig
	private phase: DeferredPhase = "idle"
	private iteration = 0
	private readonly startTime: number
	private phaseStartTime: number
	private pendingToolCount = 0
	private completedToolCount = 0
	private aborted = false

	constructor(config: Partial<LifecycleGuardConfig> = {}) {
		this.config = { ...DEFAULT_LIFECYCLE_CONFIG, ...config }
		this.startTime = Date.now()
		this.phaseStartTime = this.startTime
	}

	getPhase(): DeferredPhase {
		return this.phase
	}

	getIteration(): number {
		return this.iteration
	}

	getElapsedMs(): number {
		return Date.now() - this.startTime
	}

	isAborted(): boolean {
		return this.aborted
	}

	transitionToPending(pendingToolCount: number): LifecycleCheckResult {
		if (this.aborted) {
			return this.makeAbortResult("Guard already aborted")
		}

		if (this.iteration >= this.config.maxIterations) {
			this.aborted = true
			this.phase = "aborted"
			return this.makeAbortResult(`Iteration limit reached: ${this.iteration} >= ${this.config.maxIterations}`)
		}

		const elapsed = this.getElapsedMs()
		if (elapsed > this.config.maxDurationMs) {
			this.aborted = true
			this.phase = "aborted"
			return this.makeAbortResult(`Wall-clock limit reached: ${elapsed}ms > ${this.config.maxDurationMs}ms`)
		}

		this.phase = "pending"
		this.phaseStartTime = Date.now()
		this.pendingToolCount = pendingToolCount
		this.completedToolCount = 0

		return this.makeContinueResult()
	}

	recordToolCompletion(): LifecycleCheckResult {
		this.completedToolCount++

		if (this.completedToolCount > this.pendingToolCount) {
			this.aborted = true
			this.phase = "aborted"
			return this.makeAbortResult(
				`Batch integrity violation: completed ${this.completedToolCount} tools but only ${this.pendingToolCount} were pending`,
			)
		}

		return this.makeContinueResult()
	}

	validateBatchCompleteness(): LifecycleCheckResult {
		if (this.pendingToolCount > 0 && this.completedToolCount !== this.pendingToolCount) {
			this.aborted = true
			this.phase = "aborted"
			return this.makeAbortResult(
				`Batch integrity violation: expected ${this.pendingToolCount} results, got ${this.completedToolCount}`,
			)
		}

		return this.makeContinueResult()
	}

	transitionToRunning(): LifecycleCheckResult {
		if (this.aborted) {
			return this.makeAbortResult("Guard already aborted")
		}

		if (this.phase !== "pending") {
			this.aborted = true
			this.phase = "aborted"
			return this.makeAbortResult(
				`Invalid state transition: cannot transition to running from phase "${this.phase}"`,
			)
		}

		const batchCheck = this.validateBatchCompleteness()
		if (batchCheck.action === "abort") {
			return batchCheck
		}

		this.phase = "running"
		this.phaseStartTime = Date.now()

		return this.makeContinueResult()
	}

	checkPendingTimeout(): LifecycleCheckResult {
		if (this.phase !== "pending") {
			return this.makeContinueResult()
		}

		const phaseElapsed = Date.now() - this.phaseStartTime
		if (phaseElapsed > this.config.pendingToRunningTimeoutMs) {
			this.aborted = true
			this.phase = "aborted"
			return this.makeAbortResult(
				`Pending-to-running timeout: ${phaseElapsed}ms exceeds ${this.config.pendingToRunningTimeoutMs}ms`,
			)
		}

		return this.makeContinueResult()
	}

	transitionToDone(): void {
		if (this.phase === "aborted") {
			return // Preserve aborted state, do not overwrite with done
		}
		this.phase = "done"
	}

	abort(_reason: string): void {
		this.aborted = true
		this.phase = "aborted"
	}

	private checkLimits(): LifecycleCheckResult {
		if (this.iteration > this.config.maxIterations) {
			this.aborted = true
			this.phase = "aborted"
			return this.makeAbortResult(`Iteration limit reached: ${this.iteration} > ${this.config.maxIterations}`)
		}

		const elapsed = this.getElapsedMs()
		if (elapsed > this.config.maxDurationMs) {
			this.aborted = true
			this.phase = "aborted"
			return this.makeAbortResult(`Wall-clock limit reached: ${elapsed}ms > ${this.config.maxDurationMs}ms`)
		}

		return this.makeContinueResult()
	}

	incrementIteration(): LifecycleCheckResult {
		this.iteration++
		return this.checkLimits()
	}

	private makeContinueResult(): LifecycleCheckResult {
		return {
			action: "continue",
			iteration: this.iteration,
			elapsedMs: this.getElapsedMs(),
			phase: this.phase,
		}
	}

	private makeAbortResult(reason: string): LifecycleCheckResult {
		return {
			action: "abort",
			reason,
			iteration: this.iteration,
			elapsedMs: this.getElapsedMs(),
			phase: this.phase,
		}
	}
}
