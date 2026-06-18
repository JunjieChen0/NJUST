import { Show, For, createSignal } from "solid-js"
import { useTheme } from "../context/theme.tsx"
import type { TuiPlan, TuiPlanStep } from "../runtime/types.ts"

export interface PlanCardProps {
	plan: TuiPlan
	onApprove?: (planId: string) => void
	onExecute?: (planId: string) => void
	onPause?: (planId: string) => void
	onCancel?: (planId: string) => void
	onSkipStep?: (planId: string, stepId: string) => void
	onRegenerateStep?: (planId: string, stepId: string) => void
	onEditStep?: (planId: string, stepId: string, description: string) => void
}

export function PlanCard(props: PlanCardProps) {
	const { theme } = useTheme()
	const [expanded, setExpanded] = createSignal(false)

	const statusColor: Record<TuiPlan["status"], string> = {
		draft: theme.colors.textMuted,
		approved: theme.colors.success,
		executing: theme.colors.warning,
		paused: theme.colors.warning,
		completed: theme.colors.success,
		failed: theme.colors.error,
		cancelled: theme.colors.error,
	}

	const statusIcon: Record<TuiPlan["status"], string> = {
		draft: "◎",
		approved: "✓",
		executing: "●",
		paused: "⏸",
		completed: "✓",
		failed: "✗",
		cancelled: "⊘",
	}

	const stepStatusIcon: Record<TuiPlanStep["status"], string> = {
		pending: "○",
		ready: "◎",
		running: "●",
		completed: "✓",
		failed: "✗",
		skipped: "⊘",
		cancelled: "⊘",
	}

	const stepStatusColor: Record<TuiPlanStep["status"], string> = {
		pending: theme.colors.textMuted,
		ready: theme.colors.primary,
		running: theme.colors.warning,
		completed: theme.colors.success,
		failed: theme.colors.error,
		skipped: theme.colors.textMuted,
		cancelled: theme.colors.textMuted,
	}

	const isDraft = props.plan.status === "draft"
	const isRunning = props.plan.status === "executing"
	const progress =
		props.plan.totalSteps > 0 ? Math.round((props.plan.completedSteps / props.plan.totalSteps) * 100) : 0

	return (
		<box
			flexDirection="column"
			padding={1}
			margin={1}
			border={true}
			borderColor={theme.colors.secondary}
			backgroundColor={theme.colors.backgroundElement}
			width="100%">
			<box flexDirection="row" gap={1}>
				<text color={statusColor[props.plan.status]} bold>
					{statusIcon[props.plan.status]}
				</text>
				<box flexDirection="column" flexGrow={1}>
					<text color={theme.colors.text} bold>
						{props.plan.title}
					</text>
					<Show when={props.plan.description}>
						<text color={theme.colors.textMuted}>{props.plan.description}</text>
					</Show>
				</box>
				<text color={theme.colors.primary} onClick={() => setExpanded(!expanded())}>
					{expanded() ? "▾" : "▸"}
				</text>
			</box>

			<box flexDirection="column" paddingTop={1}>
				<box flexDirection="row" gap={1}>
					<box flexGrow={1} height={1} backgroundColor={theme.colors.borderSubtle} />
					<box
						width={`${progress}%`}
						height={1}
						backgroundColor={props.plan.status === "failed" ? theme.colors.error : theme.colors.success}
					/>
				</box>
				<text color={theme.colors.textMuted}>
					{props.plan.completedSteps}/{props.plan.totalSteps} steps · {progress}%
				</text>
			</box>

			<Show when={expanded()}>
				<box flexDirection="column" paddingTop={1}>
					<For each={props.plan.steps}>
						{(step) => (
							<PlanStepRow
								step={step}
								planId={props.plan.id}
								stepStatusIcon={stepStatusIcon}
								stepStatusColor={stepStatusColor}
								onSkip={props.onSkipStep}
								onRegenerate={props.onRegenerateStep}
								onEdit={props.onEditStep}
							/>
						)}
					</For>
				</box>
			</Show>

			<box flexDirection="row" gap={2} paddingTop={1}>
				<Show when={isDraft}>
					<text color={theme.colors.success} bold onClick={() => props.onApprove?.(props.plan.id)}>
						[Y] Approve
					</text>
					<text color={theme.colors.error} bold onClick={() => props.onExecute?.(props.plan.id)}>
						[E] Execute
					</text>
				</Show>
				<Show when={isRunning}>
					<text color={theme.colors.warning} bold onClick={() => props.onPause?.(props.plan.id)}>
						[P] Pause
					</text>
					<text color={theme.colors.error} bold onClick={() => props.onCancel?.(props.plan.id)}>
						[C] Cancel
					</text>
				</Show>
			</box>
		</box>
	)
}

