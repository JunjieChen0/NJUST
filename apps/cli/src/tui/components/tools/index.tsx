/**
 * Tool Renderers - OpenTUI Native Implementation
 */

import { createSignal, Show, For, type JSX, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"
import { useTheme } from "../../context/theme.tsx"
import type { TuiPart } from "../../runtime/types.ts"

interface BoxProps {
	children?: JSX.Element
	flexDirection?: "row" | "column"
	padding?: number
	paddingTop?: number
	paddingLeft?: number
	paddingRight?: number
	paddingBottom?: number
	margin?: number
	marginTop?: number
	marginBottom?: number
	border?: boolean
	borderColor?: string
	backgroundColor?: string
	gap?: number
	flexGrow?: number
}

function Box(props: BoxProps) {
	const { theme } = useTheme()
	return (
		<Dynamic
			component="box"
			borderColor={theme.colors.border}
			backgroundColor={theme.colors.background}
			{...props}
		/>
	)
}

interface TextProps {
	children?: JSX.Element
	color?: string
	bold?: boolean
	dim?: boolean
	onClick?: () => void
	paddingTop?: number
}

function Text(props: TextProps) {
	const { theme } = useTheme()
	return (
		<Dynamic
			component={"text" as ValidComponent}
			fg={props.color ?? theme.colors.text}
			bold={props.bold}
			dim={props.dim}
			onClick={props.onClick}
			paddingTop={props.paddingTop}>
			{props.children}
		</Dynamic>
	)
}

export interface ToolData {
	path?: string
	regex?: string
	command?: string
	serverName?: string
	toolName?: string
	action?: string
	url?: string
	mode_from?: string
	mode_to?: string
	result?: string
	lineCount?: number
	diffStats?: { additions?: number; deletions?: number }
	todos?: Array<{ content: string; status: string }>
}

export interface ToolRendererProps {
	part?: TuiPart
	toolData?: ToolData
}

export function ToolRenderer(props: ToolRendererProps) {
	const part = props.part
	if (!part) return null
	const toolName = part.toolName || ""
	switch (toolName) {
		case "read_file":
			return <FileReadTool {...props} />
		case "write_to_file":
			return <FileWriteTool {...props} />
		case "apply_diff":
			return <ApplyDiffTool {...props} />
		case "search_files":
		case "list_files":
			return <SearchTool {...props} />
		case "execute_command":
			return <ExecuteCommandTool {...props} />
		case "use_mcp_tool":
		case "access_mcp_resource":
			return <McpTool {...props} />
		case "browser_action":
			return <BrowserTool {...props} />
		case "update_todos":
		case "user_edit_todos":
			return <TodoUpdateTool {...props} />
		case "switch_mode":
			return <ModeSwitchTool {...props} />
		case "attempt_completion":
			return <CompletionTool {...props} />
		default:
			return <GenericTool {...props} />
	}
}

function StatusBadge(props: { status: string }) {
	const { theme } = useTheme()
	const statusConfig: Record<string, { color: string; icon: string }> = {
		pending: { color: theme.colors.textMuted, icon: "o" },
		streaming: { color: theme.colors.warning, icon: "o" },
		completed: { color: theme.colors.success, icon: "x" },
		failed: { color: theme.colors.error, icon: "x" },
	}
	const config = statusConfig[props.status] ?? statusConfig.pending
	return (
		<Text color={config.color} bold>
			{config.icon} [{props.status}]
		</Text>
	)
}

function toolData(props: ToolRendererProps): ToolData {
	return props.toolData ?? {}
}

function path(data: ToolData, part: TuiPart): string | undefined {
	return data.path || (part.toolParams as ToolData)?.path
}

function command(data: ToolData, part: TuiPart): string | undefined {
	return data.command || (part.toolParams as ToolData)?.command
}

export function FileReadTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<Box flexDirection="row">
				<StatusBadge status={part.status} />
				<Text color={theme.colors.primary} bold>
					{" "}
					Read File
				</Text>
			</Box>
			<Show when={path(data, part)}>
				<Text color={theme.colors.textMuted}> Path: {path(data, part)}</Text>
			</Show>
			<Show when={part.content}>
				<Box flexDirection="column" paddingTop={1}>
					<Text color={theme.colors.textMuted}>Content:</Text>
					<Text color={theme.colors.text}>{part.content}</Text>
				</Box>
			</Show>
		</Box>
	)
}

export function FileWriteTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	const [showContent, setShowContent] = createSignal(false)
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<Box flexDirection="row">
				<StatusBadge status={part.status} />
				<Text color={theme.colors.secondary} bold>
					{" "}
					Write File
				</Text>
			</Box>
			<Show when={path(data, part)}>
				<Text color={theme.colors.textMuted}> Path: {path(data, part)}</Text>
			</Show>
			<Show when={data.lineCount}>
				<Text color={theme.colors.textMuted}> Lines: {data.lineCount}</Text>
			</Show>
			<Show when={part.content}>
				<Text color={theme.colors.primary} onClick={() => setShowContent(!showContent())}>
					{showContent() ? "Hide content" : "Show content"}
				</Text>
				<Show when={showContent()}>
					<Text color={theme.colors.text}>{part.content}</Text>
				</Show>
			</Show>
		</Box>
	)
}

export function ApplyDiffTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<Box flexDirection="row">
				<StatusBadge status={part.status} />
				<Text color={theme.colors.warning} bold>
					{" "}
					Apply Diff
				</Text>
			</Box>
			<Show when={path(data, part)}>
				<Text color={theme.colors.textMuted}> Path: {path(data, part)}</Text>
			</Show>
			<Show when={data.diffStats}>
				<Text color={theme.colors.textMuted}>
					{"  "}+{data.diffStats?.additions ?? 0} -{data.diffStats?.deletions ?? 0}
				</Text>
			</Show>
			<Show when={part.toolError}>
				<Text color={theme.colors.error}> Error: {part.toolError}</Text>
			</Show>
		</Box>
	)
}

