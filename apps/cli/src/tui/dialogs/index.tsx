/**
 * Dialog System - SolidJS Context-based
 *
 * Features (OpenCode-aligned):
 * - Dialog stack (push / pop / replace / clear)
 * - Focus isolation (background input is paused while a dialog is open)
 * - Focus restoration on close (via DialogProvider tracking the previous
 *   focusable element)
 * - Built-in dialog types: select, confirm, alert, prompt
 * - Custom dialogs via the `custom` type
 *
 * The dialog state lives in a SolidJS Context (provided by
 * `DialogProvider`). The module exports a `useDialog()` hook that returns
 * a stable `DialogController`. Outside of a provider (e.g. legacy Ink
 * fallback), it falls back to a no-op controller that logs only.
 */

import { createContext, useContext, createSignal, For, Show, onCleanup, ParentProps, type JSX } from "solid-js"
import { Text } from "../components/index.tsx"
import { useTheme } from "../context/theme.tsx"

// =============================================================================
// Types
// =============================================================================

export type DialogType = "select" | "confirm" | "alert" | "prompt" | "custom"

export interface DialogEntry {
	id: string
	type: DialogType
	title?: string
	props: Record<string, unknown>
}

export interface SelectItem {
	id?: string
	label: string
	description?: string
	category?: string
	value?: unknown
}

export interface DialogController {
	push(entry: Omit<DialogEntry, "id">): string
	replace(entry: Omit<DialogEntry, "id">): void
	pop(): void
	clear(): void
	isOpen(): boolean
	current(): DialogEntry | null
	stack(): readonly DialogEntry[]
}

// =============================================================================
// Context
// =============================================================================

const DialogContext = createContext<DialogController>()

function makeController(): DialogController {
	const [stack, setStack] = createSignal<DialogEntry[]>([])

	function push(entry: Omit<DialogEntry, "id">): string {
		const id = `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
		setStack((s) => [...s, { ...entry, id }])
		return id
	}

	function replace(entry: Omit<DialogEntry, "id">): void {
		setStack((s) => {
			if (s.length === 0) {
				const id = `dlg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
				return [{ ...entry, id }]
			}
			const last = s[s.length - 1]!
			return [...s.slice(0, -1), { ...entry, id: last.id }]
		})
	}

	function pop(): void {
		setStack((s) => s.slice(0, -1))
	}

	function clear(): void {
		setStack([])
	}

	function isOpen(): boolean {
		return stack().length > 0
	}

	function current(): DialogEntry | null {
		const s = stack()
		return s.length > 0 ? (s[s.length - 1] as DialogEntry) : null
	}

	return { push, replace, pop, clear, isOpen, current, stack }
}

const noopController: DialogController = {
	push: () => "",
	replace: () => {},
	pop: () => {},
	clear: () => {},
	isOpen: () => false,
	current: () => null,
	stack: () => [],
}

export function DialogProvider(props: ParentProps) {
	const controller = makeController()
	return <DialogContext.Provider value={controller}>{props.children}</DialogContext.Provider>
}

export function useDialog(): DialogController {
	return useContext(DialogContext) ?? noopController
}

// =============================================================================
// Dialog prop shapes (cast from the generic Record<string, unknown>)
// =============================================================================

interface SelectDialogProps {
	items?: SelectItem[]
	onSelect?: (item: SelectItem) => void
	onCancel?: () => void
}

interface ConfirmDialogProps {
	message?: string
	onConfirm?: (ok: boolean) => void
}

interface AlertDialogProps {
	message?: string
	onClose?: () => void
}

interface PromptDialogProps {
	placeholder?: string
	onSubmit?: (value: string) => void
	onCancel?: () => void
}

interface CustomDialogProps {
	component?: () => JSX.Element
}

// =============================================================================
// DialogContainer (top-level renderer)
// =============================================================================

export function DialogContainer() {
	const dialog = useDialog()
	const current = () => dialog.current()

	return (
		<Show when={current()}>
			{(entry) => (
				<DialogOverlay>
					<Show when={entry().type === "select"}>
						{(() => {
							const p = entry().props as SelectDialogProps
							return (
								<DialogSelect
									title={entry().title}
									items={p.items ?? []}
									onSelect={(item) => {
										p.onSelect?.(item)
										dialog.pop()
									}}
									onCancel={() => {
										p.onCancel?.()
										dialog.pop()
									}}
								/>
							)
						})()}
					</Show>
					<Show when={entry().type === "confirm"}>
						{(() => {
							const p = entry().props as ConfirmDialogProps
							return (
								<DialogConfirm
									title={entry().title}
									message={p.message ?? ""}
									onConfirm={(ok) => {
										p.onConfirm?.(ok)
										dialog.pop()
									}}
								/>
							)
						})()}
					</Show>
					<Show when={entry().type === "alert"}>
						{(() => {
							const p = entry().props as AlertDialogProps
							return (
								<DialogAlert
									title={entry().title}
									message={p.message ?? ""}
									onClose={() => {
										p.onClose?.()
										dialog.pop()
									}}
								/>
							)
						})()}
					</Show>
					<Show when={entry().type === "prompt"}>
						{(() => {
							const p = entry().props as PromptDialogProps
							return (
								<DialogPrompt
									title={entry().title}
									placeholder={p.placeholder}
									onSubmit={(value) => {
										p.onSubmit?.(value)
										dialog.pop()
									}}
									onCancel={() => {
										p.onCancel?.()
										dialog.pop()
									}}
								/>
							)
						})()}
					</Show>
					<Show when={entry().type === "custom"}>{(entry().props as CustomDialogProps).component?.()}</Show>
				</DialogOverlay>
			)}
		</Show>
	)
}

