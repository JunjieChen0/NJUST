import { memo } from "react"
import { Text, Box } from "ink"

import type { TokenUsage } from "@njust-ai/types"

import { NJUST_AI_LOGO } from "@/types/constants.js"

import { ExtensionHostOptions } from "@/agent/index.js"
import { useTerminalSize } from "../hooks/TerminalSizeContext.js"
import { useTheme } from "../theme.js"

import MetricsDisplay from "./MetricsDisplay.js"

interface HeaderProps extends ExtensionHostOptions {
	version: string
	tokenUsage?: TokenUsage | null
	contextWindow?: number
	condenseInProgress?: boolean
	onCondense?: () => void
	currentApiConfigName?: string | null
}

function Header({
	workspacePath,
	user: _user,
	provider,
	model,
	mode,
	reasoningEffort: _reasoningEffort,
	nonInteractive: _nonInteractive,
	version: _version,
	tokenUsage,
	contextWindow,
	condenseInProgress,
	onCondense,
	currentApiConfigName: _currentApiConfigName,
}: HeaderProps) {
	const theme = useTheme()
	const { columns } = useTerminalSize()

	const homeDir = process.env.HOME || process.env.USERPROFILE || ""
	const displayPath = workspacePath.startsWith(homeDir) ? workspacePath.replace(homeDir, "~") : workspacePath

	const contextPercent =
		tokenUsage && contextWindow && contextWindow > 0 ? tokenUsage.contextTokens / contextWindow : 0
	const showCondenseHint = contextPercent >= 0.8 && !condenseInProgress && onCondense

	return (
		<Box flexDirection="column" width={columns}>
			<Box flexDirection="row">
				<Text color={theme.borderColor}>┃ </Text>
				<Box flexDirection="column" flexGrow={1}>
					{NJUST_AI_LOGO.map((line, i) => (
						<Text key={i} color={i === 0 ? theme.primary : theme.text} bold={i === 1}>
							{line}
						</Text>
					))}
					<Text color={theme.dimText}> {displayPath}</Text>
				</Box>
				{tokenUsage && contextWindow && contextWindow > 0 && (
					<Box flexDirection="column" alignItems="flex-end">
						<MetricsDisplay
							tokenUsage={tokenUsage}
							contextWindow={contextWindow}
							condenseInProgress={condenseInProgress}
						/>
					</Box>
				)}
			</Box>
			{showCondenseHint && (
				<Text color={theme.warningColor}>
					{" "}
					┃ Context high • press Ctrl+R to condense
				</Text>
			)}
			<Text color={theme.backgroundElement}>{"▀".repeat(columns)}</Text>
		</Box>
	)
}

export default memo(Header)
