import { describe, it, expect } from "vitest"

import { resolveTheme, type ThemeJson } from "../resolve.js"

const minimalTheme: ThemeJson = {
	defs: {
		stepBg: "#0a0a0a",
		stepText: "#eeeeee",
	},
	theme: {
		primary: "#fab283",
		text: "stepText",
		background: "stepBg",
		// Other fields fall back; we only check the ones we set
		secondary: "#5c9cf5",
		accent: "#9d7cd8",
		error: "#e06c75",
		warning: "#f5a742",
		success: "#7fd88f",
		info: "#56b6c2",
		textMuted: "#808080",
		backgroundPanel: "#141414",
		backgroundElement: "#1e1e1e",
		border: "#484848",
		borderActive: "#606060",
		borderSubtle: "#3c3c3c",
	},
}

const variantTheme: ThemeJson = {
	theme: {
		primary: { dark: "#fab283", light: "#3b7dd8" },
		text: { dark: "#eeeeee", light: "#1a1a1a" },
		background: { dark: "#0a0a0a", light: "#ffffff" },
		secondary: "#5c9cf5",
		accent: "#9d7cd8",
		error: "#e06c75",
		warning: "#f5a742",
		success: "#7fd88f",
		info: "#56b6c2",
		textMuted: "#808080",
		backgroundPanel: "#141414",
		backgroundElement: "#1e1e1e",
		border: "#484848",
		borderActive: "#606060",
		borderSubtle: "#3c3c3c",
	},
}

const cyclicTheme: ThemeJson = {
	defs: { a: "b", b: "a" },
	theme: { primary: "a", text: "#fff", background: "#000" },
}

describe("resolveTheme", () => {
	it("resolves direct hex strings", () => {
		const theme = resolveTheme(minimalTheme, "dark")
		expect(theme.primary).toEqual({ r: 0xfa, g: 0xb2, b: 0x83, a: 255 })
	})

	it("resolves refs through defs", () => {
		const theme = resolveTheme(minimalTheme, "dark")
		expect(theme.text).toEqual({ r: 0xee, g: 0xee, b: 0xee, a: 255 })
		expect(theme.background).toEqual({ r: 0x0a, g: 0x0a, b: 0x0a, a: 255 })
	})

	it("resolves variants by mode", () => {
		const dark = resolveTheme(variantTheme, "dark")
		const light = resolveTheme(variantTheme, "light")
		expect(dark.primary).toEqual({ r: 0xfa, g: 0xb2, b: 0x83, a: 255 })
		expect(light.primary).toEqual({ r: 0x3b, g: 0x7d, b: 0xd8, a: 255 })
		expect(dark.text).toEqual({ r: 0xee, g: 0xee, b: 0xee, a: 255 })
		expect(light.text).toEqual({ r: 0x1a, g: 0x1a, b: 0x1a, a: 255 })
	})

	it("throws on circular references", () => {
		expect(() => resolveTheme(cyclicTheme, "dark")).toThrow(/Circular/)
	})

	it("uses fallback when slot missing", () => {
		// minimalTheme has no syntaxComment; resolver fills with FALLBACK_WHITE
		const theme = resolveTheme(minimalTheme, "dark")
		expect(theme.syntaxComment).toEqual({ r: 238, g: 238, b: 238, a: 255 })
	})

	it("treats 'transparent' as alpha 0", () => {
		const transparentTheme: ThemeJson = {
			theme: {
				primary: "transparent",
				text: "#fff",
				background: "#000",
				secondary: "#000",
				accent: "#000",
				error: "#000",
				warning: "#000",
				success: "#000",
				info: "#000",
				textMuted: "#000",
				backgroundPanel: "#000",
				backgroundElement: "#000",
				border: "#000",
				borderActive: "#000",
				borderSubtle: "#000",
			},
		}
		const theme = resolveTheme(transparentTheme, "dark")
		expect(theme.primary).toEqual({ r: 0, g: 0, b: 0, a: 0 })
	})

	it("falls back selectedListItemText to background when omitted", () => {
		const theme = resolveTheme(minimalTheme, "dark")
		expect(theme.selectedListItemText).toEqual(theme.background)
		expect(theme._hasSelectedListItemText).toBe(false)
	})

	it("uses thinkingOpacity when present, else 0.6", () => {
		expect(resolveTheme(minimalTheme, "dark").thinkingOpacity).toBe(0.6)
		const withOpacity: ThemeJson = {
			defs: minimalTheme.defs,
			theme: { ...minimalTheme.theme, thinkingOpacity: 0.4 },
		}
		expect(resolveTheme(withOpacity, "dark").thinkingOpacity).toBe(0.4)
	})
})
