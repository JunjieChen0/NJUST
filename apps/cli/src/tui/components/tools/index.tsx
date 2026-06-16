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
	diff?: string
	originalContent?: string
	content?: string
	diffStats?: { additions?: number; deletions?: number }
	todos?: Array<{ content: string; status: string }>
	batchDiffs?: Array<{
		path: string
		content: string
		changeCount: number
		diffStats?: { added: number; removed: number }
		diffs?: Array<{ content: string; startLine?: number }>
	}>
}

export interface ToolRendererProps {
	part?: TuiPart
	toolData?: ToolData
	compact?: boolean
}

export function ToolRenderer(props: ToolRendererProps) {
	const part = props.part
	if (!part) return null
	const toolName = normalizeToolName(part.toolName || "")
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

function normalizeToolName(toolName: string): string {
	const mapping: Record<string, string> = {
		readFile: "read_file",
		newFileCreated: "write_to_file",
		appliedDiff: "apply_diff",
		editedExistingFile: "apply_diff",
		searchFiles: "search_files",
		listFilesTopLevel: "list_files",
		listFilesRecursive: "list_files",
		switchMode: "switch_mode",
		updateTodoList: "update_todos",
		web_search: "web_search",
		web_fetch: "web_fetch",
	}
	return mapping[toolName] || toolName
}

function CollapsibleContent(props: { content: string; maxLines?: number; defaultExpanded?: boolean }) {
	const { theme } = useTheme()
	const maxLines = props.maxLines ?? 10
	const lines = props.content.split("\n")
	const [expanded, setExpanded] = createSignal(props.defaultExpanded ?? lines.length <= maxLines)

	if (lines.length <= maxLines) {
		return (
			<Box flexDirection="column">
				<Text color={theme.colors.text}>{props.content}</Text>
			</Box>
		)
	}

	const visibleLines = expanded() ? lines : lines.slice(0, maxLines)
	const hiddenCount = lines.length - maxLines

	return (
		<Box flexDirection="column">
			<Text color={theme.colors.text}>{visibleLines.join("\n")}</Text>
			<Text color={theme.colors.primary} onClick={() => setExpanded(!expanded())}>
				{expanded() ? "Show less" : `Show ${hiddenCount} more line${hiddenCount === 1 ? "" : "s"}`}
			</Text>
		</Box>
	)
}

function CompactCollapsibleContent(props: { content: string; compact?: boolean; defaultExpanded?: boolean }) {
	return (
		<CollapsibleContent
			content={props.content}
			maxLines={props.compact ? 3 : 10}
			defaultExpanded={props.defaultExpanded}
		/>
	)
}

interface DiffLine {
	type: "header" | "context" | "add" | "remove"
	text: string
}

function parseDiffLines(diff: string): DiffLine[] {
	if (!diff.trim()) return []
	return diff.split("\n").map((line) => {
		if (line.startsWith("@@")) {
			return { type: "header", text: line }
		}
		if (line.startsWith("+")) {
			return { type: "add", text: line.slice(1) }
		}
		if (line.startsWith("-")) {
			return { type: "remove", text: line.slice(1) }
		}
		return { type: "context", text: line.startsWith(" ") ? line.slice(1) : line }
	})
}

interface HunkRange {
	index: number
	start: number
	end: number
	header: string
}

function findHunks(lines: DiffLine[]): HunkRange[] {
	const hunks: HunkRange[] = []
	let current: HunkRange | null = null
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		if (line.type === "header") {
			if (current) hunks.push({ ...current, end: i - 1 })
			current = { index: hunks.length, start: i, end: i, header: line.text }
		}
	}
	if (current) hunks.push({ ...current, end: lines.length - 1 })
	return hunks
}

