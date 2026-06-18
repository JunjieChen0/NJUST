import { memo } from "react"
import { Box, Text } from "ink"

import { useTheme } from "../theme.js"

export interface ContextSidebarProps {
	/** Context-window usage as a fraction in [0,1]. Undefined hides the row. */
	contextFraction?: number
	/** Number of MCP servers connected. Hidden when 0/undefined. */
	mcpCount?: number
	/** True when at least one MCP server is in `failed` state. */
	mcpHasError?: boolean
	/** Number of LSP servers active. Hidden when 0/undefined. */
	lspCount?: number
}

/**
 * `<ContextSidebar>` — narrow right-hand panel mirroring OpenCode's
 * right column: context-window usage %, MCP/LSP counts, and a
 * `ctrl+o commands` hint at the bottom.
 *
 * Rendered to the right of the chat history on wide terminals and hidden
 * when the terminal is too narrow (handled by the caller).
 */
function ContextSidebar({ contextFraction, mcpCount, mcpHasError, lspCount }: ContextSidebarProps) {
	const theme = useTheme()
	const hasMcp = (mcpCount ?? 0) > 0
	const hasLsp = (lspCount ?? 0) > 0
	const pct = contextFraction !== undefined && contextFraction >= 0 ? Math.round(contextFraction * 100) : undefined
	const isWarning = pct !== undefined && pct >= 80

	return (
		<Box flexDirection="column" paddingLeft={1} flexShrink={0}>
			{pct !== undefined && (
				<Text color={isWarning ? theme.warningColor : theme.textMuted}>ctx {pct}%</Text>
			)}
			{hasMcp && (
				<Text color={theme.textMuted}>
					<Text color={mcpHasError ? theme.errorColor : theme.successColor}>●</Text> mcp {mcpCount}
				</Text>
			)}
			{hasLsp && (
				<Text color={theme.textMuted}>
					<Text color={theme.successColor}>●</Text> lsp {lspCount}
				</Text>
			)}
			<Box flexGrow={1} />
			<Text color={theme.textMuted}>ctrl+o</Text>
			<Text color={theme.textMuted}>commands</Text>
		</Box>
	)
}

export default memo(ContextSidebar)
