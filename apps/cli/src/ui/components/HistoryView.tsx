import { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { WebviewMessage } from "@njust-ai/types"
import Fuzzysort from "fuzzysort"

import type { TaskHistoryItem } from "../types.js"
import * as theme from "../theme.js"

interface HistoryViewProps {
	taskHistory: TaskHistoryItem[]
	workspacePath: string
	sendToExtension: ((msg: WebviewMessage) => void) | null
	onClose: () => void
	onResumeTask: (taskId: string) => void
}

type SortMode = "newest" | "oldest" | "most-expensive" | "most-tokens"

/**
 * Full history view that replaces the main session view.
 *
 * Features:
 * - Search filtering
 * - Sorting (newest/oldest/most expensive/most tokens)
 * - Multi-select + batch delete with confirmation
 * - Enter to resume a task
 */
export function HistoryView({ taskHistory, workspacePath, sendToExtension, onClose, onResumeTask }: HistoryViewProps) {
	const [searchQuery, setSearchQuery] = useState("")
	const [sortMode, setSortMode] = useState<SortMode>("newest")
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
	const [isSearchMode, setIsSearchMode] = useState(false)

	// Filter by workspace
	const workspaceTasks = useMemo(() => {
		return taskHistory.filter((item) => {
			if (!item.workspace) return true
			return item.workspace === workspacePath
		})
	}, [taskHistory, workspacePath])

	// Apply search filter
	const filteredTasks = useMemo(() => {
		if (!searchQuery) {
			return workspaceTasks
		}

		const results = Fuzzysort.go(searchQuery, workspaceTasks, {
			keys: ["task"],
			threshold: -10000,
		})

		return results.map((result) => result.obj)
	}, [workspaceTasks, searchQuery])

	// Apply sorting
	const sortedTasks = useMemo(() => {
		const sorted = [...filteredTasks]

		switch (sortMode) {
			case "newest":
				sorted.sort((a, b) => b.ts - a.ts)
				break
			case "oldest":
				sorted.sort((a, b) => a.ts - b.ts)
				break
			case "most-expensive":
				sorted.sort((a, b) => (b.totalCost || 0) - (a.totalCost || 0))
				break
			case "most-tokens":
				sorted.sort((a, b) => (b.tokensIn || 0) + (b.tokensOut || 0) - ((a.tokensIn || 0) + (a.tokensOut || 0)))
				break
		}

		return sorted
	}, [filteredTasks, sortMode])

	useInput(
		(input, key) => {
			if (showDeleteConfirm) {
				if (key.escape) {
					setShowDeleteConfirm(false)
					return
				}

				if (key.return && sendToExtension) {
					const ids = Array.from(selectedIds)
					sendToExtension({ type: "deleteMultipleTasksWithIds", ids })
					setSelectedIds(new Set())
					setShowDeleteConfirm(false)
					return
				}
				return
			}

			if (isSearchMode) {
				if (key.escape) {
					setIsSearchMode(false)
					return
				}

				if (key.return) {
					setIsSearchMode(false)
					return
				}

				if (key.backspace || key.delete) {
					setSearchQuery((prev) => prev.slice(0, -1))
					return
				}

				if (!key.ctrl && !key.meta && input.length === 1) {
					setSearchQuery((prev) => prev + input)
				}
				return
			}

			// Normal mode
			if (key.escape) {
				if (selectedIds.size > 0) {
					setSelectedIds(new Set())
					return
				}
				onClose()
				return
			}

			if (key.return) {
				const task = sortedTasks[selectedIndex]
				if (task) {
					onResumeTask(task.id)
				}
				return
			}

			if (input === "/" || input === "s" || input === "S") {
				setIsSearchMode(true)
				return
			}

			if (input === "o" || input === "O") {
				const modes: SortMode[] = ["newest", "oldest", "most-expensive", "most-tokens"]
				const currentIndex = modes.indexOf(sortMode)
				const nextIndex = (currentIndex + 1) % modes.length
				const nextMode = modes[nextIndex]
				if (nextMode) {
					setSortMode(nextMode)
				}
				return
			}

			if (input === " ") {
				const task = sortedTasks[selectedIndex]
				if (task) {
					const newSelected = new Set(selectedIds)
					if (newSelected.has(task.id)) {
						newSelected.delete(task.id)
					} else {
						newSelected.add(task.id)
					}
					setSelectedIds(newSelected)
				}
				return
			}

			if ((input === "d" || input === "D") && selectedIds.size > 0) {
				setShowDeleteConfirm(true)
				return
			}

			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : sortedTasks.length - 1))
				return
			}

			if (key.downArrow) {
				setSelectedIndex((prev) => (prev < sortedTasks.length - 1 ? prev + 1 : 0))
				return
			}
		},
		{ isActive: true },
	)

	if (showDeleteConfirm) {
		const count = selectedIds.size
		const previewIds = Array.from(selectedIds).slice(0, 10)
		const previewTasks = previewIds
			.map((id) => sortedTasks.find((t) => t.id === id))
			.filter(Boolean) as TaskHistoryItem[]

		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.warningColor} bold>
					Delete {count} task{count > 1 ? "s" : ""}?
				</Text>
				<Box flexDirection="column" marginTop={1}>
					{previewTasks.map((task) => (
						<Text key={task.id} color={theme.text}>
							• {task.task.substring(0, 60)}
							{task.task.length > 60 ? "..." : ""}
						</Text>
					))}
					{count > 10 && <Text color={theme.dimText}>... and {count - 10} more</Text>}
				</Box>
				<Text color={theme.dimText}>Enter to confirm • Esc to cancel</Text>
			</Box>
		)
	}

	if (isSearchMode) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.rooHeader} bold>
					Search History
				</Text>
				<Box marginTop={1}>
					<Text color={theme.text}>Query: {searchQuery}</Text>
				</Box>
				<Text color={theme.dimText}>Enter to apply • Esc to cancel</Text>
			</Box>
		)
	}

	const sortLabels: Record<SortMode, string> = {
		newest: "Newest first",
		oldest: "Oldest first",
		"most-expensive": "Most expensive",
		"most-tokens": "Most tokens",
	}

	const visibleCount = Math.min(sortedTasks.length, 15)
	const visibleTasks = sortedTasks.slice(0, visibleCount)

	return (
		<Box flexDirection="column" padding={1}>
			<Box flexDirection="row">
				<Text color={theme.rooHeader} bold>
					Task History
				</Text>
				<Text color={theme.dimText}>
					{" "}
					({sortedTasks.length} tasks, sorted by {sortLabels[sortMode]})
				</Text>
			</Box>
			{searchQuery && <Text color={theme.dimText}>Filter: "{searchQuery}"</Text>}
			{selectedIds.size > 0 && (
				<Text color={theme.warningColor}>{selectedIds.size} selected (press d to delete)</Text>
			)}
			<Box flexDirection="column" marginTop={1}>
				{visibleTasks.map((task, index) => {
					const isSelected = index === selectedIndex
					const isChecked = selectedIds.has(task.id)
					const date = new Date(task.ts).toLocaleDateString()
					const cost = task.totalCost ? `$${task.totalCost.toFixed(2)}` : ""

					return (
						<Box key={task.id}>
							<Text color={isSelected ? "cyan" : theme.text}>
								{isSelected ? "> " : "  "}
								{isChecked ? "[x] " : "[ ] "}
								{task.task.substring(0, 50)}
								{task.task.length > 50 ? "..." : ""}
							</Text>
							<Text color={theme.dimText}>
								{" "}
								{date}
								{cost && ` ${cost}`}
							</Text>
						</Box>
					)
				})}
			</Box>
			{sortedTasks.length > visibleCount && (
				<Text color={theme.dimText}>... and {sortedTasks.length - visibleCount} more</Text>
			)}
			<Text color={theme.dimText}>
				↑↓ navigate • Enter resume • Space select • / search • o sort • d delete • Esc close
			</Text>
		</Box>
	)
}

export default HistoryView
