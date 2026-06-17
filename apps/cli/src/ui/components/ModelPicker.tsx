import { useMemo, useState } from "react"
import { Box, Text, useInput } from "ink"
import type { ProviderSettingsEntry, WebviewMessage } from "@njust-ai/types"

import * as theme from "../theme.js"

interface ModelPickerProps {
	currentApiConfigName: string | null
	listApiConfigMeta: ProviderSettingsEntry[]
	sendToExtension: ((msg: WebviewMessage) => void) | null
	onClose: () => void
}

interface PickerItem {
	key: string
	label: string
	name: string
	isCreateNew?: boolean
}

type Mode = "list" | "create" | "rename" | "deleteConfirm"

/**
 * Inline API configuration profile picker with CRUD support.
 *
 * - Enter: switch to selected profile
 * - n: create new profile
 * - r: rename selected profile
 * - d: delete selected profile (with confirmation)
 */
export function ModelPicker({ currentApiConfigName, listApiConfigMeta, sendToExtension, onClose }: ModelPickerProps) {
	const items = useMemo<PickerItem[]>(() => {
		const profileItems = listApiConfigMeta.map((entry) => ({
			key: entry.id,
			label: entry.name,
			name: entry.name,
		}))

		return [{ key: "__create__", label: "+ Create new profile", name: "", isCreateNew: true }, ...profileItems]
	}, [listApiConfigMeta])

	const startIndex = useMemo(() => {
		if (!currentApiConfigName || items.length <= 1) {
			return 1 // Skip "create new" item
		}
		const found = items.findIndex((item) => item.name === currentApiConfigName)
		return found === -1 ? 1 : found
	}, [currentApiConfigName, items])

	const [selectedIndex, setSelectedIndex] = useState(startIndex)
	const [mode, setMode] = useState<Mode>("list")
	const [inputText, setInputText] = useState("")
	const [deleteTarget, setDeleteTarget] = useState<PickerItem | null>(null)

	useInput(
		(input, key) => {
			if (mode === "create" || mode === "rename") {
				if (key.escape) {
					setMode("list")
					setInputText("")
					return
				}

				if (key.return) {
					const trimmed = inputText.trim()
					if (trimmed && sendToExtension) {
						if (mode === "create") {
							sendToExtension({ type: "upsertApiConfiguration", text: trimmed })
						} else if (mode === "rename" && deleteTarget) {
							sendToExtension({
								type: "renameApiConfiguration",
								text: deleteTarget.name,
								editedMessageContent: trimmed,
							})
						}
					}
					setMode("list")
					setInputText("")
					setDeleteTarget(null)
					return
				}

				if (key.backspace || key.delete) {
					setInputText((prev) => prev.slice(0, -1))
					return
				}

				if (!key.ctrl && !key.meta && input.length === 1) {
					setInputText((prev) => prev + input)
				}
				return
			}

			if (mode === "deleteConfirm") {
				if (key.escape) {
					setMode("list")
					setDeleteTarget(null)
					return
				}

				if (key.return && deleteTarget && sendToExtension) {
					sendToExtension({ type: "deleteApiConfiguration", text: deleteTarget.name })
					setMode("list")
					setDeleteTarget(null)
					return
				}
				return
			}

			// List mode
			if (key.escape) {
				onClose()
				return
			}

			if (key.return) {
				const selected = items[selectedIndex]
				if (selected?.isCreateNew) {
					setMode("create")
					setInputText("")
					return
				}
				if (selected && sendToExtension) {
					sendToExtension({ type: "loadApiConfiguration", text: selected.name })
				}
				onClose()
				return
			}

			if (input === "n" || input === "N") {
				setMode("create")
				setInputText("")
				return
			}

			if ((input === "r" || input === "R") && items[selectedIndex] && !items[selectedIndex]?.isCreateNew) {
				setMode("rename")
				setInputText(items[selectedIndex]?.name || "")
				setDeleteTarget(items[selectedIndex] || null)
				return
			}

			if ((input === "d" || input === "D") && items[selectedIndex] && !items[selectedIndex]?.isCreateNew) {
				setMode("deleteConfirm")
				setDeleteTarget(items[selectedIndex] || null)
				return
			}

			if (key.upArrow) {
				setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1))
				return
			}

			if (key.downArrow) {
				setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0))
				return
			}
		},
		{ isActive: true },
	)

	if (mode === "create") {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.rooHeader} bold>
					Create New Profile
				</Text>
				<Box marginTop={1}>
					<Text color={theme.text}>Name: {inputText}</Text>
				</Box>
				<Text color={theme.dimText}>Enter to create • Esc to cancel</Text>
			</Box>
		)
	}

	if (mode === "rename") {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.rooHeader} bold>
					Rename Profile
				</Text>
				<Box marginTop={1}>
					<Text color={theme.text}>New name: {inputText}</Text>
				</Box>
				<Text color={theme.dimText}>Enter to rename • Esc to cancel</Text>
			</Box>
		)
	}

	if (mode === "deleteConfirm" && deleteTarget) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.warningColor} bold>
					Delete Profile
				</Text>
				<Box marginTop={1}>
					<Text color={theme.text}>Delete profile '{deleteTarget.name}'? This action cannot be undone.</Text>
				</Box>
				<Text color={theme.dimText}>Enter to confirm • Esc to cancel</Text>
			</Box>
		)
	}

	// List mode
	if (items.length === 0) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color={theme.dimText}>No API profiles available.</Text>
				<Text color={theme.dimText}>Press Esc to close.</Text>
			</Box>
		)
	}

	const visibleCount = Math.min(items.length, 10)
	const visibleItems = items.slice(0, visibleCount)

	return (
		<Box flexDirection="column" padding={1}>
			<Text color={theme.rooHeader} bold>
				API Profiles
			</Text>
			<Box flexDirection="column" marginTop={1}>
				{visibleItems.map((item, index) => {
					const isSelected = index === selectedIndex
					const isActive = item.name === currentApiConfigName

					return (
						<Box key={item.key}>
							<Text color={isSelected ? "cyan" : theme.dimText}>
								{isSelected ? "> " : "  "}
								{item.label}
								{isActive && <Text color={theme.successColor}> (active)</Text>}
							</Text>
						</Box>
					)
				})}
			</Box>
			{items.length > visibleCount && (
				<Text color={theme.dimText}>... and {items.length - visibleCount} more</Text>
			)}
			<Text color={theme.dimText}>↑↓ navigate • Enter select • n new • r rename • d delete • Esc close</Text>
		</Box>
	)
}

export default ModelPicker
