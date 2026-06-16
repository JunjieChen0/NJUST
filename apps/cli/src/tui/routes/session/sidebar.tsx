/**
 * Sidebar - OpenCode-aligned
 *
 * Right-rail sidebar showing:
 *   - Provider / Model / Mode
 *   - Token usage (total / context / cost)
 *   - TODO list
 *   - Status (running / idle)
 *
 * The sidebar is collapsible; parent controls visibility via the
 * `sidebarVisible` flag (which itself auto-hides on narrow terminals).
 */

import { For, Show } from "solid-js"
import { Text } from "../../components/index.tsx"
import { useTheme } from "../../context/theme.tsx"

import type { TuiSession } from "../../runtime/types.ts"

export interface SidebarProps {
	session: TuiSession | null
	provider?: string
	model?: string
	mode?: string
	tokenUsage?: { total: number; context: number; cost?: number }
	todos?: Array<{ id: string; content: string; status: "pending" | "in_progress" | "completed" }>
	isRunning: boolean
	width: number
}

export function Sidebar(props: SidebarProps) {
	const { theme } = useTheme()
	return (
		<box
			flexDirection="column"
			width={props.width}
			border={["left"]}
			borderColor={theme.colors.borderSubtle}
			backgroundColor={theme.colors.backgroundElement}>
			{/* Provider / Model / Mode */}
			<Section title="Model">
				<KV k="Provider" v={props.provider || props.session?.provider || "njust-ai"} />
				<KV k="Model" v={props.model || props.session?.model || "default"} />
				<KV k="Mode" v={props.mode || props.session?.mode || "code"} />
			</Section>

			{/* Token usage */}
			<Section title="Usage">
				<Show when={props.tokenUsage} fallback={<Text color={theme.colors.textMuted}>No data</Text>}>
					<KV k="Total" v={String(props.tokenUsage!.total)} />
					<KV k="Context" v={String(props.tokenUsage!.context)} />
					<Show when={props.tokenUsage!.cost !== undefined}>
						<KV
							k="Cost"
							v={`$${(props.tokenUsage!.cost ?? 0).toFixed(4)}`}
							valueColor={theme.colors.success}
						/>
					</Show>
				</Show>
			</Section>

			{/* TODO list */}
			<Section title="Todo">
				<Show
					when={props.todos && props.todos.length > 0}
					fallback={<Text color={theme.colors.textMuted}>No todos</Text>}>
					<For each={props.todos ?? []}>
						{(todo) => (
							<box flexDirection="row" gap={1}>
								<Text
									color={
										todo.status === "completed"
											? theme.colors.success
											: todo.status === "in_progress"
												? theme.colors.warning
												: theme.colors.textMuted
									}>
									{todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "●" : "○"}
								</Text>
								<Text
									color={todo.status === "completed" ? theme.colors.textMuted : theme.colors.text}
									dim={todo.status === "completed"}>
									{todo.content}
								</Text>
							</box>
						)}
					</For>
				</Show>
			</Section>

			{/* Status */}
			<Section title="Status">
				<box flexDirection="row" gap={1}>
					<Text color={props.isRunning ? theme.colors.warning : theme.colors.textMuted}>
						{props.isRunning ? "●" : "○"}
					</Text>
					<Text color={props.isRunning ? theme.colors.warning : theme.colors.textMuted}>
						{props.isRunning ? "Running" : "Idle"}
					</Text>
				</box>
			</Section>
		</box>
	)
}

// =============================================================================
// Sub-components
// =============================================================================

import { type JSX } from "solid-js"

function Section(props: { title: string; children: JSX.Element }) {
	const { theme } = useTheme()
	return (
		<box
			flexDirection="column"
			paddingLeft={1}
			paddingRight={1}
			paddingTop={1}
			paddingBottom={1}
			border={["bottom"]}
			borderColor={theme.colors.borderSubtle}>
			<Text bold underline color={theme.colors.textMuted}>
				{props.title}
			</Text>
			<box flexDirection="column" paddingTop={1}>
				{props.children}
			</box>
		</box>
	)
}

function KV(props: { k: string; v: string; valueColor?: string }) {
	const { theme } = useTheme()
	return (
		<box flexDirection="row" gap={1}>
			<Text color={theme.colors.textMuted}>{props.k}:</Text>
			<Text color={props.valueColor ?? theme.colors.text}>{props.v}</Text>
		</box>
	)
}
