import { create } from "zustand"
import type { AutocompletePickerState } from "../components/autocomplete/types.ts"

/**
 * UI-specific state that doesn't need to persist across task switches.
 * This separates UI state from task/message state in the main CLI store.
 */
interface UIState {
	// Exit handling state
	showExitHint: boolean
	pendingExit: boolean

	// Countdown timer for auto-accepting followup questions
	countdownSeconds: number | null

	// Custom input mode for followup questions
	showCustomInput: boolean
	isTransitioningToCustomInput: boolean

	// Focus management for scroll area vs input
	manualFocus: "scroll" | "input" | null

	// TODO viewer overlay
	showTodoViewer: boolean

	// API profile picker overlay
	showModelPicker: boolean

	// Settings overlay
	showSettings: boolean

	// File changes panel
	showFileChanges: boolean

	// History view
	showHistory: boolean

	// Command palette overlay
	showCommandPalette: boolean

	// Pending prompt replacement (from /enhance response)
	pendingPromptReplacement: string | null

	// Autocomplete picker state
	pickerState: AutocompletePickerState
}

interface UIActions {
	// Exit handling actions
	setShowExitHint: (show: boolean) => void
	setPendingExit: (pending: boolean) => void

	// Countdown timer actions
	setCountdownSeconds: (seconds: number | null) => void

	// Custom input mode actions
	setShowCustomInput: (show: boolean) => void
	setIsTransitioningToCustomInput: (transitioning: boolean) => void

	// Focus management actions
	setManualFocus: (focus: "scroll" | "input" | null) => void

	// TODO viewer actions
	setShowTodoViewer: (show: boolean) => void

	// API profile picker actions
	setShowModelPicker: (show: boolean) => void

	// Settings overlay actions
	setShowSettings: (show: boolean) => void

	// File changes panel actions
	setShowFileChanges: (show: boolean) => void

	// History view actions
	setShowHistory: (show: boolean) => void

	// Command palette actions
	setShowCommandPalette: (show: boolean) => void

	// Pending prompt replacement actions
	setPendingPromptReplacement: (text: string | null) => void

	// Picker state actions
	setPickerState: (state: AutocompletePickerState) => void

	// Reset all UI state to defaults
	resetUIState: () => void
}

const initialState: UIState = {
	showExitHint: false,
	pendingExit: false,
	countdownSeconds: null,
	showCustomInput: false,
	isTransitioningToCustomInput: false,
	manualFocus: null,
	showTodoViewer: false,
	showModelPicker: false,
	showSettings: false,
	showFileChanges: false,
	showHistory: false,
	showCommandPalette: false,
	pendingPromptReplacement: null,
	pickerState: {
		activeTrigger: null,
		results: [],
		selectedIndex: 0,
		isOpen: false,
		isLoading: false,
		triggerInfo: null,
	},
}

export const useUIStateStore = create<UIState & UIActions>((set) => ({
	...initialState,

	setShowExitHint: (show) => set({ showExitHint: show }),
	setPendingExit: (pending) => set({ pendingExit: pending }),
	setCountdownSeconds: (seconds) => set({ countdownSeconds: seconds }),
	setShowCustomInput: (show) => set({ showCustomInput: show }),
	setIsTransitioningToCustomInput: (transitioning) => set({ isTransitioningToCustomInput: transitioning }),
	setManualFocus: (focus) => set({ manualFocus: focus }),
	setShowTodoViewer: (show) => set({ showTodoViewer: show }),
	setShowModelPicker: (show) => set({ showModelPicker: show }),
	setShowSettings: (show) => set({ showSettings: show }),
	setShowFileChanges: (show) => set({ showFileChanges: show }),
	setShowHistory: (show) => set({ showHistory: show }),
	setShowCommandPalette: (show) => set({ showCommandPalette: show }),
	setPendingPromptReplacement: (text) => set({ pendingPromptReplacement: text }),
	setPickerState: (state) => set({ pickerState: state }),
	resetUIState: () => set(initialState),
}))