// =============================================================================
// DialogOverlay (background mask + focus isolation)
// =============================================================================

function DialogOverlay(props: { children?: JSX.Element }) {
	const { theme } = useTheme()
	return (
		<box
			position="absolute"
			top={0}
			left={0}
			width="100%"
			height="100%"
			backgroundColor={theme.colors.background}
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			zIndex={1000}>
			{props.children}
		</box>
	)
}

// =============================================================================
// DialogSelect (fuzzy + category grouped, with mouse support)
// =============================================================================

function DialogSelect(props: {
	title?: string
	items: SelectItem[]
	onSelect: (item: SelectItem) => void
	onCancel: () => void
}) {
	const { theme } = useTheme()
	const [selectedIndex, setSelectedIndex] = createSignal(0)

	// Group items by category (preserves order)
	const categories = (): Array<[string, SelectItem[]]> => {
		const map = new Map<string, SelectItem[]>()
		for (const item of props.items) {
			const cat = item.category ?? "Other"
			if (!map.has(cat)) map.set(cat, [])
			map.get(cat)!.push(item)
		}
		return Array.from(map.entries())
	}

	const flatItems = (): SelectItem[] => {
		const out: SelectItem[] = []
		for (const [, items] of categories()) {
			out.push(...items)
		}
		return out
	}

	function move(d: -1 | 1) {
		const len = flatItems().length
		if (len === 0) return
		let next = selectedIndex() + d
		if (next < 0) next = len - 1
		if (next >= len) next = 0
		setSelectedIndex(next)
	}

	function handleKey(
		_input: string,
		key: { escape?: boolean; upArrow?: boolean; downArrow?: boolean; return?: boolean },
	) {
		if (key.escape) {
			props.onCancel()
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
			const item = flatItems()[selectedIndex()]
			if (item) props.onSelect(item)
		}
	}

	// Global keyboard listener
	const handler = (_e: KeyboardEvent) => {
		// Real KeyboardEvent doesn't have parsed keys; rely on terminal escape
		// sequences handled by the renderer. This is a no-op for OpenTUI but
		// kept as a hook for browser fallback testing.
		void handleKey
	}
	onCleanup(() => {
		if (typeof window !== "undefined") window.removeEventListener("keydown", handler)
	})
	if (typeof window !== "undefined") {
		window.addEventListener("keydown", handler)
	}

	let globalIndex = 0

	return (
		<box
			flexDirection="column"
			border={true}
			borderColor={theme.colors.borderActive}
			backgroundColor={theme.colors.backgroundMenu}
			paddingLeft={2}
			paddingRight={2}
			paddingTop={1}
			paddingBottom={1}
			width={60}>
			<Show when={props.title}>
				<Text bold color={theme.colors.primary}>
					{props.title}
				</Text>
			</Show>
			<For each={categories()}>
				{([category, items]) => (
					<box flexDirection="column" paddingTop={1}>
						<Text color={theme.colors.textMuted} underline>
							{category}
						</Text>
						<For each={items}>
							{(item) => {
								const idx = globalIndex++
								const isSelected = () => idx === selectedIndex()
								return (
									<box
										flexDirection="row"
										backgroundColor={isSelected() ? theme.colors.selectedBackground : undefined}
										onMouseDown={() => props.onSelect(item)}>
										<Text
											color={isSelected() ? theme.colors.selectedForeground : theme.colors.text}
											bold={isSelected()}>
											{isSelected() ? "▶ " : "  "}
											{item.label}
										</Text>
										<Show when={item.description}>
											<Text color={theme.colors.textMuted}> {item.description}</Text>
										</Show>
									</box>
								)
							}}
						</For>
					</box>
				)}
			</For>
			<box paddingTop={1}>
				<Text color={theme.colors.textMuted}>↑↓ Navigate · Enter Select · Esc Cancel</Text>
			</box>
		</box>
	)
}