function DiffViewer(props: { diff: string; originalContent?: string; newContent?: string }) {
	const { theme } = useTheme()
	const [mode, setMode] = createSignal<"unified" | "split">("unified")
	const lines = () => parseDiffLines(props.diff)
	const hunks = () => findHunks(lines())
	const [currentHunk, setCurrentHunk] = createSignal(0)

	const colorFor = (type: DiffLine["type"]) => {
		switch (type) {
			case "add":
				return theme.colors.success
			case "remove":
				return theme.colors.error
			case "header":
				return theme.colors.secondary
			default:
				return theme.colors.textMuted
		}
	}
	const prefixFor = (type: DiffLine["type"]) => {
		switch (type) {
			case "add":
				return "+"
			case "remove":
				return "-"
			case "header":
				return "@"
			default:
				return " "
		}
	}

	const hasHunks = () => hunks().length > 0
	const hunkLabel = () => `Hunk ${currentHunk() + 1}/${hunks().length}`

	function nextHunk() {
		setCurrentHunk((i) => Math.min(i + 1, Math.max(0, hunks().length - 1)))
	}

	function prevHunk() {
		setCurrentHunk((i) => Math.max(i - 1, 0))
	}

	return (
		<Box flexDirection="column" border={true} borderColor={theme.colors.borderSubtle}>
			<Box
				flexDirection="row"
				paddingLeft={1}
				paddingRight={1}
				backgroundColor={theme.colors.backgroundElement}
				gap={2}>
				<Text
					color={theme.colors.primary}
					bold
					onClick={() => setMode(mode() === "unified" ? "split" : "unified")}>
					[{mode() === "unified" ? "Unified" : "Split"}]
				</Text>
				<Show when={hasHunks()}>
					<Text color={theme.colors.textMuted}>{hunkLabel()}</Text>
					<Text color={theme.colors.primary} onClick={prevHunk}>
						[← Prev]
					</Text>
					<Text color={theme.colors.primary} onClick={nextHunk}>
						[Next →]
					</Text>
				</Show>
			</Box>
			<Show when={hasHunks()} fallback={<EmptyDiff />}>
				<Show
					when={mode() === "unified"}
					fallback={
						<SplitDiffView
							lines={lines()}
							colorFor={colorFor}
							currentHunk={currentHunk()}
							hunks={hunks()}
						/>
					}>
					<UnifiedDiffView
						lines={lines()}
						colorFor={colorFor}
						prefixFor={prefixFor}
						currentHunk={currentHunk()}
						hunks={hunks()}
					/>
				</Show>
			</Show>
		</Box>
	)
}

function EmptyDiff() {
	const { theme } = useTheme()
	return (
		<Box flexDirection="column" padding={1} backgroundColor={theme.colors.backgroundElement}>
			<Text color={theme.colors.textMuted}>No diff content to display.</Text>
		</Box>
	)
}

function UnifiedDiffView(props: {
	lines: DiffLine[]
	colorFor: (type: DiffLine["type"]) => string
	prefixFor: (type: DiffLine["type"]) => string
	currentHunk: number
	hunks: HunkRange[]
}) {
	const hunk = props.hunks[props.currentHunk]
	const lines = hunk ? props.lines.slice(hunk.start, hunk.end + 1) : props.lines
	return (
		<Box flexDirection="column" paddingLeft={1} paddingRight={1}>
			<For each={lines}>
				{(line) => (
					<Text color={props.colorFor(line.type)}>
						{props.prefixFor(line.type)}
						{line.text}
					</Text>
				)}
			</For>
		</Box>
	)
}

function SplitDiffView(props: {
	lines: DiffLine[]
	colorFor: (type: DiffLine["type"]) => string
	currentHunk: number
	hunks: HunkRange[]
}) {
	const { theme } = useTheme()
	const hunk = props.hunks[props.currentHunk]
	const lines = hunk ? props.lines.slice(hunk.start, hunk.end + 1) : props.lines
	const rows = lines.map((line) => {
		if (line.type === "add") {
			return { left: null, right: line }
		}
		if (line.type === "remove") {
			return { left: line, right: null }
		}
		return { left: line, right: line }
	})

	return (
		<Box flexDirection="column" paddingLeft={1} paddingRight={1}>
			<For each={rows}>
				{(row) => (
					<Box flexDirection="row">
						<Box flexGrow={1} width="50%" border={["right"]} borderColor={theme.colors.borderSubtle}>
							{row.left ? (
								<Text color={props.colorFor(row.left.type)}>{row.left.text}</Text>
							) : (
								<Text color={theme.colors.backgroundElement}> </Text>
							)}
						</Box>
						<Box flexGrow={1} width="50%" paddingLeft={1}>
							{row.right ? (
								<Text color={props.colorFor(row.right.type)}>{row.right.text}</Text>
							) : (
								<Text color={theme.colors.backgroundElement}> </Text>
							)}
						</Box>
					</Box>
				)}
			</For>
		</Box>
	)
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

function ToolHeader(props: {
	status: string
	title: string
	path?: string
	command?: string
	serverName?: string
	toolName?: string
}) {
	const { theme } = useTheme()
	return (
		<Box flexDirection="column" gap={1}>
			<Box flexDirection="row">
				<StatusBadge status={props.status} />
				<Text color={theme.colors.text} bold>
					{" "}
					{props.title}
				</Text>
			</Box>
			<Show when={props.path}>
				<Text color={theme.colors.textMuted}> Path: {props.path}</Text>
			</Show>
			<Show when={props.command}>
				<Box flexDirection="row">
					<Text color={theme.colors.textMuted}>$ </Text>
					<Text color={theme.colors.text} bold>
						{props.command}
					</Text>
				</Box>
			</Show>
			<Show when={props.serverName}>
				<Text color={theme.colors.textMuted}> Server: {props.serverName}</Text>
			</Show>
			<Show when={props.toolName}>
				<Text color={theme.colors.textMuted}> Tool: {props.toolName}</Text>
			</Show>
		</Box>
	)
}

export function FileReadTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<ToolHeader status={part.status} title="Read File" path={path(data, part)} />
			<Show when={part.content}>
				<Box flexDirection="column" paddingTop={1}>
					<CompactCollapsibleContent content={part.content || ""} compact={props.compact} />
				</Box>
			</Show>
		</Box>
	)
}

