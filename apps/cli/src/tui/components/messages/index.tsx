/**
 * Message Renderer - OpenTUI Native Implementation
 *
 * Renders chat messages using OpenTUI's native <markdown> and <code>
 * renderables (tree-sitter based syntax highlighting, reflow, scrolling).
 *
 * Supported message shapes:
 *   - User:     "▶ You" prefix + user content
 *   - Assistant: native markdown render of assistant text
 *   - Reasoning: collapsible panel (▶/▼) with markdown content
 *   - Tool:     routed to ToolRenderer
 *   - System:   muted info line
 *
 * Streaming: when `streaming` is true, the message renders with an
 * inline cursor block at the end of the latest segment.
 */

import { Show, For, createMemo } from "solid-js"
import { Dynamic } from "solid-js/web"
import type { ValidComponent } from "solid-js"
import { Text, Box, Markdown, Code, Spinner } from "../index.tsx"
import { useTheme } from "../../context/theme.tsx"
import type { TuiMessage } from "../../runtime/types.ts"
import { ToolRenderer } from "../tools/index.jsx"

// =============================================================================
// Message
// =============================================================================

export function MessageRenderer(props: { message: TuiMessage; streaming?: boolean }) {
	const { theme } = useTheme()
	const msg = props.message

	const roleConfig = {
		user: {
			color: theme.colors.primary,
			label: "You",
			icon: "▶",
		},
		assistant: {
			color: theme.colors.text,
			label: "Assistant",
			icon: "●",
		},
		system: {
			color: theme.colors.textMuted,
			label: "System",
			icon: "◆",
		},
		tool: {
			color: theme.colors.secondary,
			label: "Tool",
			icon: "▶",
		},
		reasoning: {
			color: theme.colors.warning,
			label: "Reasoning",
			icon: "◆",
		},
	}

	const config = roleConfig[msg.role] || roleConfig.assistant

	return (
		<Box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={0} paddingBottom={0}>
			{/* Role header */}
			<Box flexDirection="row" gap={1}>
				<Text color={config.color} bold>
					{config.icon} {config.label}
				</Text>
				<Show when={msg.createdAt}>
					<Text color={theme.colors.textMuted}>{formatTimestamp(msg.createdAt!)}</Text>
				</Show>
				<Show when={props.streaming}>
					<Spinner color={theme.colors.primary} />
				</Show>
			</Box>

			{/* Content - per role */}
			<Show when={msg.role === "tool"}>
				<ToolRenderer
					part={msg.part}
					toolData={msg.toolData as import("../tools/index.tsx").ToolData | undefined}
				/>
			</Show>

			<Show when={msg.role === "user"}>
				<Box paddingLeft={2}>
					<Text color={theme.colors.text}>{msg.content || ""}</Text>
					<Show when={props.streaming}>
						<Text backgroundColor={theme.colors.primary}> </Text>
					</Show>
				</Box>
			</Show>

			<Show when={msg.role === "assistant"}>
				<Box paddingLeft={2}>
					<Show when={msg.content} fallback={<Text color={theme.colors.textMuted}>...</Text>}>
						<MarkdownRenderer content={msg.content!} streaming={props.streaming} />
					</Show>
				</Box>
			</Show>

			<Show when={msg.role === "system"}>
				<Box paddingLeft={2}>
					<Text color={theme.colors.textMuted} dim>
						{msg.content || ""}
					</Text>
				</Box>
			</Show>
		</Box>
	)
}

// =============================================================================
// Markdown Renderer
// =============================================================================

export function MarkdownRenderer(props: { content: string; streaming?: boolean }) {
	const { theme } = useTheme()
	const segments = createMemo(() => parseMarkdown(props.content))

	return (
		<Box flexDirection="column">
			<For each={segments()}>
				{(segment) => {
					if (segment.type === "code") {
						return (
							<Box marginTop={0} marginBottom={1}>
								<Code language={segment.language}>{segment.content}</Code>
							</Box>
						)
					}
					if (segment.type === "heading") {
						return (
							<Box paddingTop={1}>
								<Text bold color="text">
									{segment.content}
								</Text>
							</Box>
						)
					}
					return (
						<Box>
							<Markdown>{segment.content}</Markdown>
						</Box>
					)
				}}
			</For>
			<Show when={props.streaming}>
				<Dynamic
					component={"text" as ValidComponent}
					fg={theme.colors.text}
					backgroundColor={theme.colors.text}>
					{" "}
				</Dynamic>
			</Show>
		</Box>
	)
}

// =============================================================================
// Markdown Parser
// =============================================================================

interface MarkdownSegment {
	type: "text" | "code" | "heading"
	content: string
	language?: string
}

function parseMarkdown(content: string): MarkdownSegment[] {
	const segments: MarkdownSegment[] = []
	const lines = content.split("\n")
	let currentBlock: string[] = []
	let inCodeBlock = false
	let codeLanguage: string | undefined

	for (const line of lines) {
		// Code block detection
		const codeBlockStart = line.match(/^```(\w*)$/)
		if (codeBlockStart && !inCodeBlock) {
			// Flush current text block
			if (currentBlock.length > 0) {
				segments.push({ type: "text", content: currentBlock.join("\n") })
				currentBlock = []
			}
			inCodeBlock = true
			codeLanguage = codeBlockStart[1] || undefined
			continue
		}

		if (line.trim() === "```" && inCodeBlock) {
			// End code block
			segments.push({
				type: "code",
				content: currentBlock.join("\n"),
				language: codeLanguage,
			})
			currentBlock = []
			inCodeBlock = false
			codeLanguage = undefined
			continue
		}

		if (inCodeBlock) {
			currentBlock.push(line)
		} else {
			// Heading detection
			const heading = line.match(/^(#{1,6})\s+(.*)$/)
			if (heading) {
				if (currentBlock.length > 0) {
					segments.push({ type: "text", content: currentBlock.join("\n") })
					currentBlock = []
				}
				segments.push({ type: "heading", content: heading[2] })
				continue
			}

			currentBlock.push(line)
		}
	}

	// Flush remaining
	if (currentBlock.length > 0) {
		segments.push({
			type: inCodeBlock ? "code" : "text",
			content: currentBlock.join("\n"),
			language: codeLanguage,
		})
	}

	return segments
}

// =============================================================================
// Helper
// =============================================================================

function formatTimestamp(ts: number): string {
	const date = new Date(ts)
	const hours = date.getHours().toString().padStart(2, "0")
	const minutes = date.getMinutes().toString().padStart(2, "0")
	return `${hours}:${minutes}`
}