interface PlanStepRowProps {
	step: TuiPlanStep
	planId: string
	stepStatusIcon: Record<TuiPlanStep["status"], string>
	stepStatusColor: Record<TuiPlanStep["status"], string>
	onSkip?: (planId: string, stepId: string) => void
	onRegenerate?: (planId: string, stepId: string) => void
	onEdit?: (planId: string, stepId: string, description: string) => void
}

function PlanStepRow(props: PlanStepRowProps) {
	const { theme } = useTheme()
	const [showResult, setShowResult] = createSignal(!!props.step.error)
	const [editing, setEditing] = createSignal(false)
	const [editValue, setEditValue] = createSignal(props.step.description)

	const hasResult = () => props.step.result || props.step.error
	const isPending = () => props.step.status === "pending" || props.step.status === "ready"
	const isFailed = () => props.step.status === "failed"

	function saveEdit() {
		const value = editValue().trim()
		if (value && value !== props.step.description) {
			props.onEdit?.(props.planId, props.step.id, value)
		}
		setEditing(false)
	}

	return (
		<box flexDirection="column" paddingY={1}>
			<box flexDirection="row" gap={1}>
				<text color={props.stepStatusColor[props.step.status]} bold>
					{props.stepStatusIcon[props.step.status]}
				</text>
				<box flexDirection="column" flexGrow={1}>
					<Show
						when={!editing()}
						fallback={
							<box flexDirection="row" gap={1}>
								<text color={theme.colors.text}>{"> "}</text>
								<text color={theme.colors.text}>{editValue()}</text>
							</box>
						}>
						<text color={theme.colors.text}>{props.step.description}</text>
					</Show>
					<text color={theme.colors.textMuted}>
						Step {props.step.index + 1} · {props.step.mode}
						<Show when={props.step.startedAt}> · started {formatDuration(props.step.startedAt)}</Show>
						<Show when={props.step.completedAt}> · finished {formatDuration(props.step.completedAt)}</Show>
						<Show when={props.step.taskId}> · task {props.step.taskId}</Show>
					</text>
				</box>
				<Show when={hasResult()}>
					<text color={theme.colors.primary} onClick={() => setShowResult(!showResult())}>
						{showResult() ? "▾" : "▸"}
					</text>
				</Show>
			</box>

			<Show when={showResult() && hasResult()}>
				<box flexDirection="column" paddingLeft={2} paddingTop={1}>
					<Show when={props.step.result}>
						<text color={theme.colors.textMuted}>Result: {props.step.result}</text>
					</Show>
					<Show when={props.step.error}>
						<text color={theme.colors.error}>Error: {props.step.error}</text>
					</Show>
				</box>
			</Show>

			<Show when={!editing()}>
				<box flexDirection="row" gap={2} paddingLeft={2} paddingTop={1}>
					<Show when={isPending()}>
						<text
							color={theme.colors.textMuted}
							onClick={() => props.onSkip?.(props.planId, props.step.id)}>
							[Skip]
						</text>
					</Show>
					<Show when={isFailed()}>
						<text
							color={theme.colors.warning}
							onClick={() => props.onRegenerate?.(props.planId, props.step.id)}>
							[Retry]
						</text>
					</Show>
					<text
						color={theme.colors.primary}
						onClick={() => {
							setEditing(true)
							setEditValue(props.step.description)
						}}>
						[Edit]
					</text>
				</box>
			</Show>

			<Show when={editing()}>
				<box flexDirection="row" gap={2} paddingLeft={2} paddingTop={1}>
					<text color={theme.colors.success} onClick={saveEdit}>
						[Save]
					</text>
					<text color={theme.colors.error} onClick={() => setEditing(false)}>
						[Cancel]
					</text>
				</box>
			</Show>
		</box>
	)
}

function formatDuration(ts: number | undefined): string {
	if (!ts) return ""
	const diff = Date.now() - ts
	const seconds = Math.floor(diff / 1000)
	if (seconds < 60) return `${seconds}s ago`
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	return `${hours}h ago`
}
