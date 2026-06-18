import { memo } from "react"
import { Box, Newline, Text } from "ink"

import type { ClineSay } from "@njust-ai/types"
import type { TUIMessage } from "../types.js"
import type { WebviewMessage } from "@njust-ai/types"
import { useTheme, getTheme } from "../theme.js"

import TodoDisplay from "./TodoDisplay.js"
import { getToolRenderer } from "./tools/index.js"
import { CheckpointActions } from "./CheckpointActions.js"
import { ToolStatusIndicator } from "./ToolStatusIndicator.js"
import { StreamingText } from "./StreamingText.js"

/**
 * Tool categories for styling
 */
type ToolCategory = "file" | "directory" | "search" | "command" | "mode" | "completion" | "other"

function getToolCategory(toolName: string): ToolCategory {
	const fileTools = ["readFile", "read_file", "writeToFile", "write_to_file", "applyDiff", "apply_diff"]
	const dirTools = ["listFiles", "list_files", "listFilesRecursive", "listFilesTopLevel"]
	const searchTools = ["searchFiles", "search_files"]
	const commandTools = ["executeCommand", "execute_command"]
	const modeTools = ["switchMode", "switch_mode", "newTask", "new_task"]
	const completionTools = ["attemptCompletion", "attempt_completion", "askFollowupQuestion", "ask_followup_question"]

	if (fileTools.includes(toolName)) return "file"
	if (dirTools.includes(toolName)) return "directory"
	if (searchTools.includes(toolName)) return "search"
	if (commandTools.includes(toolName)) return "command"
	if (modeTools.includes(toolName)) return "mode"
	if (completionTools.includes(toolName)) return "completion"
	return "other"
}

/**
 * Category colors for tool types — resolved at call time from active theme.
 */
function getCategoryColor(category: ToolCategory): string {
	const t = getTheme()
	const map: Record<ToolCategory, string> = {
		file: t.toolHeader,
		directory: t.toolHeader,
		search: t.warningColor,
		command: t.successColor,
		mode: t.userHeader,
		completion: t.successColor,
		other: t.toolHeader,
	}
	return map[category]
}

/**
 * Sanitize content for terminal display by:
 * - Replacing tab characters with spaces (tabs expand to variable widths in terminals)
 * - Stripping carriage returns that could cause display issues
 */
function sanitizeContent(text: string): string {
	return text.replace(/\t/g, "    ").replace(/\r/g, "")
}

/**
 * Truncate content for display, showing line count
 */
function truncateContent(
	content: string,
	maxLines: number = 10,
): { text: string; truncated: boolean; totalLines: number } {
	const lines = content.split("\n")
	const totalLines = lines.length

	if (lines.length <= maxLines) {
		return { text: content, truncated: false, totalLines }
	}

	const truncatedText = lines.slice(0, maxLines).join("\n")
	return { text: truncatedText, truncated: true, totalLines }
}

/**
 * Parse tool info from raw JSON content
 */
function parseToolInfo(content: string): Record<string, unknown> | null {
	try {
		return JSON.parse(content)
	} catch {
		return null
	}
}

/**
 * Render tool display component
 */
