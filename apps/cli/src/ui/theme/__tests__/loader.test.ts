import { describe, it, expect } from "vitest"

import { BUILTIN_THEMES, DEFAULT_THEME, getThemeJson, listThemeNames } from "../loader.js"
import { resolveTheme } from "../resolve.js"

describe("theme loader", () => {
	it("bundles all 33 OpenCode themes", () => {
		const names = listThemeNames()
		expect(names.length).toBe(33)
		expect(names).toContain("opencode")
		expect(names).toContain("tokyonight")
		expect(names).toContain("dracula")
		expect(names).toContain("github")
	})

	it("DEFAULT_THEME points to opencode", () => {
		expect(DEFAULT_THEME).toBe("opencode")
		expect(getThemeJson(DEFAULT_THEME)).toBeDefined()
	})

	it("getThemeJson returns undefined for unknown themes", () => {
		expect(getThemeJson("not-a-real-theme")).toBeUndefined()
	})

	it("every bundled theme resolves cleanly in both dark and light modes", () => {
		for (const name of listThemeNames()) {
			const json = BUILTIN_THEMES[name]!
			expect(() => resolveTheme(json, "dark"), `${name} dark`).not.toThrow()
			expect(() => resolveTheme(json, "light"), `${name} light`).not.toThrow()
		}
	})

	it("opencode dark theme has expected signature colors", () => {
		const theme = resolveTheme(BUILTIN_THEMES["opencode"]!, "dark")
		// The signature warm orange #fab283
		expect(theme.primary).toEqual({ r: 0xfa, g: 0xb2, b: 0x83, a: 255 })
		// Step1 background #0a0a0a
		expect(theme.background).toEqual({ r: 0x0a, g: 0x0a, b: 0x0a, a: 255 })
	})

	it("opencode light theme has expected signature colors", () => {
		const theme = resolveTheme(BUILTIN_THEMES["opencode"]!, "light")
		// Light primary #3b7dd8
		expect(theme.primary).toEqual({ r: 0x3b, g: 0x7d, b: 0xd8, a: 255 })
		// Step1 light background #ffffff
		expect(theme.background).toEqual({ r: 0xff, g: 0xff, b: 0xff, a: 255 })
	})
})
