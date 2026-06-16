/**
 * Prompt Component - OpenTUI Native Implementation
 *
 * Uses OpenTUI's native <textarea> renderable for:
 * - Multi-line input with native cursor movement
 * - Bracketed paste handling
 * - IME composition
 * - Selection / clipboard
 * - Vim/Emacs keybindings (built-in default)
 *
 * Above the textarea we layer:
 * - Prompt metadata (provider / model / mode / token usage)
 * - Autocomplete dropdown (slash, file, mode, history)
 * - History navigation (up/down arrows at line boundary)
 *
 * Mirrors the OpenCode Prompt structure: textarea + extmarks + autocomplete.
 */

import { createSignal, createMemo, createEffect, onMount, onCleanup, Show, type ValidComponent } from "solid-js"
import { Dynamic } from "solid-js/web"
import { Text, Box } from "../index.tsx"
import { useTheme } from "../../context/theme.tsx"
import { commandRegistry } from "../../context/command.tsx"
import { usePromptHistory } from "./history.tsx"
import { AutocompletePicker, type AutocompleteItem, type AutocompleteTrigger } from "./autocomplete.tsx"
import { usePromptClearSignal } from "../../lib/prompt-bus.ts"
import { useTheme } from "../../context/theme.tsx"

export interface PromptMetadata {
	provider?: string
	model?: string
	mode?: string
	reasoningEffort?: string
	tokenUsage?: { total: number; context: number }
	isRunning?: boolean
}

export interface PromptProps {
	onSubmit: (text: string) => void
	onCancel?: () => void
	onShortcut?: (key: string, modifiers: { ctrl?: boolean; shift?: boolean; alt?: boolean; meta?: boolean }) => boolean
	placeholder?: string
	disabled?: boolean
	metadata?: PromptMetadata
	history?: string[]
	triggers?: AutocompleteTrigger[]
	/** Optional ref to access the underlying OpenTUI textarea renderable. */
	ref?: (api: PromptApi | undefined) => void
}

export interface PromptApi {
	focus(): void
	blur(): void
	setText(text: string): void
	clear(): void
	getText(): string
}

interface TextareaRef {
	focus: () => void
	blur: () => void
	setText: (text: string) => void
	clear: () => void
	gotoBufferEnd: () => void
	cursorOffset: number
	plainText?: string
}

interface OpenTuiKeyEvent {
	upArrow?: boolean
	downArrow?: boolean
	return?: boolean
	escape?: boolean
	tab?: boolean
	shift?: boolean
	ctrl?: boolean
	meta?: boolean
	backspace?: boolean
}

/**
 * Full-featured Prompt component backed by OpenTUI's native <textarea>.
 */
