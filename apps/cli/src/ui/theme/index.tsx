/**
 * Theme entry point — `useTheme()` hook + helpers.
 *
 * Exposes the resolved RGBA palette as Ink-friendly hex strings via getters.
 * Old palette field names (titleColor, rooHeader, errorColor, ...) are aliased
 * onto the new OpenCode-compatible field names so the 23 existing call sites
 * keep working without immediate edits — they're migrated incrementally.
 */

import { useEffect, useMemo, useRef } from "react"

import { toHex } from "./rgba.js"
import { resolveActiveTheme, useThemeStore, type ThemeMode } from "./store.js"
import type { ResolvedTheme } from "./resolve.js"

export type { ResolvedTheme, ThemeMode }
export { tint } from "./rgba.js"
export { listAllThemeNames, useThemeStore } from "./store.js"

/**
 * Flat hex palette consumed by Ink components.
 *
 * The new field names mirror OpenCode (`primary`, `background`, `border`, ...).
 * Old field names (`titleColor`, `rooHeader`, `errorColor`, ...) are aliased
 * to the closest new slot for back-compat — see `LEGACY_ALIASES` below.
 */
export interface ThemePalette {
	// === New (OpenCode-compatible) field names ===
	primary: string
	secondary: string
	accent: string
	error: string
	warning: string
	success: string
	info: string
	text: string
	textMuted: string
	background: string
	backgroundPanel: string
	backgroundElement: string
	backgroundMenu: string
	border: string
	borderActive: string
	borderSubtle: string
	selectedListItemText: string

	diffAdded: string
	diffRemoved: string
	diffContext: string
	diffAddedBg: string
	diffRemovedBg: string
	diffLineNumber: string

	syntaxComment: string
	syntaxKeyword: string
	syntaxFunction: string
	syntaxVariable: string
	syntaxString: string
	syntaxNumber: string
	syntaxType: string
	syntaxOperator: string
	syntaxPunctuation: string

	// === Legacy aliases (kept for back-compat; deprecated) ===
	/** @deprecated Use `primary`. */
	titleColor: string
	/** @deprecated Use `text`. */
	welcomeText: string
	/** @deprecated Use `secondary`. */
	asciiColor: string
	/** @deprecated Use `primary`. */
	tipsHeader: string
	/** @deprecated Use `textMuted`. */
	tipsText: string
	/** @deprecated Use `accent`. */
	userHeader: string
	/** @deprecated Use `primary`. */
	rooHeader: string
	/** @deprecated Use `secondary` (info color). */
	toolHeader: string
	/** @deprecated Use `border`. */
	thinkingHeader: string
	/** @deprecated Use `text`. */
	userText: string
	/** @deprecated Use `text`. */
	rooText: string
	/** @deprecated Use `textMuted`. */
	toolText: string
	/** @deprecated Use `textMuted`. */
	thinkingText: string
	/** @deprecated Use `border`. */
	borderColor: string
	/** @deprecated Use `borderActive`. */
	borderColorActive: string
	/** @deprecated Use `textMuted`. */
	dimText: string
	/** @deprecated Use `textMuted`. */
	promptColor: string
	/** @deprecated Use `primary`. */
	promptColorActive: string
	/** @deprecated Use `border`. */
	placeholderColor: string
	/** @deprecated Use `success`. */
	successColor: string
	/** @deprecated Use `error`. */
	errorColor: string
	/** @deprecated Use `warning`. */
	warningColor: string
	/** @deprecated Use `secondary` (info color). */
	focusColor: string
	/** @deprecated Use `accent`. */
	scrollActiveColor: string
	/** @deprecated Use `backgroundElement`. */
	scrollTrackColor: string
}

/**
 * Build a hex-string palette from the resolved RGBA palette, including legacy
 * aliases. Pure — given the same `ResolvedTheme` always returns the same
 * shape, so memoization is straightforward.
 */