export function SearchTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<Box flexDirection="row">
				<StatusBadge status={part.status} />
				<Text color={theme.colors.primary} bold>
					{" "}
					Search
				</Text>
			</Box>
			<Show when={data.regex || path(data, part)}>
				<Text color={theme.colors.textMuted}>
					{"  "}Pattern: {data.regex || path(data, part)}
				</Text>
			</Show>
			<Show when={path(data, part)}>
				<Text color={theme.colors.textMuted}> Path: {path(data, part)}</Text>
			</Show>
			<Show when={part.content}>
				<Text color={theme.colors.text}>{part.content}</Text>
			</Show>
		</Box>
	)
}

export function ExecuteCommandTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	const [showOutput, setShowOutput] = createSignal(false)
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<Box flexDirection="row">
				<StatusBadge status={part.status} />
				<Text color={theme.colors.warning} bold>
					{" "}
					Execute Command
				</Text>
			</Box>
			<Show when={command(data, part)}>
				<Box flexDirection="row" paddingTop={1}>
					<Text color={theme.colors.textMuted}> $ </Text>
					<Text color={theme.colors.text} bold>
						{command(data, part)}
					</Text>
				</Box>
			</Show>
			<Show when={part.content}>
				<Text color={theme.colors.primary} onClick={() => setShowOutput(!showOutput())}>
					{showOutput() ? "Hide output" : "Show output"}
				</Text>
				<Show when={showOutput()}>
					<Text color={theme.colors.textMuted}>{part.content}</Text>
				</Show>
			</Show>
			<Show when={part.toolError}>
				<Text color={theme.colors.error}> Error: {part.toolError}</Text>
			</Show>
		</Box>
	)
}

export function McpTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<Box flexDirection="row">
				<StatusBadge status={part.status} />
				<Text color={theme.colors.secondary} bold>
					{" "}
					MCP Tool
				</Text>
			</Box>
			<Show when={data.serverName}>
				<Text color={theme.colors.textMuted}> Server: {data.serverName}</Text>
			</Show>
			<Show when={data.toolName || part.toolName}>
				<Text color={theme.colors.textMuted}> Tool: {data.toolName || part.toolName}</Text>
			</Show>
			<Show when={part.content}>
				<Text color={theme.colors.text}>{part.content}</Text>
			</Show>
		</Box>
	)
}

export function BrowserTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<Box flexDirection="row">
				<StatusBadge status={part.status} />
				<Text color={theme.colors.primary} bold>
					{" "}
					Browser
				</Text>
			</Box>
			<Show when={data.action || (part.toolParams as ToolData)?.action}>
				<Text color={theme.colors.textMuted}>
					Action: {data.action || (part.toolParams as ToolData)?.action}
				</Text>
			</Show>
			<Show when={data.url}>
				<Text color={theme.colors.primary}> URL: {data.url}</Text>
			</Show>
			<Show when={part.content}>
				<Text color={theme.colors.text}>{part.content}</Text>
			</Show>
		</Box>
	)
}

export function TodoUpdateTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	const todos = data.todos ?? []
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<Box flexDirection="row">
				<StatusBadge status={part.status} />
				<Text color={theme.colors.primary} bold>
					{" "}
					Todo Update
				</Text>
			</Box>
			<Show when={todos.length > 0}>
				<Box flexDirection="column" paddingTop={1}>
					{
						<For each={todos}>
							{(todo) => {
								const color =
									todo.status === "completed"
										? theme.colors.success
										: todo.status === "in_progress"
											? theme.colors.warning
											: theme.colors.textMuted
								const textColor =
									todo.status === "completed" ? theme.colors.textMuted : theme.colors.text
								const icon =
									todo.status === "completed" ? "x" : todo.status === "in_progress" ? ">" : "o"
								return (
									<Box flexDirection="row">
										<Text color={color}>{icon}</Text>
										<Text color={textColor}> {todo.content}</Text>
									</Box>
								)
							}}
						</For>
					}
				</Box>
			</Show>
		</Box>
	)
}

export function ModeSwitchTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<Box flexDirection="row">
				<StatusBadge status={part.status} />
				<Text color={theme.colors.secondary} bold>
					{" "}
					Mode Switch
				</Text>
			</Box>
			<Show when={data.mode_from || data.mode_to}>
				<Text color={theme.colors.textMuted}>
					{"  "}
					{data.mode_from || "?"} {"->"} {data.mode_to || "?"}
				</Text>
			</Show>
		</Box>
	)
}

export function CompletionTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	return (
		<Box flexDirection="column" padding={2} margin={1} border={true} borderColor={theme.colors.success}>
			<StatusBadge status={part.status} />
			<Text color={theme.colors.success} bold>
				{" "}
				Task Completed
			</Text>
			<Show when={part.content || data.result}>
				<Text color={theme.colors.text} paddingTop={1}>
					{part.content || data.result}
				</Text>
			</Show>
		</Box>
	)
}

export function GenericTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const part = props.part!
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<Box flexDirection="row">
				<StatusBadge status={part.status} />
				<Text color={theme.colors.textMuted} bold>
					{" "}
					{part.toolName || "Tool"}
				</Text>
			</Box>
			<Show when={part.content}>
				<Text color={theme.colors.text}>{part.content}</Text>
			</Show>
			<Show when={part.toolError}>
				<Text color={theme.colors.error}>Error: {part.toolError}</Text>
			</Show>
		</Box>
	)
}
