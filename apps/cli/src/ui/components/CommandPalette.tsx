import { useState, useMemo } from "react"
import { Box, Text, useInput } from "ink"
import * as theme from "../theme.ts"

export interface Command {
	name: string
	title: string
	category: string
	shortcut?: string
	suggested?: boolean
	run: () => void
}

interface CommandPaletteProps {
	commands: Command[]
	onSelect: (command: Command) => void
	onClose: () => void
}

export function CommandPalette({ commands, onSelect, onClose }: CommandPaletteProps) {
	const [query, setQuery] = useState("")
	const [selectedIndex, setSelectedIndex] = useState(0)

	const filtered = useMemo(() => {
		if (!query) return commands
		const lower = query.toLowerCase()
		return commands.filter(
			(cmd) =>
				cmd.title.toLowerCase().includes(lower) ||
				cmd.name.toLowerCase().includes(lower) ||
				cmd.category.toLowerCase().includes(lower),
		)
	}, [commands, query])

	const grouped = useMemo(() => {
		const groups = new Map<string, Command[]>()
		for (const cmd of filtered) {
			const cat = cmd.category || "Other"
			if (!groups.has(cat)) groups.set(cat, [])
			groups.get(cat)!.push(cmd)
		}
		return groups
	}, [filtered])

	const flat = useMemo(() => {
		const result: { command: Command; isHeader: boolean }[] = []
		for (const [cat, cmds] of grouped) {
			result.push({
				command: { name: `__header_${cat}`, title: cat, category: cat, run: () => {} },
				isHeader: true,
			})
			for (const cmd of cmds) {
				result.push({ command: cmd, isHeader: false })
			}
		}
		return result
	}, [grouped])

	const selectableItems = flat.filter((item) => !item.isHeader)

	useInput((input, key) => {
		if (key.escape) {
			onClose()
			return
		}
		if (key.return) {
			const item = selectableItems[selectedIndex]
			if (item) onSelect(item.command)
			return
		}
		if (key.upArrow) {
			setSelectedIndex((prev) => Math.max(0, prev - 1))
			return
		}
		if (key.downArrow) {
			setSelectedIndex((prev) => Math.min(selectableItems.length - 1, prev + 1))
			return
		}
		if (key.backspace) {
			setQuery((prev) => prev.slice(0, -1))
			setSelectedIndex(0)
			return
		}
		if (input && !key.ctrl && !key.meta) {
			setQuery((prev) => prev + input)
			setSelectedIndex(0)
		}
	})

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={theme.borderColorActive}>
			<Box paddingLeft={1} paddingRight={1}>
				<Text color={theme.titleColor} bold>
					Commands
				</Text>
			</Box>

			<Box paddingLeft={1} paddingRight={1}>
				<Text color={theme.promptColor}>{"> "}</Text>
				<Text color={theme.text}>{query}</Text>
				<Text color={theme.promptColorActive}>█</Text>
			</Box>

			<Text color={theme.borderColor}>{"─".repeat(48)}</Text>

			<Box flexDirection="column" height={15} paddingLeft={1} paddingRight={1}>
				{flat.map((item) => {
					if (item.isHeader) {
						return (
							<Text key={`header-${item.command.category}`} color={theme.dimText} bold>
								{item.command.category}
							</Text>
						)
					}
					const selectableIndex = selectableItems.findIndex((s) => s.command.name === item.command.name)
					const isSelected = selectableIndex === selectedIndex
					return (
						<Box key={item.command.name}>
							<Text color={isSelected ? theme.text : theme.dimText}>
								{isSelected ? "› " : "  "}
								{item.command.title}
							</Text>
							{item.command.shortcut && <Text color={theme.dimText}> {item.command.shortcut}</Text>}
						</Box>
					)
				})}
			</Box>

			<Text color={theme.borderColor}>{"─".repeat(48)}</Text>
			<Box paddingLeft={1} paddingRight={1}>
				<Text color={theme.dimText}>↑↓ navigate • Enter select • Esc close</Text>
			</Box>
		</Box>
	)
}