function paletteFromResolved(resolved: ResolvedTheme): ThemePalette {
	return {
		// New canonical names
		primary: toHex(resolved.primary),
		secondary: toHex(resolved.secondary),
		accent: toHex(resolved.accent),
		error: toHex(resolved.error),
		warning: toHex(resolved.warning),
		success: toHex(resolved.success),
		info: toHex(resolved.info),
		text: toHex(resolved.text),
		textMuted: toHex(resolved.textMuted),
		background: toHex(resolved.background),
		backgroundPanel: toHex(resolved.backgroundPanel),
		backgroundElement: toHex(resolved.backgroundElement),
		backgroundMenu: toHex(resolved.backgroundMenu),
		border: toHex(resolved.border),
		borderActive: toHex(resolved.borderActive),
		borderSubtle: toHex(resolved.borderSubtle),
		selectedListItemText: toHex(resolved.selectedListItemText),

		diffAdded: toHex(resolved.diffAdded),
		diffRemoved: toHex(resolved.diffRemoved),
		diffContext: toHex(resolved.diffContext),
		diffAddedBg: toHex(resolved.diffAddedBg),
		diffRemovedBg: toHex(resolved.diffRemovedBg),
		diffLineNumber: toHex(resolved.diffLineNumber),

		syntaxComment: toHex(resolved.syntaxComment),
		syntaxKeyword: toHex(resolved.syntaxKeyword),
		syntaxFunction: toHex(resolved.syntaxFunction),
		syntaxVariable: toHex(resolved.syntaxVariable),
		syntaxString: toHex(resolved.syntaxString),
		syntaxNumber: toHex(resolved.syntaxNumber),
		syntaxType: toHex(resolved.syntaxType),
		syntaxOperator: toHex(resolved.syntaxOperator),
		syntaxPunctuation: toHex(resolved.syntaxPunctuation),

		// Legacy aliases — map to closest new slot
		titleColor: toHex(resolved.primary),
		welcomeText: toHex(resolved.text),
		asciiColor: toHex(resolved.secondary),
		tipsHeader: toHex(resolved.primary),
		tipsText: toHex(resolved.textMuted),
		userHeader: toHex(resolved.accent),
		rooHeader: toHex(resolved.primary),
		toolHeader: toHex(resolved.secondary),
		thinkingHeader: toHex(resolved.border),
		userText: toHex(resolved.text),
		rooText: toHex(resolved.text),
		toolText: toHex(resolved.textMuted),
		thinkingText: toHex(resolved.textMuted),
		borderColor: toHex(resolved.border),
		borderColorActive: toHex(resolved.borderActive),
		dimText: toHex(resolved.textMuted),
		promptColor: toHex(resolved.textMuted),
		promptColorActive: toHex(resolved.primary),
		placeholderColor: toHex(resolved.border),
		successColor: toHex(resolved.success),
		errorColor: toHex(resolved.error),
		warningColor: toHex(resolved.warning),
		focusColor: toHex(resolved.secondary),
		scrollActiveColor: toHex(resolved.accent),
		scrollTrackColor: toHex(resolved.backgroundElement),
	}
}

/**
 * React hook returning the active palette as Ink hex strings.
 * Re-renders the calling component when the active theme or mode changes.
 */
export function useTheme(): ThemePalette {
	const active = useThemeStore((s) => s.active)
	const mode = useThemeStore((s) => s.mode)
	const customThemes = useThemeStore((s) => s.customThemes)
	return useMemo(() => paletteFromResolved(resolveActiveTheme({ active, mode, customThemes })), [active, mode, customThemes])
}

/** Non-component access — for callers outside React's render tree. */
export function getTheme(): ThemePalette {
	const { active, mode, customThemes } = useThemeStore.getState()
	return paletteFromResolved(resolveActiveTheme({ active, mode, customThemes }))
}

/** Resolved RGBA palette — for code that needs alpha math (e.g. tint). */
export function useResolvedTheme(): ResolvedTheme {
	const active = useThemeStore((s) => s.active)
	const mode = useThemeStore((s) => s.mode)
	const customThemes = useThemeStore((s) => s.customThemes)
	return useMemo(() => resolveActiveTheme({ active, mode, customThemes }), [active, mode, customThemes])
}

/** Convenience: get/set theme name and mode. */
export function setActiveTheme(name: string): void {
	useThemeStore.getState().setActive(name)
}

export function setThemeMode(mode: ThemeMode): void {
	useThemeStore.getState().setMode(mode)
}

export function pinThemeMode(mode?: ThemeMode): void {
	useThemeStore.getState().pin(mode)
}

export function unpinThemeMode(): void {
	useThemeStore.getState().unpin()
}

/**
 * One-shot hydrator for `App.tsx` mount: reads the persisted theme/mode lock
 * from `cli-settings.json` and pushes it into the zustand store.
 *
 * Safe to call multiple times — only the first call has effect (`ready` flag).
 */
export function useThemeHydration(input: { theme?: string; themeModeLock?: ThemeMode }): boolean {
	const ready = useThemeStore((s) => s.ready)
	const hydrated = useRef(false)

	useEffect(() => {
		if (hydrated.current) return
		hydrated.current = true
		useThemeStore.getState().hydrate({
			active: input.theme,
			lock: input.themeModeLock,
		})
	}, [input.theme, input.themeModeLock])

	return ready
}
