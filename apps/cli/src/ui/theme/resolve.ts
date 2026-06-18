/**
 * Theme JSON schema (compatible with OpenCode's https://opencode.ai/theme.json).
 *
 * A theme has two layers:
 *   - `defs`: named hex/ref aliases (e.g. `darkStep1: "#0a0a0a"`)
 *   - `theme`: the actual color slots, where each slot can be:
 *     - a hex color string
 *     - a ref name pointing into `defs` or another slot
 *     - a Variant object with separate dark/light values
 */

import { ansiToRgba, rgba, rgbaFromHex, type RGBA, tint } from "./rgba.js"

export type HexColor = `#${string}`
export type RefName = string
export type Variant = { dark: HexColor | RefName; light: HexColor | RefName }
export type ColorValue = HexColor | RefName | Variant | number

export interface ThemeJson {
	$schema?: string
	defs?: Record<string, HexColor | RefName>
	theme: Partial<Record<keyof ResolvedThemeColors, ColorValue>> & {
		thinkingOpacity?: number
	}
}

/**
 * Every color slot OpenCode's theme system exposes. Mirrors the `theme.tsx`
 * field names so JSONs from the OpenCode repo drop in unchanged.
 */
export interface ResolvedThemeColors {
	primary: RGBA
	secondary: RGBA
	accent: RGBA
	error: RGBA
	warning: RGBA
	success: RGBA
	info: RGBA
	text: RGBA
	textMuted: RGBA
	background: RGBA
	backgroundPanel: RGBA
	backgroundElement: RGBA
	backgroundMenu: RGBA
	border: RGBA
	borderActive: RGBA
	borderSubtle: RGBA
	selectedListItemText: RGBA

	diffAdded: RGBA
	diffRemoved: RGBA
	diffContext: RGBA
	diffHunkHeader: RGBA
	diffHighlightAdded: RGBA
	diffHighlightRemoved: RGBA
	diffAddedBg: RGBA
	diffRemovedBg: RGBA
	diffContextBg: RGBA
	diffLineNumber: RGBA
	diffAddedLineNumberBg: RGBA
	diffRemovedLineNumberBg: RGBA

	markdownText: RGBA
	markdownHeading: RGBA
	markdownLink: RGBA
	markdownLinkText: RGBA
	markdownCode: RGBA
	markdownBlockQuote: RGBA
	markdownEmph: RGBA
	markdownStrong: RGBA
	markdownHorizontalRule: RGBA
	markdownListItem: RGBA
	markdownListEnumeration: RGBA
	markdownImage: RGBA
	markdownImageText: RGBA
	markdownCodeBlock: RGBA

	syntaxComment: RGBA
	syntaxKeyword: RGBA
	syntaxFunction: RGBA
	syntaxVariable: RGBA
	syntaxString: RGBA
	syntaxNumber: RGBA
	syntaxType: RGBA
	syntaxOperator: RGBA
	syntaxPunctuation: RGBA
}

export interface ResolvedTheme extends ResolvedThemeColors {
	thinkingOpacity: number
	_hasSelectedListItemText: boolean
}

const FALLBACK_BLACK: RGBA = rgba(0, 0, 0)
const FALLBACK_WHITE: RGBA = rgba(238, 238, 238)

/**
 * Resolve a theme JSON to concrete RGBA values for the requested mode.
 *
 * Mirrors OpenCode's `resolveTheme` (context/theme.tsx:198+):
 *   - hex string → parse
 *   - "transparent"/"none" → fully transparent black
 *   - ref name → look up in defs first, then theme; recurse with cycle guard
 *   - Variant {dark,light} → pick by mode and recurse
 *   - number → ANSI 256 code
 */
export function resolveTheme(theme: ThemeJson, mode: "dark" | "light"): ResolvedTheme {
	const defs = theme.defs ?? {}

	function resolveColor(value: ColorValue, chain: string[] = []): RGBA {
		if (typeof value === "number") {
			return ansiToRgba(value)
		}
		if (typeof value === "string") {
			if (value === "transparent" || value === "none") {
				return rgba(0, 0, 0, 0)
			}
			if (value.startsWith("#")) {
				return rgbaFromHex(value)
			}
			if (chain.includes(value)) {
				throw new Error(`Circular color reference: ${[...chain, value].join(" -> ")}`)
			}
			const next = defs[value] ?? (theme.theme as Record<string, ColorValue | undefined>)[value]
			if (next === undefined) {
				throw new Error(`Color reference "${value}" not found in defs or theme`)
			}
			return resolveColor(next, [...chain, value])
		}
		// Variant
		const picked = value[mode]
		return resolveColor(picked, chain)
	}

	const slots = theme.theme as Record<string, ColorValue | number | undefined>
	const out = {} as ResolvedThemeColors

	const fields: (keyof ResolvedThemeColors)[] = [
		"primary",
		"secondary",
		"accent",
		"error",
		"warning",
		"success",
		"info",
		"text",
		"textMuted",
		"background",
		"backgroundPanel",
		"backgroundElement",
		"border",
		"borderActive",
		"borderSubtle",
		"diffAdded",
		"diffRemoved",
		"diffContext",
		"diffHunkHeader",
		"diffHighlightAdded",
		"diffHighlightRemoved",
		"diffAddedBg",
		"diffRemovedBg",
		"diffContextBg",
		"diffLineNumber",
		"diffAddedLineNumberBg",
		"diffRemovedLineNumberBg",
		"markdownText",
		"markdownHeading",
		"markdownLink",
		"markdownLinkText",
		"markdownCode",
		"markdownBlockQuote",
		"markdownEmph",
		"markdownStrong",
		"markdownHorizontalRule",
		"markdownListItem",
		"markdownListEnumeration",
		"markdownImage",
		"markdownImageText",
		"markdownCodeBlock",
		"syntaxComment",
		"syntaxKeyword",
		"syntaxFunction",
		"syntaxVariable",
		"syntaxString",
		"syntaxNumber",
		"syntaxType",
		"syntaxOperator",
		"syntaxPunctuation",
	]

	for (const field of fields) {
		const raw = slots[field]
		if (raw === undefined) {
			// Missing fields fall back: text/background to black/white, others to text.
			if (field === "text") out[field] = FALLBACK_WHITE
			else if (field === "background") out[field] = FALLBACK_BLACK
			else out[field] = FALLBACK_WHITE
			continue
		}
		out[field] = resolveColor(raw as ColorValue)
	}

	// Optional slots with fallbacks
	const hasSelectedListItemText = slots.selectedListItemText !== undefined
	out.selectedListItemText = hasSelectedListItemText
		? resolveColor(slots.selectedListItemText as ColorValue)
		: out.background
	out.backgroundMenu =
		slots.backgroundMenu !== undefined ? resolveColor(slots.backgroundMenu as ColorValue) : out.backgroundElement

	const thinkingOpacity = typeof theme.theme.thinkingOpacity === "number" ? theme.theme.thinkingOpacity : 0.6

	return {
		...out,
		thinkingOpacity,
		_hasSelectedListItemText: hasSelectedListItemText,
	}
}

/**
 * Re-export tint here for convenience — many call sites want both
 * `useTheme()` and `tint()` from the same import.
 */
export { tint }
