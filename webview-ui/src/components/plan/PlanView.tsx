import React, { useState, useCallback, useMemo } from "react"
import { vscode } from "../../utils/vscode"

interface PlanStep {
	id: string
	index: number
	description: string
	mode: string
	dependencies: string[]
	status: "pending" | "ready" | "running" | "completed" | "failed" | "skipped" | "cancelled"
	result?: string
	error?: string
}

interface Plan {
	id: string
	title: string
	description: string
	steps: PlanStep[]
	status: "draft" | "approved" | "executing" | "paused" | "completed" | "failed" | "cancelled"
	completedSteps: number
	totalSteps: number
}

interface PlanViewProps {
	plan: Plan | null
	onClose?: () => void
}

const STATUS_ICONS: Record<string, string> = {
	pending: "⏳",
	ready: "🔵",
	running: "🔄",
	completed: "✅",
	failed: "❌",
	skipped: "⏭️",
	cancelled: "🚫",
}

const MODE_LABELS: Record<string, string> = {
	code: "Code",
	architect: "Architect",
	ask: "Ask",
	debug: "Debug",
	orchestrator: "Orchestrator",
}

const STATUS_COLORS: Record<string, string> = {
	pending: "var(--vscode-descriptionForeground)",
	ready: "var(--vscode-charts-blue)",
	running: "var(--vscode-charts-yellow)",
	completed: "var(--vscode-charts-green)",
	failed: "var(--vscode-charts-red)",
	skipped: "var(--vscode-descriptionForeground)",
	cancelled: "var(--vscode-descriptionForeground)",
}

export const PlanView: React.FC<PlanViewProps> = ({ plan, onClose }) => {
	const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
	const [editingStep, setEditingStep] = useState<string | null>(null)
	const [editText, setEditText] = useState("")

	const toggleStep = useCallback((stepId: string) => {
		setExpandedSteps((prev) => {
			const next = new Set(prev)
			if (next.has(stepId)) {
				next.delete(stepId)
			} else {
				next.add(stepId)
			}
			return next
		})
	}, [])

	const handleApprove = useCallback(() => {
		if (!plan) return
		vscode.postMessage({ type: "planAction", action: "approve", planId: plan.id })
	}, [plan])

	const handleExecute = useCallback(() => {
		if (!plan) return
		vscode.postMessage({ type: "planAction", action: "execute", planId: plan.id })
	}, [plan])

	const handlePause = useCallback(() => {
		if (!plan) return
		vscode.postMessage({ type: "planAction", action: "pause", planId: plan.id })
	}, [plan])

	const handleCancel = useCallback(() => {
		if (!plan) return
		vscode.postMessage({ type: "planAction", action: "cancel", planId: plan.id })
	}, [plan])

	const handleEditStep = useCallback(
		(stepId: string) => {
			if (!plan) return
			const step = plan.steps.find((s) => s.id === stepId)
			if (step) {
				setEditingStep(stepId)
				setEditText(step.description)
			}
		},
		[plan],
	)

	const handleSaveEdit = useCallback(() => {
		if (!plan || !editingStep) return
		vscode.postMessage({
			type: "planAction",
			action: "updateStep",
			planId: plan.id,
			stepId: editingStep,
			description: editText,
		})
		setEditingStep(null)
		setEditText("")
	}, [plan, editingStep, editText])

	const progressPercent = useMemo(() => {
		if (!plan || plan.totalSteps === 0) return 0
		return Math.round((plan.completedSteps / plan.totalSteps) * 100)
	}, [plan])

	if (!plan) {
		return (
			<div style={styles.emptyContainer}>
				<p style={styles.emptyText}>No active plan. Use /plan command to create one.</p>
			</div>
		)
	}

	return (
		<div style={styles.container}>
			{/* Header */}
			<div style={styles.header}>
				<div style={styles.headerTop}>
					<h3 style={styles.title}>{plan.title}</h3>
					{onClose && (
						<button style={styles.closeButton} onClick={onClose}>
							×
						</button>
					)}
				</div>
				{plan.description && <p style={styles.description}>{plan.description}</p>}
				<div style={styles.statusBar}>
					<span style={styles.statusBadge(plan.status)}>{plan.status.toUpperCase()}</span>
					<span style={styles.progressText}>
						{plan.completedSteps}/{plan.totalSteps} steps
					</span>
				</div>
				{/* Progress bar */}
				<div style={styles.progressBar}>
					<div style={styles.progressFill(progressPercent)} />
				</div>
			</div>

			{/* Steps */}
			<div style={styles.stepsContainer}>
				{plan.steps.map((step) => (
					<div key={step.id} style={styles.stepCard(step.status)}>
						<div style={styles.stepHeader} onClick={() => toggleStep(step.id)}>
							<span style={styles.stepIcon}>{STATUS_ICONS[step.status]}</span>
							<span style={styles.stepIndex}>Step {step.index + 1}</span>
							<span style={styles.modeBadge}>{MODE_LABELS[step.mode] || step.mode}</span>
							<span style={styles.stepExpander}>{expandedSteps.has(step.id) ? "▼" : "▶"}</span>
						</div>

						{editingStep === step.id ? (
							<div style={styles.editContainer}>
								<textarea
									style={styles.editTextarea}
									value={editText}
									onChange={(e) => setEditText(e.target.value)}
									rows={3}
								/>
								<div style={styles.editActions}>
									<button style={styles.actionButton} onClick={handleSaveEdit}>
										Save
									</button>
									<button style={styles.actionButtonSecondary} onClick={() => setEditingStep(null)}>
										Cancel
									</button>
								</div>
							</div>
						) : (
							<p
								style={styles.stepDescription}
								onDoubleClick={() => plan.status === "draft" && handleEditStep(step.id)}>
								{step.description}
							</p>
						)}

						{expandedSteps.has(step.id) && (
							<div style={styles.stepDetails}>
								{step.dependencies.length > 0 && (
									<div style={styles.detailRow}>
										<span style={styles.detailLabel}>Dependencies:</span>
										<span>
											{step.dependencies
												.map((depId) => {
													const dep = plan.steps.find((s) => s.id === depId)
													return dep ? `Step ${dep.index + 1}` : depId
												})
												.join(", ")}
										</span>
									</div>
								)}
								{step.result && (
									<div style={styles.detailRow}>
										<span style={styles.detailLabel}>Result:</span>
										<pre style={styles.resultPre}>{step.result}</pre>
									</div>
								)}
								{step.error && (
									<div style={styles.detailRow}>
										<span style={styles.detailLabel}>Error:</span>
										<pre style={styles.errorPre}>{step.error}</pre>
									</div>
								)}
							</div>
						)}
					</div>
				))}
			</div>

			{/* Actions */}
			<div style={styles.actionsBar}>
				{plan.status === "draft" && (
					<>
						<button style={styles.primaryButton} onClick={handleApprove}>
							Approve Plan
						</button>
						<button style={styles.secondaryButton} onClick={handleCancel}>
							Discard
						</button>
					</>
				)}
				{plan.status === "approved" && (
					<button style={styles.primaryButton} onClick={handleExecute}>
						Execute Plan
					</button>
				)}
				{plan.status === "executing" && (
					<button style={styles.warningButton} onClick={handlePause}>
						Pause Execution
					</button>
				)}
				{plan.status === "paused" && (
					<>
						<button style={styles.primaryButton} onClick={handleExecute}>
							Resume Execution
						</button>
						<button style={styles.secondaryButton} onClick={handleCancel}>
							Cancel Plan
						</button>
					</>
				)}
			</div>
		</div>
	)
}