export function Prompt(props: PromptProps) {
	const { theme } = useTheme()

	// === State ===
	const [value, setValue] = createSignal("")
	const [showAutocomplete, setShowAutocomplete] = createSignal(false)
	const [autocompleteItems, setAutocompleteItems] = createSignal<AutocompleteItem[]>([])
	const [autocompleteIndex, setAutocompleteIndex] = createSignal(0)
	const [historyIndex, setHistoryIndex] = createSignal(-1)
	const [draftBuffer, setDraftBuffer] = createSignal<string>("")

	const promptHistory = usePromptHistory()

	// === Computed ===
	const isDisabled = createMemo(() => props.disabled || false)

	// === Refs to OpenTUI textarea ===
	let textareaEl: TextareaRef | undefined

	// === Autocomplete ===
	function detectAndUpdateAutocomplete(text: string, cursorCol: number) {
		if (!props.triggers || props.triggers.length === 0) {
			setShowAutocomplete(false)
			return
		}

		// Get the line up to the cursor
		const beforeCursor = text.slice(0, cursorCol)
		const currentLine = beforeCursor.split("\n").pop() ?? ""

		for (const trigger of props.triggers) {
			const match = trigger.detect(currentLine)
			if (match) {
				const items = trigger.getItems(match)
				if (items.length > 0) {
					setAutocompleteItems(items)
					setAutocompleteIndex(0)
					setShowAutocomplete(true)
					return
				}
			}
		}
		setShowAutocomplete(false)
	}

	function acceptAutocomplete() {
		const items = autocompleteItems()
		const idx = autocompleteIndex()
		if (items.length === 0 || idx >= items.length) return

		const item = items[idx]
		const text = value()

		// Find which trigger was active and determine replacement range
		const cursorOffset = textareaEl?.cursorOffset ?? text.length
		const beforeCursor = text.slice(0, cursorOffset)
		const currentLine = beforeCursor.split("\n").pop() ?? ""
		const lineStart = beforeCursor.length - currentLine.length

		for (const trigger of props.triggers || []) {
			const match = trigger.detect(currentLine)
			if (match) {
				const prefix = match.prefix
				const beforePrefix = currentLine.slice(0, currentLine.length - prefix.length)

				// Replace from `lineStart + (currentLine.length - prefix.length)` to cursor
				const replaceStart = lineStart + beforePrefix.length
				const replaceEnd = cursorOffset

				const newText = text.slice(0, replaceStart) + item.value + text.slice(replaceEnd)
				const newCursor = replaceStart + item.value.length

				if (textareaEl) {
					textareaEl.setText(newText)
					textareaEl.cursorOffset = newCursor
				}
				setValue(newText)
				setShowAutocomplete(false)
				return
			}
		}
	}

	function navigateAutocomplete(direction: "up" | "down") {
		const items = autocompleteItems()
		if (items.length === 0) return
		setAutocompleteIndex((prev) => {
			if (direction === "up") return prev <= 0 ? items.length - 1 : prev - 1
			return prev >= items.length - 1 ? 0 : prev + 1
		})
	}

	// === Submit ===
	function submit() {
		if (isDisabled()) return
		const text = value().trim()
		if (!text) return

		// Handle slash commands
		if (text.startsWith("/")) {
			const match = text.match(/^\/(\w+)(?:\s|$)/)
			if (match?.[1]) {
				const cmd = commandRegistry.resolveSlashName(match[1])
				if (cmd) {
					promptHistory.add(text)
					setHistoryIndex(-1)
					setDraftBuffer("")
					if (textareaEl) {
						textareaEl.clear()
					}
					setValue("")
					setShowAutocomplete(false)
					void cmd.run()
					return
				}
			}
		}

		// Record to history (deduplicated, capped)
		promptHistory.add(text)
		setHistoryIndex(-1)
		setDraftBuffer("")

		props.onSubmit(text)

		// Clear textarea
		if (textareaEl) {
			textareaEl.clear()
		}
		setValue("")
		setShowAutocomplete(false)
	}

	// === History navigation ===
	function navigateHistory(direction: "up" | "down") {
		const all = promptHistory.list()

		if (direction === "up") {
			if (historyIndex() === -1) {
				setDraftBuffer(value())
				const last = all.length - 1
				if (last >= 0) {
					setHistoryIndex(last)
					loadFromHistory(all[last])
				}
			} else if (historyIndex() > 0) {
				const idx = historyIndex() - 1
				setHistoryIndex(idx)
				loadFromHistory(all[idx])
			}
		} else {
			if (historyIndex() !== -1) {
				if (historyIndex() < all.length - 1) {
					const idx = historyIndex() + 1
					setHistoryIndex(idx)
					loadFromHistory(all[idx])
				} else {
					setHistoryIndex(-1)
					loadFromHistory(draftBuffer())
				}
			}
		}
	}

	function loadFromHistory(text: string) {
		if (textareaEl) {
			textareaEl.setText(text)
			textareaEl.gotoBufferEnd()
		}
		setValue(text)
	}

	// === Keyboard handling (delegated to textarea for editing; we handle dialog/history here) ===
	function handleKeyDown(_input: string, key: OpenTuiKeyEvent) {
		// Autocomplete takes priority
		if (showAutocomplete()) {
			if (key.upArrow) {
				navigateAutocomplete("up")
				return
			}
			if (key.downArrow) {
				navigateAutocomplete("down")
				return
			}
			if (key.tab || (key.return && !key.shift)) {
				acceptAutocomplete()
				return
			}
			if (key.escape) {
				setShowAutocomplete(false)
				return
			}
			// Any other key: pass through to textarea (it will update text)
			// After the next content change event, autocomplete will refresh.
			return
		}

		// Ctrl+C cancel
		if (key.ctrl && _input === "c") {
			props.onCancel?.()
			return
		}

		// Let the parent handle global shortcuts first
		const handled = props.onShortcut?.(_input || keyToName(key), {
			ctrl: key.ctrl,
			shift: key.shift,
			alt: key.alt,
			meta: key.meta,
		})
		if (handled) return

		// Enter: submit
		if (key.return && !key.shift) {
			submit()
			return
		}

		// Up at top of textarea → history previous
		if (key.upArrow && textareaEl) {
			if (textareaEl.cursorOffset === 0) {
				navigateHistory("up")
				return
			}
		}

		// Down at bottom of textarea → history next
		if (key.downArrow && textareaEl) {
			if (textareaEl.cursorOffset === textareaEl.plainText?.length) {
				navigateHistory("down")
				return
			}
		}

		// Esc: clear autocomplete or cancel
		if (key.escape) {
			if (showAutocomplete()) {
				setShowAutocomplete(false)
				return
			}
			props.onCancel?.()
		}
	}

	function keyToName(key: OpenTuiKeyEvent): string {
		if (key.upArrow) return "up"
		if (key.downArrow) return "down"
		if (key.leftArrow) return "left"
		if (key.rightArrow) return "right"
		if (key.return) return "return"
		if (key.escape) return "escape"
		if (key.tab) return "tab"
		if (key.backspace) return "backspace"
		return ""
	}

	// === API ref ===
	const api: PromptApi = {
		focus: () => textareaEl?.focus?.(),
		blur: () => textareaEl?.blur?.(),
		setText: (text: string) => {
			if (textareaEl) {
				textareaEl.setText(text)
				textareaEl.gotoBufferEnd()
			}
			setValue(text)
		},
		clear: () => {
			if (textareaEl) textareaEl.clear()
			setValue("")
			setShowAutocomplete(false)
		},
		getText: () => value(),
	}

	// Expose API to parent
	createEffect(() => {
		props.ref?.(api)
	})
	onCleanup(() => {
		props.ref?.(undefined)
	})

	// Listen for global clear requests
	const clearSignal = usePromptClearSignal()
	let lastClearSignal = 0
	createEffect(() => {
		const current = clearSignal()
		if (current !== lastClearSignal) {
			lastClearSignal = current
			api.clear()
		}
	})

	// === Sync textareaEl plainText back to value signal whenever content changes ===
	function onContentChange() {
		if (!textareaEl) return
		const text = textareaEl.plainText ?? ""
		setValue(text)
		const cursorCol = textareaEl.cursorOffset ?? text.length
		// If autocomplete is visible, refresh it; otherwise detect from scratch
		detectAndUpdateAutocomplete(text, cursorCol)
	}

	// === Autofocus on mount ===
	onMount(() => {
		// Defer to next tick so the ref is attached
		queueMicrotask(() => {
			textareaEl?.focus?.()
		})
	})

	return (
		<Box flexDirection="column" flexGrow={0}>
			{/* Metadata bar */}
			{props.metadata && (
				<Box flexDirection="row">
					<Show when={props.metadata.provider}>
						<Text color={theme.colors.primary} bold>
							{props.metadata.provider}
						</Text>
					</Show>
					<Show when={props.metadata.model}>
						<Text color={theme.colors.textMuted}> {props.metadata.model}</Text>
					</Show>
					<Show when={props.metadata.mode}>
						<Text color={theme.colors.secondary}> [{props.metadata.mode}]</Text>
					</Show>
					<Show when={props.metadata.isRunning}>
						<Text color={theme.colors.warning}> ●</Text>
					</Show>
					<Show when={props.metadata.tokenUsage}>
						<Text color={theme.colors.textMuted}>
							{" "}
							{props.metadata.tokenUsage!.total}/{props.metadata.tokenUsage!.context} tokens
						</Text>
					</Show>
				</Box>
			)}

			{/* Input area: OpenTUI native <textarea> with blue accent border */}
			<Box
				border={true}
				borderColor={isDisabled() ? theme.colors.borderSubtle : theme.colors.borderActive}
				padding={0}
				flexDirection="column">
				<Dynamic
					component={"textarea" as ValidComponent}
					ref={(el: TextareaRef) => {
						textareaEl = el
						// Make sure it gets focus on first render
						queueMicrotask(() => el?.focus?.())
					}}
					placeholder={props.placeholder ?? "Type a message..."}
					placeholderColor={theme.colors.textMuted}
					textColor={theme.colors.text}
					focusedTextColor={theme.colors.text}
					backgroundColor={theme.colors.background}
					focusedBackgroundColor={theme.colors.background}
					showCursor={!isDisabled()}
					cursorColor={theme.colors.primary}
					minHeight={1}
					maxHeight={6}
					wrapMode="word"
					onContentChange={onContentChange}
					onKeyDown={(e: OpenTuiKeyEvent) => {
						if (isDisabled()) {
							return
						}
						handleKeyDown("", e)
					}}
				/>
				<Show when={showAutocomplete()}>
					<AutocompletePicker
						items={autocompleteItems()}
						selectedIndex={autocompleteIndex()}
						onSelect={() => acceptAutocomplete()}
						onClose={() => setShowAutocomplete(false)}
					/>
				</Show>
			</Box>
		</Box>
	)
}
