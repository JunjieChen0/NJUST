/**
 * Session Route - OpenCode-aligned Layout
 *
 * Layout (left → right):
 *   ┌─────────────────────────────────────┬───────────────┐
 *   │  StatusBar                          │               │
 *   ├─────────────────────────────────────┤  Sidebar      │
 *   │                                     │  (collapsible)│
 *   │  MessageList (scrollbox)            │               │
 *   │                                     │  - Model      │
 *   │                                     │  - Usage      │
 *   │                                     │  - Todos      │
 *   │                                     │  - Status     │
 *   ├─────────────────────────────────────┤               │
 *   │  Approval / Question (conditional)  │               │
 *   │  Prompt (sticky bottom)             │               │
 *   └─────────────────────────────────────┴───────────────┘
 *
 * - Sticky-bottom message scroll (OpenTUI scrollbox intrinsic)
 * - Responsive sidebar (toggle on narrow terminals)
 * - Focus isolation: prompt blurs when a dialog/approval is open
 */

import { createSignal, createMemo, For, Show, createEffect } from "solid-js"
import { Text, ScrollBox } from "../../components/index.tsx"
import { useTheme } from "../../context/theme.tsx"
import type { TuiSession, TuiMessage, TuiPlan } from "../../runtime/types.ts"
import { MessageRenderer } from "../../components/messages/index.tsx"
import { PlanCard } from "../../components/plan-card.tsx"
import { Sidebar } from "./sidebar.tsx"
import { Prompt } from "../../components/prompt/index.tsx"
import { createDefaultTriggers } from "../../components/prompt/autocomplete.tsx"

const defaultTriggers = createDefaultTriggers()

const NARROW_TERMINAL_WIDTH = 90
const SIDEBAR_WIDTH = 32

export interface SessionProps {
	session: TuiSession | null
	messages: TuiMessage[]
	onSendMessage: (text: string) => void
	onCancel?: () => void
	onShortcut?: (key: string, modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }) => boolean
	onApprove?: (requestId: string, always?: boolean) => void
	onReject?: (requestId: string) => void
	onAnswer?: (requestId: string, answer: string) => void
	pendingApproval?: {
		requestId: string
		ask: string
		toolName?: string
		path?: string
		command?: string
		serverName?: string
	} | null
	pendingQuestion?: {
		requestId: string
		question: string
		options?: string[]
	} | null
	isRunning?: boolean
	currentProvider?: string
	currentModel?: string
	currentMode?: string
	tokenUsage?: { total: number; context: number; cost?: number }
	todos?: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" }>
	autoApprovalEnabled?: boolean
	currentPlan?: TuiPlan | null
	onApprovePlan?: (planId: string) => void
	onExecutePlan?: (planId: string) => void
	onPausePlan?: (planId: string) => void
	onCancelPlan?: (planId: string) => void
	onSkipPlanStep?: (planId: string, stepId: string) => void
	onRegeneratePlanStep?: (planId: string, stepId: string) => void
	onEditPlanStep?: (planId: string, stepId: string, description: string) => void
	compact?: boolean
	showReasoning?: boolean
}

