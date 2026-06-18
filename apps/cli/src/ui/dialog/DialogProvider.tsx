/**
 * DialogProvider — modal stack for the CLI TUI.
 *
 * Mirrors OpenCode's `DialogProvider` (`opencode/src/cli/cmd/tui/ui/dialog.tsx`):
 *   - zustand store keeps a stack of dialog entries (last item is on top)
 *   - `useDialog()` returns push/replace/pop/clear + size control
 *   - The renderer overlays the active entry above the rest of the app
 *   - Escape and Ctrl+C pop the top entry (the existing `useGlobalInput` keeps
 *     working below because Ink's `useInput` handlers stack — when a Dialog
 *     mounts it registers its own handler with higher specificity)
 *
 * What we DON'T do (Ink stack limitations vs. OpenCode):
 *   - True alpha scrim — we render a solid backgroundElement-tinted box
 *     instead. Visually heavier than OpenCode's `RGBA(0,0,0,150)` but
 *     unambiguous.
 *   - Mouse-anywhere-to-dismiss — Ink has no mouse selection.
 */

import { create } from "zustand"
import { Box, Text, useInput, useStdout } from "ink"
import { type ReactNode, useEffect, useState } from "react"

import { useTheme } from "../theme.js"

export type DialogSize = "medium" | "large" | "xlarge"

export interface DialogEntry {
	id: number
	render: () => ReactNode
	onClose?: () => void
	size: DialogSize
}

interface DialogState {
	stack: DialogEntry[]
	nextId: number
}

interface DialogActions {
	push: (entry: Omit<DialogEntry, "id">) => number
	/** Replace whole stack with a single entry (closes everything below). */
	replace: (entry: Omit<DialogEntry, "id">) => number
	/** Pop the top entry. Calls its `onClose` callback. */
	pop: () => void
	/** Pop a specific entry id (no-op if not on top). */
	popById: (id: number) => void
	/** Close every entry. */
	clear: () => void
}

export const useDialogStore = create<DialogState & DialogActions>((set, get) => ({
	stack: [],
	nextId: 1,

	push: (entry) => {
		const id = get().nextId
		set((s) => ({
			stack: [...s.stack, { ...entry, id }],
			nextId: s.nextId + 1,
		}))
		return id
	},

	replace: (entry) => {
		const { stack } = get()
		// Fire onClose for everyone we're about to drop.
		for (const item of stack) item.onClose?.()
		const id = get().nextId
		set((s) => ({
			stack: [{ ...entry, id }],
			nextId: s.nextId + 1,
		}))
		return id
	},

	pop: () => {
		const { stack } = get()
		const top = stack[stack.length - 1]
		if (!top) return
		top.onClose?.()
		set({ stack: stack.slice(0, -1) })
	},

	popById: (id) => {
		const { stack } = get()
		const idx = stack.findIndex((e) => e.id === id)
		if (idx < 0) return
		stack[idx]!.onClose?.()
		set({ stack: stack.filter((e) => e.id !== id) })
	},

	clear: () => {
		const { stack } = get()
		for (const item of stack) item.onClose?.()
		set({ stack: [] })
	},
}))

/**
 * `useDialog()` — React hook that returns the public dialog API.
 *
 * Use `replace(...)` to open a single overlay (most common — replaces any
 * existing overlay with the new one). Use `push(...)` to stack a child
 * dialog on top of the current one (e.g. confirm-inside-select).
 */
export function useDialog() {
	const { push, replace, pop, popById, clear } = useDialogStore()
	return { push, replace, pop, popById, clear }
}

/**
 * Subscribes to whether any modal dialog is currently mounted on the
 * stack. Components below the host (e.g. the main prompt input) use
 * this to suspend their own `useInput` handlers — without this guard
 * Ink stacks all `useInput` listeners and the same keystroke is sent
 * to both the dialog and the main input simultaneously.
 */
export function useHasOpenDialog(): boolean {
	return useDialogStore((s) => s.stack.length > 0)
}

/**
 * `<DialogHost>` — invisible chrome that renders the top dialog entry.
 *
 * Mount this once at the App root. It listens for esc/ctrl+c and pops the
 * top dialog. While the stack is non-empty, the host claims keyboard focus
 * via `useInput({ isActive: true })` — child dialogs each register their own
 * `useInput` after mounting, so their handlers run first (Ink fires inputs in
 * registration order; later registrations get the event first).
 */
export function DialogHost() {
	const stack = useDialogStore((s) => s.stack)
	const popTop = useDialogStore((s) => s.pop)
	const theme = useTheme()
	const { stdout } = useStdout()
	const [size, setSize] = useState({
		columns: stdout?.columns ?? 80,
		rows: stdout?.rows ?? 24,
	})

	useEffect(() => {
		if (!stdout) return
		const onResize = () =>
			setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 })
		stdout.on("resize", onResize)
		return () => {
			stdout.off("resize", onResize)
		}
	}, [stdout])

	useInput(
		(_input, key) => {
			if (key.escape || (key.ctrl && _input === "c")) {
				popTop()
			}
		},
		{ isActive: stack.length > 0 },
	)

	if (stack.length === 0) return null

	const top = stack[stack.length - 1]!
	const width = dialogWidth(top.size, size.columns)
	const padTop = Math.max(2, Math.floor(size.rows / 4))

	return (
		<Box
			position="absolute"
			width={size.columns}
			height={size.rows}
			alignItems="center"
			flexDirection="column"
			paddingTop={padTop}
		>
			{/* Scrim — Ink can't do alpha so we just paint the background. The
			    backgroundElement step gives a softer feel than pure black. */}
			<Box
				position="absolute"
				width={size.columns}
				height={size.rows}
				backgroundColor={theme.background}
			>
				<Text color={theme.background}> </Text>
			</Box>
			{/* Panel — actual dialog content centered in the upper third. */}
			<Box
				width={width}
				flexDirection="column"
				backgroundColor={theme.backgroundPanel}
				paddingTop={1}
				paddingBottom={1}
			>
				{top.render()}
			</Box>
		</Box>
	)
}

function dialogWidth(size: DialogSize, columns: number): number {
	const target = size === "xlarge" ? 116 : size === "large" ? 88 : 60
	return Math.min(target, Math.max(20, columns - 2))
}
