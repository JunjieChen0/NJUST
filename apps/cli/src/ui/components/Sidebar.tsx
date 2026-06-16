import { memo } from "react"
import { Text, Box } from "ink"
import * as theme from "../theme.ts"
import { useTerminalSize } from "../hooks/TerminalSizeContext.tsx"

interface SidebarProps {
	workspacePath: string
	model: string
	provider: string
	mode: string
	reasoningEffort?: string
	nonInteractive?: boolean
	version: string
	user?: { name: string } | null
}

function Sidebar({
	workspacePath,
	model,
	provider,
	mode,
	reasoningEffort,
	nonInteractive,
	version,
	user,
}: SidebarProps) {
	const { rows } = useTerminalSize()
	const homeDir = process.env.HOME || process.env.USERPROFILE || ""
	const displayPath = workspacePath.startsWith(homeDir) ? workspacePath.replace(homeDir, "~") : workspacePath

	return (
		<Box
			flexDirection="column"
			width={42}
			height={rows - 2}
			backgroundColor={theme.backgroundPanel}
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			paddingRight={2}
			flexShrink={0}>
			<Box flexDirection="column" gap={1}>
				<Text color={theme.text} bold>
					Session
				</Text>
				{user && <Text color={theme.textMuted}>Welcome, {user.name}</Text>}
				<Text color={theme.textMuted}>
					Model:{" "}
					<Text color={theme.text}>
						{provider}:{model}
					</Text>
				</Text>
				<Text color={theme.textMuted}>
					Mode: <Text color={theme.text}>{mode}</Text>
					{nonInteractive && <Text color={theme.warning}> (YOLO)</Text>}
				</Text>
				{reasoningEffort && (
					<Text color={theme.textMuted}>
						Reasoning: <Text color={theme.text}>{reasoningEffort}</Text>
					</Text>
				)}
			</Box>

			<Box height={1} />

			<Box flexDirection="column" gap={1}>
				<Text color={theme.text} bold>
					Workspace
				</Text>
				<Text color={theme.textMuted}>{displayPath}</Text>
			</Box>

			<Box flexGrow={1} />

			<Box flexDirection="column" gap={1}>
				<Text color={theme.border}>{"─".repeat(36)}</Text>
				<Text color={theme.textMuted}>
					<Text color={theme.success}>●</Text> NJUST_AI CLI v{version}
				</Text>
			</Box>
		</Box>
	)
}

export default memo(Sidebar)
