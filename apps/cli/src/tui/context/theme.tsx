/**
 * Theme System - OpenCode-aligned
 *
 * Provides a reactive theme context with light/dark mode support.
 * Color naming mirrors OpenCode's theme.json so the same JSON files
 * can be loaded as alternate themes.
 *
 * Color slots:
 *   background, backgroundElement, backgroundMenu, border, borderActive
 *   text, textMuted, textInverse
 *   primary, secondary, accent, info, success, warning, error
 *   selectedForeground, selectedBackground
 */

import { createContext, useContext, type JSX } from "solid-js"
import { createStore } from "solid-js/store"

export type ThemeMode = "light" | "dark" | "system"

export interface ThemeColors {
	// Backgrounds
	background: string
	backgroundElement: string
	backgroundMenu: string

	// Borders
	border: string
	borderActive: string
	borderSubtle: string

	// Text
	text: string
	textMuted: string
	textInverse: string

	// Accent colors
	primary: string
	secondary: string
	accent: string
	info: string
	success: string
	warning: string
	error: string

	// Selection
	selectedForeground: string
	selectedBackground: string
}

export interface Theme {
	mode: ThemeMode
	isDark: boolean
	colors: ThemeColors
}

const darkColors: ThemeColors = {
	background: "#0a0a0a",
	backgroundElement: "#171717",
	backgroundMenu: "#0f0f0f",
	border: "#2a2a2a",
	borderActive: "#3b82f6",
	borderSubtle: "#1f1f1f",
	text: "#fafafa",
	textMuted: "#737373",
	textInverse: "#0a0a0a",
	primary: "#3b82f6",
	secondary: "#8b5cf6",
	accent: "#06b6d4",
	info: "#3b82f6",
	success: "#22c55e",
	warning: "#eab308",
	error: "#ef4444",
	selectedForeground: "#fafafa",
	selectedBackground: "#1e3a8a",
}

const lightColors: ThemeColors = {
	background: "#ffffff",
	backgroundElement: "#f5f5f5",
	backgroundMenu: "#fafafa",
	border: "#d4d4d4",
	borderActive: "#2563eb",
	borderSubtle: "#e5e5e5",
	text: "#1a1a1a",
	textMuted: "#737373",
	textInverse: "#ffffff",
	primary: "#2563eb",
	secondary: "#7c3aed",
	accent: "#0891b2",
	info: "#2563eb",
	success: "#16a34a",
	warning: "#ca8a04",
	error: "#dc2626",
	selectedForeground: "#ffffff",
	selectedBackground: "#2563eb",
}

function createTheme(mode: ThemeMode): Theme {
	const isDark = mode === "dark" || (mode === "system" && isSystemDark())
	return {
		mode,
		isDark,
		colors: isDark ? darkColors : lightColors,
	}
}

function isSystemDark(): boolean {
	// Terminal environments: respect COLORFGBG env var (e.g. "15;default" = light fg)
	// Otherwise default to dark.
	if (typeof process !== "undefined" && process.env.COLORFGBG) {
		const parts = process.env.COLORFGBG.split(";")
		const fg = Number(parts[0])
		if (!Number.isNaN(fg)) {
			// Light fg (0-7) on dark bg → dark theme, and vice versa
			return fg < 8
		}
	}
	return true
}

// =============================================================================
// Theme Context
// =============================================================================

interface ThemeContextValue {
	theme: Theme
	setMode: (mode: ThemeMode) => void
	toggleMode: () => void
}

const ThemeContext = createContext<ThemeContextValue>()

export function ThemeProvider(props: { children: JSX.Element; initialMode?: ThemeMode }) {
	const [theme, setTheme] = createStore<Theme>(createTheme(props.initialMode || "dark"))

	const setMode = (mode: ThemeMode) => {
		const newTheme = createTheme(mode)
		setTheme(newTheme)
	}

	const toggleMode = () => {
		const newMode = theme.isDark ? "light" : "dark"
		setMode(newMode)
	}

	return <ThemeContext.Provider value={{ theme, setMode, toggleMode }}>{props.children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
	const context = useContext(ThemeContext)
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider")
	}
	return context
}

/** Helper: pick the best foreground (text vs textInverse) over a background. */
export function selectedForeground(theme: Theme): string {
	return theme.colors.selectedForeground
}
