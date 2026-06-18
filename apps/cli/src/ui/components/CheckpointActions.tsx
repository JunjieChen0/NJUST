import { useState } from "react"
import { Box, Text, useInput } from "ink"
import type { WebviewMessage } from "@njust-ai/types"
import { spawn } from "child_process"

import { useTheme } from "../theme.js"

interface CheckpointActionsProps {
	commitHash: string
	ts: number
	sendToExtension: ((msg: WebviewMessage) => void) | null
	workspacePath: string
}

export function CheckpointActions({ commitHash, ts, sendToExtension, workspacePath }: CheckpointActionsProps) {
	const theme = useTheme()
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [showingConfirm, setShowingConfirm] = useState(false)

	const diffOptions = [
		{ label: "Diff vs previous", mode: "full" as const },
		{ label: "Diff vs initial", mode: "from-init" as const },
		{ label: "Diff vs current", mode: "to-current" as const },
		{ label: "Restore checkpoint", mode: "restore" as const },
	]

	useInput(
		(_input, key) => {
			if (showingConfirm) {
				if (key.return) {
					sendToExtension?.({
						type: "checkpointRestore",
						payload: { ts, commitHash, mode: "restore" },
					})
					setShowingConfirm(false)
				}
				if (key.escape) {
					setShowingConfirm(false)
				}
				return
			}

			if (key.downArrow) {
				setSelectedIndex((prev) => (prev < diffOptions.length - 1 ? prev + 1 : 0))
				return
			}
			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : diffOptions.length - 1))
				return
			}
			if (key.return) {
				const option = diffOptions[selectedIndex]
				if (!option) {
					return
				}

				if (option.mode === "restore") {
					setShowingConfirm(true)
					return
				}

				sendToExtension?.({
					type: "checkpointDiff",
					payload: { ts, commitHash, mode: option.mode },
				})

				// Best-effort external diff viewer
				const proc = spawn("code", ["--diff", commitHash], {
					cwd: workspacePath,
					detached: true,
					stdio: "ignore",
				})
				proc.on("error", () => {
					const fallback = spawn("git", ["diff", commitHash], {
						cwd: workspacePath,
						stdio: "inherit",
					})
					fallback.on("error", () => undefined)
				})
			}
		},
		{ isActive: true },
	)

	if (showingConfirm) {
		return (
			<Box flexDirection="column" marginLeft={2}>
				<Text color={theme.warningColor}>
					Restore checkpoint {commitHash.slice(0, 7)}? This cannot be undone.
				</Text>
				<Text color={theme.dimText}>Enter to confirm • Esc to cancel</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" marginLeft={2}>
			{diffOptions.map((option, index) => {
				const isSelected = index === selectedIndex
				return (
					<Text key={option.mode} color={isSelected ? "cyan" : theme.dimText}>
						{isSelected ? "> " : "  "}
						{option.label}
					</Text>
				)
			})}
		</Box>
	)
}

export default CheckpointActions