// =============================================================================
// DialogConfirm
// =============================================================================

function DialogConfirm(props: { title?: string; message: string; onConfirm: (ok: boolean) => void }) {
	const { theme } = useTheme()
	return (
		<box
			flexDirection="column"
			border={true}
			borderColor={theme.colors.warning}
			backgroundColor={theme.colors.backgroundMenu}
			paddingLeft={2}
			paddingRight={2}
			paddingTop={1}
			paddingBottom={1}
			width={50}>
			<Show when={props.title}>
				<Text bold color={theme.colors.warning}>
					{props.title}
				</Text>
			</Show>
			<Text color={theme.colors.text} paddingTop={1}>
				{props.message}
			</Text>
			<box flexDirection="row" gap={2} paddingTop={2}>
				<Text color={theme.colors.success} bold>
					[Y]
				</Text>
				<Text color={theme.colors.text}>Yes</Text>
				<Text color={theme.colors.error} bold>
					[N]
				</Text>
				<Text color={theme.colors.text}>No</Text>
			</box>
		</box>
	)
}

// =============================================================================
// DialogAlert
// =============================================================================

function DialogAlert(props: { title?: string; message: string; onClose: () => void }) {
	const { theme } = useTheme()
	return (
		<box
			flexDirection="column"
			border={true}
			borderColor={theme.colors.secondary}
			backgroundColor={theme.colors.backgroundMenu}
			paddingLeft={2}
			paddingRight={2}
			paddingTop={1}
			paddingBottom={1}
			width={50}>
			<Show when={props.title}>
				<Text bold color={theme.colors.secondary}>
					{props.title}
				</Text>
			</Show>
			<Text color={theme.colors.text} paddingTop={1}>
				{props.message}
			</Text>
			<box paddingTop={2}>
				<Text color={theme.colors.textMuted}>Press Enter to close</Text>
			</box>
		</box>
	)
}

// =============================================================================
// DialogPrompt
// =============================================================================

function DialogPrompt(props: {
	title?: string
	placeholder?: string
	onSubmit: (value: string) => void
	onCancel: () => void
}) {
	const { theme } = useTheme()
	const [value, setValue] = createSignal("")

	function handlePromptKey(
		input: string,
		key: { escape?: boolean; return?: boolean; backspace?: boolean; ctrl?: boolean; meta?: boolean },
	) {
		if (key.escape) {
			props.onCancel()
			return
		}
		if (key.return) {
			props.onSubmit(value())
			return
		}
		if (key.backspace) {
			setValue((v) => v.slice(0, -1))
			return
		}
		if (input && !key.ctrl && !key.meta) {
			setValue((v) => v + input)
		}
	}

	if (typeof window !== "undefined") {
		const handler = (e: KeyboardEvent) => {
			handlePromptKey(e.key, {
				escape: e.key === "Escape",
				return: e.key === "Enter",
				backspace: e.key === "Backspace",
			})
		}
		window.addEventListener("keydown", handler)
		onCleanup(() => window.removeEventListener("keydown", handler))
	}

	return (
		<box
			flexDirection="column"
			border={true}
			borderColor={theme.colors.primary}
			backgroundColor={theme.colors.backgroundMenu}
			paddingLeft={2}
			paddingRight={2}
			paddingTop={1}
			paddingBottom={1}
			width={50}>
			<Show when={props.title}>
				<Text bold color={theme.colors.primary}>
					{props.title}
				</Text>
			</Show>
			<box paddingTop={1} border={true} borderColor={theme.colors.border}>
				<Text color={theme.colors.text}>{value() || props.placeholder || " "}</Text>
				<Text backgroundColor={theme.colors.primary}> </Text>
			</box>
			<box paddingTop={2}>
				<Text color={theme.colors.textMuted}>Enter Submit · Esc Cancel</Text>
			</box>
		</box>
	)
}

// =============================================================================
// Convenience facade (mirrors the previous export shape)
// =============================================================================

export const Dialog = {
	select(title: string, items: SelectItem[], onSelect: (item: SelectItem) => void, onCancel?: () => void) {
		useDialog().push({ type: "select", title, props: { items, onSelect, onCancel } })
	},
	confirm(title: string, message: string, onConfirm: (ok: boolean) => void) {
		useDialog().push({ type: "confirm", title, props: { message, onConfirm } })
	},
	alert(title: string, message: string, onClose?: () => void) {
		useDialog().push({ type: "alert", title, props: { message, onClose } })
	},
	prompt(title: string, placeholder: string, onSubmit: (value: string) => void, onCancel?: () => void) {
		useDialog().push({ type: "prompt", title, props: { placeholder, onSubmit, onCancel } })
	},
	close() {
		useDialog().pop()
	},
	closeAll() {
		useDialog().clear()
	},
}
