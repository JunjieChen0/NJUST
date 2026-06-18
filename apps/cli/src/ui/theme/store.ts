/**
 * Theme zustand store + persistence.
 *
 * Holds the active theme name + dark/light mode + lock. Persists to
 * `cli-settings.json` so the user's choice survives restarts. Mirrors
 * OpenCode's theme context (dark/light + lock) but skipped:
 *   - terminal palette extraction (Ink has no `renderer.getPalette()` API)
 *   - SIGUSR2 reload (Roo's CLI has no equivalent IPC channel)
 */

import { create } from "zustand"

import { saveSettings } from "@/lib/storage/settings.js"

import { BUILTIN_THEMES, DEFAULT_THEME } from "./loader.js"
import { resolveTheme, type ResolvedTheme, type ThemeJson } from "./resolve.js"

export type ThemeMode = "dark" | "light"

interface ThemeState {
	/** Active theme name (must exist in BUILTIN_THEMES or customThemes). */
	active: string
	/** Current effective mode. */
	mode: ThemeMode
	/** When set, user has pinned mode and OS/terminal hints are ignored. */
	lock: ThemeMode | undefined
	/** User-defined themes loaded from ~/.njust-ai/themes (future hook). */
	customThemes: Record<string, ThemeJson>
	/** True after first sync from disk completes. */
	ready: boolean
}

interface ThemeActions {
	setActive: (name: string) => void
	setMode: (mode: ThemeMode) => void
	pin: (mode?: ThemeMode) => void
	unpin: () => void
	addCustomTheme: (name: string, json: ThemeJson) => void
	hydrate: (input: { active?: string; mode?: ThemeMode; lock?: ThemeMode }) => void
}

const initialState: ThemeState = {
	active: DEFAULT_THEME,
	mode: detectInitialMode(),
	lock: undefined,
	customThemes: {},
	ready: false,
}

/**
 * Detect the terminal's effective background mode at startup.
 *
 * Detection order (first hit wins):
 *  1. `COLORFGBG` env var (xterm/iTerm/VS Code/Konsole convention,
 *     e.g. `15;0` = white-on-black → dark; `0;15` = black-on-white → light).
 *  2. Platform heuristic — Windows shells (PowerShell, cmd, Windows Terminal)
 *     historically default to a light background, while most *nix terminals
 *     default to dark. This is a coarse fallback and users can always
 *     override via `pinThemeMode()` / `themeModeLock` setting.
 */
function detectInitialMode(): ThemeMode {
	const raw = process.env.COLORFGBG
	if (raw) {
		const parts = raw.split(";")
		const bg = parts[parts.length - 1]
		if (bg) {
			const idx = Number.parseInt(bg, 10)
			if (!Number.isNaN(idx)) {
				// 0–6 = dark backgrounds; 7–15 = light backgrounds.
				return idx >= 7 ? "light" : "dark"
			}
		}
	}
	// Platform fallback: Windows defaults to a light background.
	if (process.platform === "win32") return "light"
	return "dark"
}

export const useThemeStore = create<ThemeState & ThemeActions>((set) => ({
	...initialState,

	setActive: (name) => {
		set({ active: name })
		void saveSettings({ theme: name })
	},

	setMode: (mode) => {
		set({ mode })
	},

	pin: (mode) => {
		set((s) => {
			const next = mode ?? s.mode
			void saveSettings({ themeModeLock: next })
			return { mode: next, lock: next }
		})
	},

	unpin: () => {
		set({ lock: undefined })
		void saveSettings({ themeModeLock: undefined })
	},

	addCustomTheme: (name, json) => {
		set((s) => ({ customThemes: { ...s.customThemes, [name]: json } }))
	},

	hydrate: ({ active, mode, lock }) => {
		set({
			active: active && lookupTheme(active) !== undefined ? active : DEFAULT_THEME,
			mode: lock ?? mode ?? detectInitialMode(),
			lock,
			ready: true,
		})
	},
}))

function lookupTheme(name: string): ThemeJson | undefined {
	const custom = useThemeStore.getState().customThemes[name]
	if (custom) return custom
	return BUILTIN_THEMES[name]
}

/** Pure resolver — used by both `useTheme()` and non-component code paths. */
export function resolveActiveTheme(state: Pick<ThemeState, "active" | "mode" | "customThemes">): ResolvedTheme {
	const json = state.customThemes[state.active] ?? BUILTIN_THEMES[state.active] ?? BUILTIN_THEMES[DEFAULT_THEME]!
	return resolveTheme(json, state.mode)
}

/** All theme names (builtin + custom), sorted. */
export function listAllThemeNames(): string[] {
	const custom = Object.keys(useThemeStore.getState().customThemes)
	return [...new Set([...Object.keys(BUILTIN_THEMES), ...custom])].sort()
}
