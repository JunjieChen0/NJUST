/**
 * Keymap Configuration - OpenCode-aligned
 *
 * Single source of truth for keyboard shortcuts. The Prompt and Session
 * components read this map to bind keys, and the command palette uses it
 * to render shortcuts next to each command.
 *
 * Format: <binding id>: { key, ctrl?, shift?, alt?, description }
 * - key: lowercase letter, function key, or special ("escape", "return", "tab")
 * - modifiers: ctrl / shift / alt
 */

export interface KeyBinding {
	key: string
	ctrl?: boolean
	shift?: boolean
	alt?: boolean
	description: string
}

export const KEYMAP: Record<string, KeyBinding> = {
	// --- Global ---
	toggleFocus: { key: "tab", description: "Toggle focus between scroll and input" },
	cancel: { key: "escape", description: "Cancel current operation" },
	exit: { key: "c", ctrl: true, description: "Exit (double-press)" },

	// --- Commands ---
	commandPalette: { key: "k", ctrl: true, description: "Open command palette" },
	toggleSidebar: { key: "b", ctrl: true, description: "Toggle sidebar" },
	cycleMode: { key: "m", ctrl: true, description: "Cycle through modes" },

	// --- Session ---
	newSession: { key: "n", ctrl: true, description: "Start new session" },
	resumeSession: { key: "r", ctrl: true, description: "Resume session" },
	sessionInterrupt: { key: "escape", description: "Interrupt running task (double press)" },

	// --- Prompt ---
	promptSubmit: { key: "return", description: "Submit prompt" },
	promptNewline: { key: "return", shift: true, description: "Insert newline" },
	promptHistoryPrev: { key: "up", description: "Previous history entry" },
	promptHistoryNext: { key: "down", description: "Next history entry" },
	promptAutocompletePrev: { key: "up", ctrl: true, description: "Previous autocomplete item" },
	promptAutocompleteNext: { key: "down", ctrl: true, description: "Next autocomplete item" },

	// --- Theme ---
	toggleTheme: { key: "l", ctrl: true, description: "Toggle light/dark theme" },

	// --- Navigation ---
	dialogPrev: { key: "up", description: "Previous item" },
	dialogNext: { key: "down", description: "Next item" },
	dialogClose: { key: "escape", description: "Close dialog" },
}

export function getKeymapCategory(category: string): KeyBinding[] {
	const result: KeyBinding[] = []
	for (const [name, binding] of Object.entries(KEYMAP)) {
		if (name.startsWith(category)) {
			result.push({ ...binding, key: `${name}: ${binding.key}` })
		}
	}
	return result
}

/** Render a binding as a human-friendly key chord, e.g. "Ctrl+K". */
export function formatKeyBinding(binding: KeyBinding): string {
	const parts: string[] = []
	if (binding.ctrl) parts.push("Ctrl")
	if (binding.shift) parts.push("Shift")
	if (binding.alt) parts.push("Alt")
	parts.push(binding.key.charAt(0).toUpperCase() + binding.key.slice(1))
	return parts.join("+")
}
