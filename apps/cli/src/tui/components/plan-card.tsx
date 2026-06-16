import { Show, For, createSignal } from "solid-js"
import { useTheme } from "../context/theme.tsx"
import type { TuiPlan, TuiPlanStep } from "../runtime/types.ts"

export interface PlanCardProps {
	plan: TuiPlan
	onApprove?: (planId: string) => void
	onExecute?: (planId: string) => void
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
					{props.plan.status === "completed" ? "✓" : props.plan.status === "failed" ? "✗" : "◎"}
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
							<box flexDirection="row" gap={1} paddingY={1}>
								<text color={stepStatusColor[step.status]} bold>
									{stepStatusIcon[step.status]}
								</text>
								<box flexDirection="column" flexGrow={1}>
									<text color={theme.colors.text}>{step.description}</text>
									<text color={theme.colors.textMuted}>
										Step {step.index + 1} · {step.mode}
										<Show when={step.result}> · {step.result}</Show>
										<Show when={step.error}> · Error: {step.error}</Show>
									</text>
								</box>
							</box>
						)}
					</For>
				</box>
			</Show>

			<Show when={isDraft}>
				<box flexDirection="row" gap={2} paddingTop={1}>
					<text color={theme.colors.success} bold onClick={() => props.onApprove?.(props.plan.id)}>
						[Y] Approve
					</text>
					<text color={theme.colors.error} bold onClick={() => props.onExecute?.(props.plan.id)}>
						[E] Execute
					</text>
				</box>
			</Show>
		</box>
	)
}
