import njustAiTheme from "./njust-ai.json" with { type: "json" }

export type ThemeMode = "dark" | "light"

export interface ThemeDef {
	dark: string
	light: string
}

export interface Theme {
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
	border: string
	borderActive: string
	borderSubtle: string
}

interface RawThemeJson {
	defs: Record<string, string>
	theme: Record<string, ThemeDef>
}

const themes: Record<string, RawThemeJson> = {
	"njust-ai": njustAiTheme as unknown as RawThemeJson,
}

let currentThemeName = "njust-ai"
let currentMode: ThemeMode = "dark"

function resolveColor(value: string, defs: Record<string, string>): string {
	if (value.startsWith("#")) return value
	return defs[value] ?? value
}

export function loadTheme(name: string, mode: ThemeMode = "dark"): Theme {
	const raw = themes[name]
	if (!raw) throw new Error(`Theme "${name}" not found`)

	const defs = raw.defs
	const result = {} as Record<string, string>

	for (const [key, def] of Object.entries(raw.theme)) {
		const colorValue = mode === "dark" ? def.dark : def.light
		result[key] = resolveColor(colorValue, defs)
	}

	currentThemeName = name
	currentMode = mode

	return result as unknown as Theme
}

export function getCurrentTheme(): Theme {
	return loadTheme(currentThemeName, currentMode)
}

export function getCurrentThemeName(): string {
	return currentThemeName
}

export function getCurrentMode(): ThemeMode {
	return currentMode
}

export function setTheme(name: string, mode?: ThemeMode) {
	currentThemeName = name
	if (mode) currentMode = mode
}

export function listThemes(): string[] {
	return Object.keys(themes)
}

export function registerTheme(name: string, theme: RawThemeJson) {
	themes[name] = theme
}
