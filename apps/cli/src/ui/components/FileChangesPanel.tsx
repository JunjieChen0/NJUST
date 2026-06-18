import { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"

import type { TUIMessage } from "../types.js"
import { useTheme } from "../theme.js"

interface FileChangesPanelProps {
	messages: TUIMessage[]
	onClose: () => void
}

interface FileChange {
	path: string
	added: number
	removed: number
	operations: number
}

/**
 * Aggregates file changes from tool messages and displays them grouped by file.
 */
export function FileChangesPanel({ messages, onClose }: FileChangesPanelProps) {
	const theme = useTheme()
	const fileChanges = useMemo(() => {
		const changes = new Map<string, FileChange>()

		for (const msg of messages) {
			if (msg.role !== "tool" || !msg.toolData) {
				continue
			}

			const { tool, path, diffStats } = msg.toolData

			if (!path) {
				continue
			}

			const isWriteOp =
				tool === "write_to_file" || tool === "writeToFile" || tool === "apply_diff" || tool === "applyDiff"

			if (!isWriteOp) {
				continue
			}

			const existing = changes.get(path) || { path, added: 0, removed: 0, operations: 0 }
			existing.operations += 1

			if (diffStats) {
				existing.added += diffStats.added
				existing.removed += diffStats.removed
			}

			changes.set(path, existing)
		}

		return Array.from(changes.values()).sort((a, b) => b.operations - a.operations)
	}, [messages])

	const [selectedIndex, setSelectedIndex] = useState(0)

	useInput(
		(_input, key) => {
			if (key.escape) {
				onClose()
				return
			}

			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : fileChanges.length - 1))
				return
			}

			if (key.downArrow) {
				setSelectedIndex((prev) => (prev < fileChanges.length - 1 ? prev + 1 : 0))
				return
			}
		},
		{ isActive: true },
	)

	if (fileChanges.length === 0) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.rooHeader} bold>
					File Changes
				</Text>
				<Text color={theme.dimText}>No file changes in this session.</Text>
				<Text color={theme.dimText}>Press Esc to close.</Text>
			</Box>
		)
	}

	const totalAdded = fileChanges.reduce((sum, f) => sum + f.added, 0)
	const totalRemoved = fileChanges.reduce((sum, f) => sum + f.removed, 0)
	const visibleCount = Math.min(fileChanges.length, 15)
	const visibleItems = fileChanges.slice(0, visibleCount)

	return (
		<Box flexDirection="column" padding={1}>
			<Box flexDirection="row">
				<Text color={theme.rooHeader} bold>
					File Changes
				</Text>
				<Text color={theme.dimText}>
					{" "}
					({fileChanges.length} files, +{totalAdded}/-{totalRemoved})
				</Text>
			</Box>
			<Box flexDirection="column" marginTop={1}>
				{visibleItems.map((file, index) => {
					const isSelected = index === selectedIndex
					return (
						<Box key={file.path}>
							<Text color={isSelected ? "cyan" : theme.text}>
								{isSelected ? "> " : "  "}
								{file.path}
							</Text>
							<Text color={theme.successColor}> +{file.added}</Text>
							<Text color={theme.errorColor}> -{file.removed}</Text>
							<Text color={theme.dimText}> ({file.operations} ops)</Text>
						</Box>
					)
				})}
			</Box>
			{fileChanges.length > visibleCount && (
				<Text color={theme.dimText}>... and {fileChanges.length - visibleCount} more</Text>
			)}
			<Text color={theme.dimText}>↑↓ navigate • Esc close</Text>
		</Box>
	)
}

export default FileChangesPanel
