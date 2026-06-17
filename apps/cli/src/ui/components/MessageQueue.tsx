import { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { WebviewMessage } from "@njust-ai/types"

import { useCLIStore } from "../store.js"
import * as theme from "../theme.js"

interface MessageQueueProps {
	sendToExtension: ((msg: WebviewMessage) => void) | null
}

/**
 * Inline queued message list rendered above the prompt.
 *
 * Allows editing and removing queued follow-up messages while a task
 * is running. When a message is edited, the extension is notified so
 * the queue stays in sync.
 */
export function MessageQueue({ sendToExtension }: MessageQueueProps) {
	const { queuedMessages, removeQueuedMessage, editQueuedMessage } = useCLIStore()
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [editText, setEditText] = useState("")

	const sorted = useMemo(() => {
		return [...queuedMessages].sort((a, b) => a.timestamp - b.timestamp)
	}, [queuedMessages])

	useInput(
		(input, key) => {
			if (editingId !== null) {
				if (key.return) {
					const trimmed = editText.trim()
					if (trimmed) {
						editQueuedMessage(editingId, trimmed)
						sendToExtension?.({ type: "editQueuedMessage", text: editingId, editedMessageContent: trimmed })
					} else {
						removeQueuedMessage(editingId)
						sendToExtension?.({ type: "removeQueuedMessage", text: editingId })
					}
					setEditingId(null)
					setEditText("")
					return
				}
				if (key.escape) {
					setEditingId(null)
					setEditText("")
				}
				if (key.backspace || key.delete) {
					setEditText((prev) => prev.slice(0, -1))
				}
				if (!key.ctrl && !key.meta && input.length === 1) {
					setEditText((prev) => prev + input)
				}
				return
			}

			if (sorted.length === 0) {
				return
			}

			if (key.downArrow) {
				setSelectedIndex((prev) => (prev < sorted.length - 1 ? prev + 1 : 0))
				return
			}
			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : sorted.length - 1))
				return
			}
			if (key.return) {
				const msg = sorted[selectedIndex]
				if (msg) {
					setEditingId(msg.id)
					setEditText(msg.text)
				}
				return
			}
			if (input === "d" || input === "D") {
				const msg = sorted[selectedIndex]
				if (msg) {
					removeQueuedMessage(msg.id)
					sendToExtension?.({ type: "removeQueuedMessage", text: msg.id })
				}
				return
			}
		},
		{ isActive: true },
	)

	if (queuedMessages.length === 0) {
		return null
	}

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={theme.dimText}>Queued messages:</Text>
			{sorted.map((msg, index) => {
				const isSelected = index === selectedIndex
				const isEditing = editingId === msg.id

				return (
					<Box key={msg.id} flexDirection="row">
						<Text color={isSelected ? "cyan" : theme.dimText}>
							{isSelected ? "> " : "  "}
							{isEditing ? <Text color={theme.text}>{editText}</Text> : msg.text}
						</Text>
					</Box>
				)
			})}
			{editingId === null && <Text color={theme.dimText}>↑↓ navigate • Enter edit • D delete</Text>}
		</Box>
	)
}

export default MessageQueue