export function Session(props: SessionProps) {
	const [sidebarVisible, setSidebarVisible] = createSignal(true)
	const [terminalWidth, setTerminalWidth] = createSignal(120)

	// Track terminal width via the OpenTUI renderer (resize observer)
	createEffect(() => {
		if (typeof globalThis !== "undefined" && globalThis.process?.stdout?.columns) {
			setTerminalWidth(globalThis.process.stdout.columns)
		}
	})

	// Auto-collapse sidebar on narrow terminals
	const effectiveSidebarVisible = createMemo(() => {
		if (terminalWidth() < NARROW_TERMINAL_WIDTH) return false
		return sidebarVisible()
	})

	return (
		<box flexDirection="row" flexGrow={1}>
			{/* Main content area */}
			<box flexDirection="column" flexGrow={1}>
				{/* Status bar (top) */}
				<StatusBar
					session={props.session}
					isRunning={props.isRunning || false}
					sidebarVisible={effectiveSidebarVisible()}
					onToggleSidebar={() => setSidebarVisible(!sidebarVisible())}
				/>

				{/* Message area (sticky bottom) */}
				<ScrollBox flexGrow={1} stickyScroll={true}>
					<Show when={props.currentPlan}>
						<PlanCard
							plan={props.currentPlan!}
							onApprove={props.onApprovePlan}
							onExecute={props.onExecutePlan}
							onPause={props.onPausePlan}
							onCancel={props.onCancelPlan}
							onSkipStep={props.onSkipPlanStep}
							onRegenerateStep={props.onRegeneratePlanStep}
							onEditStep={props.onEditPlanStep}
						/>
					</Show>

					<For each={props.messages} fallback={<EmptyState />}>
						{(message) => (
							<MessageRenderer
								message={message}
								streaming={message.role === "assistant" && props.isRunning === true}
								compact={props.compact}
								showReasoning={props.showReasoning}
							/>
						)}
					</For>
				</ScrollBox>

				{/* Approval / Question (modal-style prompt replacement) */}
				<Show when={props.pendingApproval}>
					<ApprovalArea
						approval={props.pendingApproval!}
						onApprove={(always) => props.onApprove?.(props.pendingApproval!.requestId, always)}
						onReject={() => props.onReject?.(props.pendingApproval!.requestId)}
					/>
				</Show>
				<Show when={props.pendingQuestion && !props.pendingApproval}>
					<QuestionArea
						question={props.pendingQuestion!}
						onAnswer={(answer) => props.onAnswer?.(props.pendingQuestion!.requestId, answer)}
					/>
				</Show>

				{/* Prompt (sticky bottom) */}
				<Show when={!props.pendingApproval && !props.pendingQuestion}>
					<Prompt
						onSubmit={props.onSendMessage}
						onCancel={props.onCancel}
						onShortcut={props.onShortcut}
						placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
						disabled={props.isRunning}
						triggers={defaultTriggers}
						metadata={{
							provider: props.currentProvider,
							model: props.currentModel,
							mode: props.currentMode,
							isRunning: props.isRunning,
							tokenUsage: props.tokenUsage,
						}}
					/>
				</Show>
			</box>

			{/* Sidebar */}
			<Show when={effectiveSidebarVisible()}>
				<Sidebar
					session={props.session}
					provider={props.currentProvider}
					model={props.currentModel}
					mode={props.currentMode}
					tokenUsage={props.tokenUsage}
					todos={props.todos}
					isRunning={props.isRunning || false}
					autoApprovalEnabled={props.autoApprovalEnabled}
					width={SIDEBAR_WIDTH}
					currentPlan={props.currentPlan}
				/>
			</Show>
		</box>
	)
}

// =============================================================================
// Status Bar
// =============================================================================

function StatusBar(props: {
	session: TuiSession | null
	isRunning: boolean
	sidebarVisible: boolean
	onToggleSidebar: () => void
}) {
	const { theme } = useTheme()
	return (
		<box
			flexDirection="row"
			paddingLeft={1}
			paddingRight={1}
			border={["bottom"]}
			borderColor={theme.colors.borderSubtle}
			backgroundColor={theme.colors.backgroundElement}
			gap={1}>
			<Text color={theme.colors.primary} bold onClick={props.onToggleSidebar}>
				{props.sidebarVisible ? "◧" : "◨"}
			</Text>
			<Text color={theme.colors.text} bold>
				{props.session?.title || "New Session"}
			</Text>
			<Show when={props.isRunning}>
				<Text color={theme.colors.warning}>● Running</Text>
			</Show>
			<Show when={!props.isRunning}>
				<Text color={theme.colors.textMuted}>○ Idle</Text>
			</Show>
			<Show when={props.session?.status}>
				<Text color={theme.colors.textMuted}>[{props.session!.status}]</Text>
			</Show>
		</box>
	)
}

