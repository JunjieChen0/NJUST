import { memo } from "react"
import { Text, Box } from "ink"
import * as theme from "../theme.ts"
import { useTerminalSize } from "../hooks/TerminalSizeContext.tsx"
import MetricsDisplay from "./MetricsDisplay.tsx"
import type { TokenUsage } from "@njust-ai/types"

interface FooterProps {
	workspacePath: string
	tokenUsage?: TokenUsage | null
	contextWindow?: number
	mode: string
	nonInteractive?: boolean
	permissions?: number
	lspCount?: number
	mcpCount?: number
	mcpError?: boolean
	connected?: boolean
}

function Footer({
	workspacePath,
	tokenUsage,
	contextWindow,
	mode,
	nonInteractive,
	permissions = 0,
	lspCount = 0,
	mcpCount = 0,
	mcpError = false,
	connected = false,
}: FooterProps) {
	const { columns } = useTerminalSize()
	const homeDir = process.env.HOME || process.env.USERPROFILE || ""
	const displayPath = workspacePath.startsWith(homeDir) ? workspacePath.replace(homeDir, "~") : workspacePath

	return (
		<Box flexDirection="row" justifyContent="space-between" width={columns} flexShrink={0}>
			<Text color={theme.textMuted}>{displayPath}</Text>
			<Box flexDirection="row" gap={2} flexShrink={0}>
				{!connected && (
					<Text color={theme.text}>
						Get started <Text color={theme.textMuted}>/connect</Text>
					</Text>
				)}
				{connected && permissions > 0 && (
					<Text color={theme.warning}>
						<Text color={theme.warning}>△</Text> {permissions} Permission{permissions > 1 ? "s" : ""}
					</Text>
				)}
				{connected && (
					<Text color={theme.text}>
						<Text color={lspCount > 0 ? theme.success : theme.textMuted}>•</Text> {lspCount} LSP
					</Text>
				)}
				{connected && mcpCount > 0 && (
					<Text color={theme.text}>
						{mcpError ? <Text color={theme.error}>⊙ </Text> : <Text color={theme.success}>⊙ </Text>}
						{mcpCount} MCP
					</Text>
				)}
				{tokenUsage && contextWindow && contextWindow > 0 && (
					<MetricsDisplay tokenUsage={tokenUsage} contextWindow={contextWindow} />
				)}
				<Text color={theme.textMuted}>
					mode: {mode}
					{nonInteractive ? " (YOLO)" : ""} • /help
				</Text>
			</Box>
		</Box>
	)
}

export default memo(Footer)