function ToolDisplay({ message }: { message: TUIMessage }) {
	const theme = useTheme()
	const toolName = message.toolName || "unknown"
	const category = getToolCategory(toolName)
	const categoryColor = getCategoryColor(category)

	// Try to parse the raw content for additional tool info
	const toolInfo = parseToolInfo(message.content || "")

	// Extract key fields from tool info
	const path = toolInfo?.path as string | undefined
	const isOutsideWorkspace = toolInfo?.isOutsideWorkspace as boolean | undefined
	const reason = toolInfo?.reason as string | undefined
	const rawContent = toolInfo?.content as string | undefined

	// Get the display output (formatted by App.tsx) - already sanitized
	const toolDisplayOutput = message.toolDisplayOutput ? sanitizeContent(message.toolDisplayOutput) : undefined

	// Sanitize raw content if present
	const sanitizedRawContent = rawContent ? sanitizeContent(rawContent) : undefined

	// Format the header
	const headerText = message.toolDisplayName || toolName

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Tool Header — includes lifecycle status indicator */}
			<Box flexDirection="row" gap={1}>
				<ToolStatusIndicator status={message.toolStatus} />
				<Text bold color={categoryColor}>
					{headerText}
				</Text>
			</Box>

			{/* Path indicator for file/directory operations */}
			{path && (
				<Box marginLeft={2}>
					<Text color={theme.dimText}>
						{category === "file" ? "file: " : category === "directory" ? "dir: " : "path: "}
					</Text>
					<Text color={theme.text} bold>
						{path}
					</Text>
					{isOutsideWorkspace && (
						<Text color={theme.warningColor} dimColor>
							{" (outside workspace)"}
						</Text>
					)}
				</Box>
			)}

			{/* Reason/explanation if present */}
			{reason && (
				<Box marginLeft={2}>
					<Text color={theme.dimText} italic>
						{reason}
					</Text>
				</Box>
			)}

			{/* Content display */}
			{(toolDisplayOutput || sanitizedRawContent) && (
				<Box flexDirection="column" marginLeft={2} marginTop={0}>
					{(() => {
						const contentToDisplay = toolDisplayOutput || sanitizedRawContent || ""
						const { text, truncated, totalLines } = truncateContent(contentToDisplay, 15)

						return (
							<>
								<Text color={theme.toolText}>{text}</Text>
								{truncated && (
									<Text color={theme.dimText} dimColor>
										{`... (${totalLines - 15} more lines)`}
									</Text>
								)}
							</>
						)
					})()}
				</Box>
			)}

			<Text>
				<Newline />
			</Text>
		</Box>
	)
}

interface ChatHistoryItemProps {
	message: TUIMessage
	sendToExtension?: ((msg: WebviewMessage) => void) | null
	workspacePath?: string
	/**
	 * When `true`, this is the most recent assistant message currently
	 * streaming. Used to enable the typewriter reveal in
	 * `<StreamingText>` for the live message only — historical messages
	 * render fully without stepping to avoid re-animating on every store
	 * update.
	 */
	isStreamingTarget?: boolean
}

/**
 * System event category for color-coded rendering.
 */
type SystemEventCategory = "error" | "warning" | "context" | "info"

function getSystemEventCategory(originalType: TUIMessage["originalType"]): SystemEventCategory {
	if (!originalType) return "info"
	const errorTypes: ClineSay[] = ["error", "diff_error", "rooignore_error", "condense_context_error"]
	const warningTypes: ClineSay[] = ["shell_integration_warning", "too_many_tools_warning"]
	const contextTypes: ClineSay[] = ["condense_context", "sliding_window_truncation"]
	if (errorTypes.includes(originalType as ClineSay)) return "error"
	if (warningTypes.includes(originalType as ClineSay)) return "warning"
	if (contextTypes.includes(originalType as ClineSay)) return "context"
	return "info"
}

function getSystemEventMeta(category: SystemEventCategory): { color: string; label: string } {
	const t = getTheme()
	const map: Record<SystemEventCategory, { color: string; label: string }> = {
		error: { color: t.errorColor, label: "✗ Error" },
		warning: { color: t.warningColor, label: "⚠ Warning" },
		context: { color: t.toolHeader, label: "⬇ Context" },
		info: { color: t.dimText, label: "• System" },
	}
	return map[category]
}