export function FileWriteTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<ToolHeader status={part.status} title="Write File" path={path(data, part)} />
			<Show when={data.lineCount}>
				<Text color={theme.colors.textMuted}> Lines: {data.lineCount}</Text>
			</Show>
			<Show when={part.content}>
				<CompactCollapsibleContent content={part.content || ""} compact={props.compact} />
			</Show>
		</Box>
	)
}

export function ApplyDiffTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	const diffText = data.diff || (part.toolResult as ToolData)?.diff || part.content || ""
	const additions = data.diffStats?.additions ?? 0
	const deletions = data.diffStats?.deletions ?? 0
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<ToolHeader status={part.status} title="Apply Diff" path={path(data, part)} />
			<Show when={additions > 0 || deletions > 0}>
				<Text color={theme.colors.textMuted}>
					<Text color={theme.colors.success}>+{additions}</Text>{" "}
					<Text color={theme.colors.error}>-{deletions}</Text>
				</Text>
			</Show>
			<Show when={diffText}>
				<Box flexDirection="column" paddingTop={1}>
					<DiffViewer diff={diffText} originalContent={data.originalContent} newContent={data.content} />
				</Box>
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
	const pattern = data.regex || path(data, part)
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<ToolHeader status={part.status} title="Search" path={path(data, part)} />
			<Show when={pattern}>
				<Text color={theme.colors.textMuted}> Pattern: {pattern}</Text>
			</Show>
			<Show when={part.content}>
				<CompactCollapsibleContent content={part.content || ""} compact={props.compact} />
			</Show>
		</Box>
	)
}

export function ExecuteCommandTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const data = toolData(props)
	const part = props.part!
	const cmd = command(data, part)
	const hasError = !!part.toolError
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<ToolHeader status={part.status} title="Execute Command" command={cmd} />
			<Show when={part.content}>
				<CompactCollapsibleContent
					content={part.content || ""}
					compact={props.compact}
					defaultExpanded={hasError}
				/>
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
	const toolName = data.toolName || part.toolName
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<ToolHeader status={part.status} title="MCP Tool" serverName={data.serverName} toolName={toolName} />
			<Show when={part.content}>
				<CompactCollapsibleContent content={part.content || ""} compact={props.compact} />
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
			<ToolHeader status={part.status} title="Browser" />
			<Show when={data.action || (part.toolParams as ToolData)?.action}>
				<Text color={theme.colors.textMuted}>
					Action: {data.action || (part.toolParams as ToolData)?.action}
				</Text>
			</Show>
			<Show when={data.url}>
				<Text color={theme.colors.primary}> URL: {data.url}</Text>
			</Show>
			<Show when={part.content}>
				<CompactCollapsibleContent content={part.content || ""} compact={props.compact} />
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
			<ToolHeader status={part.status} title="Mode Switch" />
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
			<ToolHeader status={part.status} title="Task Completed" />
			<Show when={part.content || data.result}>
				<CompactCollapsibleContent content={part.content || data.result || ""} compact={props.compact} />
			</Show>
		</Box>
	)
}

export function GenericTool(props: ToolRendererProps) {
	const { theme } = useTheme()
	const part = props.part!
	const hasError = !!part.toolError
	return (
		<Box flexDirection="column" padding={1} margin={1} border={true} borderColor={theme.colors.borderSubtle}>
			<ToolHeader status={part.status} title={part.toolName || "Tool"} />
			<Show when={part.content}>
				<CompactCollapsibleContent
					content={part.content || ""}
					compact={props.compact}
					defaultExpanded={hasError}
				/>
			</Show>
			<Show when={part.toolError}>
				<Text color={theme.colors.error}>Error: {part.toolError}</Text>
			</Show>
		</Box>
	)
}