// =============================================================================
// Empty State
// =============================================================================

function EmptyState() {
	const { theme } = useTheme()
	return (
		<box paddingLeft={2} paddingRight={2} paddingTop={2}>
			<Text color={theme.colors.textMuted}>Start typing below to begin a conversation…</Text>
		</box>
	)
}

// =============================================================================
// Approval Area (in-flow prompt replacement)
// =============================================================================

function ApprovalArea(props: {
	approval: {
		requestId: string
		ask: string
		toolName?: string
		path?: string
		command?: string
		serverName?: string
	}
	onApprove: (always?: boolean) => void
	onReject: () => void
}) {
	const { theme } = useTheme()
	const [showPreview, setShowPreview] = createSignal(false)

	const summary = () => {
		if (props.approval.command) return `Execute command: ${props.approval.command}`
		if (props.approval.path) return `Edit file: ${props.approval.path}`
		if (props.approval.serverName) return `MCP ${props.approval.serverName}/${props.approval.toolName || "tool"}`
		if (props.approval.toolName) return `Run tool: ${props.approval.toolName}`
		return props.approval.ask
	}

	return (
		<box
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			paddingTop={1}
			paddingBottom={1}
			border={true}
			borderColor={theme.colors.warning}
			backgroundColor={theme.colors.backgroundElement}
			gap={1}>
			<box flexDirection="row" gap={1}>
				<Text color={theme.colors.warning} bold>
					⚠ Approval required:
				</Text>
				<Text color={theme.colors.text}>{summary()}</Text>
			</box>
			<Show when={props.approval.path || props.approval.command}>
				<Text color={theme.colors.primary} onClick={() => setShowPreview(!showPreview())} dim>
					{showPreview() ? "▾ Hide preview" : "▸ Show preview"}
				</Text>
				<Show when={showPreview()}>
					<box paddingLeft={2}>
						<Text color={theme.colors.textMuted}>
							{props.approval.path
								? `Pattern: ${props.approval.path}`
								: `Command: ${props.approval.command}`}
						</Text>
					</box>
				</Show>
			</Show>
			<box flexDirection="row" gap={2}>
				<Text color={theme.colors.success} bold onClick={() => props.onApprove(false)}>
					[Y] Approve
				</Text>
				<Text color={theme.colors.warning} bold onClick={() => props.onApprove(true)}>
					[A] Always
				</Text>
				<Text color={theme.colors.error} bold onClick={props.onReject}>
					[N] Reject
				</Text>
			</box>
		</box>
	)
}

// =============================================================================
// Question Area
// =============================================================================

function QuestionArea(props: {
	question: { requestId: string; question: string; options?: string[] }
	onAnswer: (answer: string) => void
}) {
	const { theme } = useTheme()
	const [selected, setSelected] = createSignal<number | null>(null)
	return (
		<box
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			paddingTop={1}
			paddingBottom={1}
			border={true}
			borderColor={theme.colors.secondary}
			backgroundColor={theme.colors.backgroundElement}>
			<Text color={theme.colors.secondary} bold>
				? {props.question.question}
			</Text>
			<Show when={props.question.options && props.question.options.length > 0}>
				<box flexDirection="column" paddingTop={1}>
					<For each={props.question.options}>
						{(option, index) => (
							<box flexDirection="row" gap={1}>
								<Text
									color={selected() === index() ? theme.colors.success : theme.colors.textMuted}
									onClick={() => {
										setSelected(index())
										props.onAnswer(option)
									}}
									bold>
									{selected() === index() ? "●" : "○"} {option}
								</Text>
							</box>
						)}
					</For>
				</box>
			</Show>
			<Show when={!props.question.options || props.question.options.length === 0}>
				<box paddingTop={1}>
					<Prompt onSubmit={props.onAnswer} placeholder="Type your answer…" />
				</box>
			</Show>
		</box>
	)
}
