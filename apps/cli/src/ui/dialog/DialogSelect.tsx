import fuzzysort from "fuzzysort"
import { Box, Text, useInput } from "ink"
import { useMemo, useState, type ReactNode } from "react"

import { useTheme } from "../theme.js"

import { DialogShell } from "./DialogShell.js"

export interface DialogSelectOption<T = unknown> {
	title: string
	value: T
	description?: string
	category?: string
	disabled?: boolean
}

export interface DialogSelectProps<T> {
	title: string
	options: DialogSelectOption<T>[]
	onSelect: (value: T, option: DialogSelectOption<T>) => void
	onCancel?: () => void
	/** Whether to render the filter input + use fuzzy matching. Default true. */
	filterable?: boolean
	/** Visual height (rows) of the option list before scrolling. Default 10. */
	visibleRows?: number
	/** Initial selection index (clamped to valid range). Default 0. */
	initialIndex?: number
	/** Optional footer hint shown below the list. */
	footer?: ReactNode
}

/**
 * `<DialogSelect>` — keyboard-driven, fuzzy-filtered list dialog.
 *
 * Mirrors OpenCode's `dialog-select.tsx` (much simpler — no mouse, no scroll
 * acceleration, no custom borders since Ink handles that). Filter input
 * captures printable chars; ↑↓ navigates; Enter selects; Esc cancels via the
 * DialogHost's global handler (or `onCancel` if provided).
 */
export function DialogSelect<T>({
	title,
	options,
	onSelect,
	onCancel,
	filterable = true,
	visibleRows = 10,
	initialIndex = 0,
	footer,
}: DialogSelectProps<T>) {
	const theme = useTheme()
	const [filter, setFilter] = useState("")
	const enabledOptions = useMemo(() => options.filter((o) => !o.disabled), [options])
	const [selected, setSelected] = useState(() => clamp(initialIndex, 0, Math.max(0, enabledOptions.length - 1)))

	const filtered = useMemo(() => {
		if (!filterable || filter.length === 0) return enabledOptions
		const targets = enabledOptions.map((o) => `${o.title} ${o.category ?? ""} ${o.description ?? ""}`.trim())
		const results = fuzzysort.go(filter, targets, { threshold: -10000, all: false })
		const indices = new Set(results.map((r) => targets.indexOf(r.target)))
		return enabledOptions.filter((_, i) => indices.has(i))
	}, [filterable, filter, enabledOptions])

	// Clamp selection when filter narrows results.
	const safeSelected = filtered.length === 0 ? 0 : clamp(selected, 0, filtered.length - 1)

	useInput((input, key) => {
		if (key.upArrow) {
			setSelected((s) => clamp(s - 1, 0, Math.max(0, filtered.length - 1)))
			return
		}
		if (key.downArrow) {
			setSelected((s) => clamp(s + 1, 0, Math.max(0, filtered.length - 1)))
			return
		}
		if (key.return) {
			const opt = filtered[safeSelected]
			if (opt) onSelect(opt.value, opt)
			return
		}
		if (key.escape) {
			onCancel?.()
			return
		}
		if (filterable) {
			if (key.backspace || key.delete) {
				setFilter((f) => f.slice(0, -1))
				setSelected(0)
				return
			}
			if (input && !key.ctrl && !key.meta && input.length === 1 && input >= " ") {
				setFilter((f) => f + input)
				setSelected(0)
			}
		}
	})

	const window = computeWindow(safeSelected, filtered.length, visibleRows)
	const visible = filtered.slice(window.start, window.end)

	// Render category dividers when adjacent options change category.
	let lastCategory: string | undefined
	const rows: ReactNode[] = []
	for (let i = 0; i < visible.length; i++) {
		const opt = visible[i]!
		const absoluteIdx = window.start + i
		const isSelected = absoluteIdx === safeSelected
		if (opt.category && opt.category !== lastCategory) {
			rows.push(
				<Box key={`cat-${absoluteIdx}`} marginTop={i === 0 ? 0 : 1}>
					<Text color={theme.textMuted} bold>
						{opt.category}
					</Text>
				</Box>,
			)
			lastCategory = opt.category
		}
		rows.push(
			<Box key={`opt-${absoluteIdx}`} flexDirection="row">
				<Text
					color={isSelected ? theme.selectedListItemText : theme.text}
					backgroundColor={isSelected ? theme.primary : undefined}
				>
					{isSelected ? "▶ " : "  "}
					{opt.title}
				</Text>
				{opt.description && (
					<Text color={theme.textMuted}> {opt.description}</Text>
				)}
			</Box>,
		)
	}

	return (
		<DialogShell title={title}>
			{filterable && (
				<Box marginBottom={1}>
					<Text color={theme.textMuted}>›{" "}</Text>
					<Text color={theme.text}>{filter}</Text>
					<Text color={theme.primary}>▌</Text>
				</Box>
			)}
			<Box flexDirection="column">
				{rows.length > 0 ? (
					rows
				) : (
					<Text color={theme.textMuted}>No results</Text>
				)}
			</Box>
			{filtered.length > visibleRows && (
				<Box marginTop={1}>
					<Text color={theme.textMuted}>
						{safeSelected + 1}/{filtered.length}
					</Text>
				</Box>
			)}
			{footer && (
				<Box marginTop={1}>
					{typeof footer === "string" ? <Text color={theme.textMuted}>{footer}</Text> : footer}
				</Box>
			)}
		</DialogShell>
	)
}

function clamp(value: number, min: number, max: number): number {
	if (max < min) return min
	return Math.max(min, Math.min(max, value))
}

/**
 * Sliding window over the option list so the selected item stays visible.
 * Mirrors common terminal-list scroll behaviour.
 */
function computeWindow(selected: number, total: number, size: number): { start: number; end: number } {
	if (total <= size) return { start: 0, end: total }
	const half = Math.floor(size / 2)
	let start = Math.max(0, selected - half)
	let end = start + size
	if (end > total) {
		end = total
		start = end - size
	}
	return { start, end }
}