const styles = {
	container: {
		display: "flex",
		flexDirection: "column" as const,
		gap: "12px",
		padding: "12px",
		height: "100%",
		overflow: "auto",
	},
	emptyContainer: {
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		height: "100%",
		padding: "20px",
	},
	emptyText: {
		color: "var(--vscode-descriptionForeground)",
		fontSize: "13px",
	},
	header: {
		display: "flex",
		flexDirection: "column" as const,
		gap: "8px",
		paddingBottom: "12px",
		borderBottom: "1px solid var(--vscode-panel-border)",
	},
	headerTop: {
		display: "flex",
		justifyContent: "space-between",
		alignItems: "center",
	},
	title: {
		margin: 0,
		fontSize: "16px",
		fontWeight: 600,
		color: "var(--vscode-foreground)",
	},
	closeButton: {
		background: "none",
		border: "none",
		color: "var(--vscode-foreground)",
		fontSize: "18px",
		cursor: "pointer",
		padding: "2px 6px",
	},
	description: {
		margin: 0,
		fontSize: "12px",
		color: "var(--vscode-descriptionForeground)",
	},
	statusBar: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
	},
	statusBadge: (status: string): React.CSSProperties => ({
		fontSize: "10px",
		fontWeight: 600,
		padding: "2px 8px",
		borderRadius: "10px",
		background: STATUS_COLORS[status] || "var(--vscode-badge-background)",
		color: "var(--vscode-badge-foreground)",
	}),
	progressText: {
		fontSize: "12px",
		color: "var(--vscode-descriptionForeground)",
	},
	progressBar: {
		height: "4px",
		background: "var(--vscode-progressBar-background)",
		borderRadius: "2px",
		overflow: "hidden" as const,
	},
	progressFill: (percent: number): React.CSSProperties => ({
		height: "100%",
		width: `${percent}%`,
		background: "var(--vscode-progressBar-background)",
		borderRadius: "2px",
		transition: "width 0.3s ease",
	}),
	stepsContainer: {
		display: "flex",
		flexDirection: "column" as const,
		gap: "8px",
		flex: 1,
	},
	stepCard: (status: string): React.CSSProperties => ({
		border: `1px solid ${status === "running" ? "var(--vscode-charts-yellow)" : "var(--vscode-panel-border)"}`,
		borderRadius: "6px",
		padding: "10px",
		background: status === "running" ? "var(--vscode-editor-findMatchHighlightBackground)" : "transparent",
	}),
	stepHeader: {
		display: "flex",
		alignItems: "center",
		gap: "8px",
		cursor: "pointer",
	},
	stepIcon: {
		fontSize: "14px",
	},
	stepIndex: {
		fontSize: "12px",
		fontWeight: 600,
		color: "var(--vscode-foreground)",
	},
	modeBadge: {
		fontSize: "10px",
		padding: "1px 6px",
		borderRadius: "8px",
		background: "var(--vscode-badge-background)",
		color: "var(--vscode-badge-foreground)",
	},
	stepExpander: {
		marginLeft: "auto",
		fontSize: "10px",
		color: "var(--vscode-descriptionForeground)",
	},
	stepDescription: {
		margin: "6px 0 0 22px",
		fontSize: "12px",
		color: "var(--vscode-foreground)",
		lineHeight: 1.4,
	},
	stepDetails: {
		marginTop: "8px",
		marginLeft: "22px",
		display: "flex",
		flexDirection: "column" as const,
		gap: "4px",
	},
	detailRow: {
		display: "flex",
		flexDirection: "column" as const,
		gap: "2px",
		fontSize: "11px",
	},
	detailLabel: {
		fontWeight: 600,
		color: "var(--vscode-descriptionForeground)",
	},
	resultPre: {
		margin: 0,
		padding: "6px",
		background: "var(--vscode-textCodeBlock-background)",
		borderRadius: "4px",
		fontSize: "11px",
		whiteSpace: "pre-wrap" as const,
		maxHeight: "100px",
		overflow: "auto" as const,
	},
	errorPre: {
		margin: 0,
		padding: "6px",
		background: "var(--vscode-inputValidation-errorBackground)",
		borderRadius: "4px",
		fontSize: "11px",
		whiteSpace: "pre-wrap" as const,
		color: "var(--vscode-errorForeground)",
	},
	editContainer: {
		marginTop: "6px",
		marginLeft: "22px",
		display: "flex",
		flexDirection: "column" as const,
		gap: "6px",
	},
	editTextarea: {
		width: "100%",
		padding: "6px",
		fontSize: "12px",
		background: "var(--vscode-input-background)",
		color: "var(--vscode-input-foreground)",
		border: "1px solid var(--vscode-input-border)",
		borderRadius: "4px",
		resize: "vertical" as const,
		fontFamily: "inherit",
	},
	editActions: {
		display: "flex",
		gap: "6px",
	},
	actionsBar: {
		display: "flex",
		gap: "8px",
		paddingTop: "12px",
		borderTop: "1px solid var(--vscode-panel-border)",
	},
	actionButton: {
		padding: "4px 12px",
		fontSize: "12px",
		background: "var(--vscode-button-background)",
		color: "var(--vscode-button-foreground)",
		border: "none",
		borderRadius: "4px",
		cursor: "pointer",
	},
	actionButtonSecondary: {
		padding: "4px 12px",
		fontSize: "12px",
		background: "var(--vscode-button-secondaryBackground)",
		color: "var(--vscode-button-secondaryForeground)",
		border: "none",
		borderRadius: "4px",
		cursor: "pointer",
	},
	primaryButton: {
		padding: "6px 16px",
		fontSize: "12px",
		background: "var(--vscode-button-background)",
		color: "var(--vscode-button-foreground)",
		border: "none",
		borderRadius: "4px",
		cursor: "pointer",
		fontWeight: 600,
	},
	secondaryButton: {
		padding: "6px 16px",
		fontSize: "12px",
		background: "var(--vscode-button-secondaryBackground)",
		color: "var(--vscode-button-secondaryForeground)",
		border: "none",
		borderRadius: "4px",
		cursor: "pointer",
	},
	warningButton: {
		padding: "6px 16px",
		fontSize: "12px",
		background: "var(--vscode-inputValidation-warningBackground)",
		color: "var(--vscode-foreground)",
		border: "1px solid var(--vscode-inputValidation-warningBorder)",
		borderRadius: "4px",
		cursor: "pointer",
		fontWeight: 600,
	},
}
