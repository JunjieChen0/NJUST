import { memo } from "react"
import { Text, Box } from "ink"
import * as theme from "../theme.ts"
import { useTerminalSize } from "../hooks/TerminalSizeContext.tsx"
import MetricsDisplay from "./MetricsDisplay.tsx"
import type { TokenUsage } from "@njust-ai/types"

interface StatusBarProps {
	workspacePath: string
	tokenUsage?: TokenUsage | null
	contextWindow?: number
	mode: string
	nonInteractive?: boolean
}

function StatusBar({ workspacePath, tokenUsage, contextWindow, mode, nonInteractive }: StatusBarProps) {
	const { columns } = useTerminalSize()
	const homeDir = process.env.HOME || process.env.USERPROFILE || ""
	const displayPath = workspacePath.startsWith(homeDir) ? workspacePath.replace(homeDir, "~") : workspacePath

	const rightText = `mode: ${mode}${nonInteractive ? " (YOLO)" : ""} • /help`

	return (
		<Box flexDirection="column" width={columns} flexShrink={0}>
			<Text color={theme.borderColor}>{"─".repeat(columns)}</Text>
			<Box width={columns} justifyContent="space-between">
				<Text color={theme.dimText}>{displayPath}</Text>
				<Box>
					{tokenUsage && contextWindow && contextWindow > 0 && (
						<>
							<MetricsDisplay tokenUsage={tokenUsage} contextWindow={contextWindow} />
							<Text color={theme.dimText}> • </Text>
						</>
					)}
					<Text color={theme.dimText}>{rightText}</Text>
				</Box>
			</Box>
		</Box>
	)
}

export default memo(StatusBar)
