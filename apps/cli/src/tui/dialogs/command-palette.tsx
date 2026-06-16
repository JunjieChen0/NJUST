/**
 * Command Palette - OpenCode-aligned
 *
 * Features:
 * - Fuzzy search via fuzzysort (already a CLI dep) across id/label/description
 * - Category grouping (split on first "." in command id)
 * - Keyboard navigation (up/down/enter/escape)
 * - Keybinding display (Ctrl+K, Ctrl+B, ...)
 *
 * Designed to be rendered inside a DialogOverlay (it has no overlay of its
 * own). Use `useDialog().push({ type: "custom", props: { component: () => <CommandPalette ... /> } })`
 * or call the helper `Dialog.openCommandPalette()`.
 */

import { createSignal, createMemo, For, Show, onCleanup } from "solid-js"
import fuzzysort from "fuzzysort"
import { Text } from "../components/index.tsx"
import { useTheme } from "../context/theme.tsx"
import { commandRegistry, type Command } from "../context/command.tsx"
import { KEYMAP } from "../config/keybind.ts"

export function CommandPalette(props: { onSelect: (command: Command) => void; onClose: () => void }) {
	const { theme } = useTheme()
	const [query, setQuery] = createSignal("")
	const [selectedIndex, setSelectedIndex] = createSignal(0)

	const allCommands = createMemo(() => {
		return commandRegistry.list().map((cmd) => ({
			...cmd,
			keybinding: findKeybinding(cmd.id),
		}))
	})

	const filteredCommands = createMemo(() => {
		const q = query().trim()
		if (!q) return allCommands()

		const result = fuzzysort.go(q, allCommands(), {
			keys: ["id", "label", "description"],
			limit: 50,
		})
		return result.map((r) => r.obj)
	})

	const groupedCommands = createMemo(() => {
		const groups = new Map<string, ReturnType<typeof filteredCommands>>()
		for (const cmd of filteredCommands()) {
			const category = cmd.id.split(".")[0] || "other"
			if (!groups.has(category)) groups.set(category, [])
			groups.get(category)!.push(cmd)
		}
		return Array.from(groups.entries())
	})

	const flatItems = createMemo(() => filteredCommands())

	function move(d: -1 | 1) {
		const len = flatItems().length
		if (len === 0) return
		let next = selectedIndex() + d
		if (next < 0) next = len - 1
		if (next >= len) next = 0
		setSelectedIndex(next)
	}

	function handleKey(
		input: string,
		key: {
			escape?: boolean
			upArrow?: boolean
			downArrow?: boolean
			return?: boolean
			backspace?: boolean
			ctrl?: boolean
			meta?: boolean
		},
	) {
		if (key.escape) {
			props.onClose()
			return
		}
		if (key.upArrow) {
			move(-1)
			return
		}
		if (key.downArrow) {
			move(1)
			return
		}
		if (key.return) {
			const cmd = flatItems()[selectedIndex()]
			if (cmd) props.onSelect(cmd)
			return
		}
		if (key.backspace) {
			setQuery((q) => q.slice(0, -1))
			setSelectedIndex(0)
			return
		}
		if (input && !key.ctrl && !key.meta) {
			setQuery((q) => q + input)
			setSelectedIndex(0)
		}
	}

	// Browser keyboard fallback (used only when not running in OpenTUI; in
	// the real TUI the renderer drives keypress events).
	if (typeof window !== "undefined") {
		const handler = (e: KeyboardEvent) => {
			handleKey(e.key, {
				escape: e.key === "Escape",
				upArrow: e.key === "ArrowUp",
				downArrow: e.key === "ArrowDown",
				return: e.key === "Enter",
				backspace: e.key === "Backspace",
				ctrl: e.ctrlKey,
				meta: e.metaKey,
			})
		}
		window.addEventListener("keydown", handler)
		onCleanup(() => window.removeEventListener("keydown", handler))
	}

	let globalIndex = 0

	return (
		<box
			flexDirection="column"
			border={true}
			borderColor={theme.colors.primary}
			backgroundColor={theme.colors.backgroundMenu}
			paddingLeft={1}
			paddingRight={1}
			paddingTop={1}
			paddingBottom={1}
			width={70}>
			{/* Search input */}
			<box flexDirection="row" paddingBottom={1} border={["bottom"]} borderColor={theme.colors.borderSubtle}>
				<Text color={theme.colors.primary} bold>
					❯{" "}
				</Text>
				<Show when={query()} fallback={<Text color={theme.colors.textMuted}>Type to search commands…</Text>}>
					<Text color={theme.colors.text}>{query()}</Text>
				</Show>
				<Text backgroundColor={theme.colors.primary}> </Text>
			</box>

			{/* Command list */}
			<Show
				when={flatItems().length > 0}
				fallback={
					<box paddingLeft={1} paddingRight={1} paddingTop={1}>
						<Text color={theme.colors.textMuted}>No commands found</Text>
					</box>
				}>
				<For each={groupedCommands()}>
					{([category, cmds]) => (
						<box flexDirection="column" paddingTop={1}>
							<Text color={theme.colors.textMuted} underline>
								{category}
							</Text>
							<For each={cmds}>
								{(cmd) => {
									const idx = globalIndex++
									const isSelected = () => idx === selectedIndex()
									return (
										<box
											flexDirection="row"
											backgroundColor={isSelected() ? theme.colors.selectedBackground : undefined}
											onMouseDown={() => props.onSelect(cmd)}>
											<Text
												color={
													isSelected() ? theme.colors.selectedForeground : theme.colors.text
												}
												bold={isSelected()}>
												{isSelected() ? "▶ " : "  "}
												{cmd.label}
											</Text>
											<Show when={cmd.description}>
												<Text color={theme.colors.textMuted}> {cmd.description}</Text>
											</Show>
											<Show when={cmd.keybinding}>
												<Text color={theme.colors.secondary}> [{cmd.keybinding}]</Text>
											</Show>
										</box>
									)
								}}
							</For>
						</box>
					)}
				</For>
			</Show>

			{/* Footer */}
			<box paddingTop={1} border={["top"]} borderColor={theme.colors.borderSubtle}>
				<Text color={theme.colors.textMuted}>↑↓ Navigate · Enter Select · Esc Close</Text>
			</box>
		</box>
	)
}

// =============================================================================
// Helpers
// =============================================================================

function findKeybinding(commandId: string): string | undefined {
	for (const [name, binding] of Object.entries(KEYMAP)) {
		if (name === commandId || commandId.includes(name)) {
			let key = binding.key
			if (binding.ctrl) key = `Ctrl+${key}`
			if (binding.shift) key = `Shift+${key}`
			if (binding.alt) key = `Alt+${key}`
			return key
		}
	}
	return undefined
}