function ChatHistoryItem({ message, sendToExtension, workspacePath, isStreamingTarget }: ChatHistoryItemProps) {
	const theme = useTheme()
	const content = sanitizeContent(message.content || "...")

	switch (message.role) {
		case "user": {
			const badge = message.messageNumber ? <Text color={theme.dimText}>[{message.messageNumber}] </Text> : null
			return (
				<Box flexDirection="row" marginTop={1}>
					{/* OpenCode uses a green "+" prefix for user messages. */}
					<Text color={theme.successColor}>+ </Text>
					<Box flexDirection="column" flexGrow={1} paddingRight={1}>
						<Text color={theme.userText}>
							{badge}
							{content}
							<Newline />
						</Text>
					</Box>
				</Box>
			)
		}
		case "assistant": {
			// Only the latest streaming assistant message gets the
			// typewriter reveal. Historical messages render in full.
			const isStreaming = isStreamingTarget === true && message.partial === true
			return (
				<Box flexDirection="column" paddingLeft={3} marginTop={1}>
					{isStreaming ? (
						<StreamingText content={content} isStreaming={true} color={theme.rooText} />
					) : (
						<Text color={theme.rooText}>
							{content}
							<Newline />
						</Text>
					)}
				</Box>
			)
		}
		case "thinking": {
			// OpenCode-style "Thought: Xs" label derived from start/end ts.
			const start = message.thinkingStartTs
			const end = message.thinkingEndTs
			const durationMs = start && end ? end - start : undefined
			const durationLabel =
				durationMs !== undefined
					? durationMs < 1000
						? `${Math.max(1, Math.round(durationMs / 100) / 10)}s`
						: `${(durationMs / 1000).toFixed(1)}s`
					: undefined
			return (
				<Box flexDirection="column" marginTop={1}>
					{durationLabel && (
						<Box paddingLeft={2}>
							<Text color={theme.thinkingText} dimColor italic>
								Thought: {durationLabel}
							</Text>
						</Box>
					)}
					<Box flexDirection="row">
						<Text color={theme.thinkingHeader}>┃ </Text>
						<Box flexDirection="column" flexGrow={1}>
							<Text color={theme.thinkingText} dimColor italic>
								{content}
								<Newline />
							</Text>
						</Box>
					</Box>
				</Box>
			)
		}
		case "tool": {
			if (
				(message.toolName === "update_todo_list" || message.toolName === "updateTodoList") &&
				message.todos &&
				message.todos.length > 0
			) {
				return <TodoDisplay todos={message.todos} previousTodos={message.previousTodos} showProgress={true} />
			}

			if (message.toolName === "checkpoint" && message.toolData?.commitHash && sendToExtension && workspacePath) {
				return (
					<Box flexDirection="column" paddingLeft={3}>
						<Box flexDirection="row" gap={1}>
							<ToolStatusIndicator status={message.toolStatus} />
							<Text bold color={theme.toolHeader}>
								Checkpoint
							</Text>
						</Box>
						<Text color={theme.text}>{content}</Text>
						<CheckpointActions
							commitHash={message.toolData.commitHash}
							ts={message.toolData.ts ?? Date.now()}
							sendToExtension={sendToExtension}
							workspacePath={workspacePath}
						/>
						<Text>
							<Newline />
						</Text>
					</Box>
				)
			}

			if (message.toolData) {
				const ToolRenderer = getToolRenderer(message.toolData.tool)
				return <ToolRenderer toolData={message.toolData} rawContent={message.content} />
			}

			return <ToolDisplay message={message} />
		}
		case "system": {
			const category = getSystemEventCategory(message.originalType)
			const meta = getSystemEventMeta(category)

			let displayContent = content
			if (message.originalType === "too_many_tools_warning") {
				try {
					const data = JSON.parse(content) as {
						toolCount?: number
						serverCount?: number
						threshold?: number
					}
					if (data.toolCount !== undefined) {
						displayContent = `Too many MCP tools (${data.toolCount} tools from ${data.serverCount ?? 0} servers; threshold ${data.threshold ?? "?"}).`
					}
				} catch {
					// Fall back to raw content
				}
			}

			const isInProgress =
				message.partial &&
				(message.originalType === "condense_context" || message.originalType === "sliding_window_truncation")

			// Error-category system events get a left-bordered "card" so
			// they stand out from regular info lines (mirrors OpenCode's
			// BlockTool error styling, which uses a left border + panel
			// background).
			if (category === "error") {
				return (
					<Box
						flexDirection="column"
						paddingLeft={1}
						marginTop={1}
						marginLeft={3}
						borderStyle="bold"
						borderColor={meta.color}
						borderLeft
						borderRight={false}
						borderTop={false}
						borderBottom={false}>
						<Text bold color={meta.color}>
							{meta.label}
						</Text>
						{displayContent && displayContent !== "..." && (
							<Text color={meta.color}>
								{displayContent}
								<Newline />
							</Text>
						)}
					</Box>
				)
			}

			return (
				<Box flexDirection="column" paddingLeft={3} marginTop={1}>
					<Text bold color={meta.color}>
						{isInProgress ? `${meta.label} (in progress)...` : meta.label}
					</Text>
					{displayContent && displayContent !== "..." && (
						<Text color={meta.color}>
							{displayContent}
							<Newline />
						</Text>
					)}
				</Box>
			)
		}
		default:
			return null
	}
}

export default memo(ChatHistoryItem)
