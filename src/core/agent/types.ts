export interface Plan {
	id: string
	title: string
	description: string
	steps: PlanStep[]
	status: PlanStatus
	createdAt: number
	updatedAt: number
	totalSteps: number
	completedSteps: number
}

export type PlanStatus = "draft" | "approved" | "executing" | "paused" | "completed" | "failed" | "cancelled"

export interface PlanStep {
	id: string
	index: number
	description: string
	mode: string
	dependencies: string[]
	status: PlanStepStatus
	result?: string
	error?: string
	startedAt?: number
	completedAt?: number
	taskId?: string
}

export type PlanStepStatus = "pending" | "ready" | "running" | "completed" | "failed" | "skipped" | "cancelled"

export interface PlanStepResult {
	stepId: string
	status: PlanStepStatus
	result?: string
	error?: string
}

export interface PlanGenerationOptions {
	task: string
	context?: string
	maxSteps?: number
}

export interface PlanExecutionOptions {
	autoApprove?: boolean
	maxParallel?: number
	onStepStart?: (step: PlanStep) => void
	onStepComplete?: (step: PlanStep, result: PlanStepResult) => void
	onPlanUpdate?: (plan: Plan) => void
}

export interface SharedContext {
	id: string
	modifiedFiles: Set<string>
	results: Map<string, string>
	metadata: Map<string, unknown>
}

export interface AgentInfo {
	id: string
	taskId: string
	mode: string
	status: "idle" | "running" | "completed" | "failed"
	description: string
	startedAt: number
	completedAt?: number
}
