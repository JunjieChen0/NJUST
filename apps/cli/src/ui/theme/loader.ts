/**
 * Theme registry — loads the 33 bundled OpenCode-compatible theme JSONs and
 * provides lookup APIs.
 *
 * Static imports (with `assert { type: "json" }`) so tsup can bundle the JSON
 * payloads. Combined gzip is ~30KB.
 */

import type { ThemeJson } from "./resolve.js"

import aura from "./themes/aura.json" with { type: "json" }
import ayu from "./themes/ayu.json" with { type: "json" }
import carbonfox from "./themes/carbonfox.json" with { type: "json" }
import catppuccin from "./themes/catppuccin.json" with { type: "json" }
import catppuccinFrappe from "./themes/catppuccin-frappe.json" with { type: "json" }
import catppuccinMacchiato from "./themes/catppuccin-macchiato.json" with { type: "json" }
import cobalt2 from "./themes/cobalt2.json" with { type: "json" }
import cursor from "./themes/cursor.json" with { type: "json" }
import dracula from "./themes/dracula.json" with { type: "json" }
import everforest from "./themes/everforest.json" with { type: "json" }
import flexoki from "./themes/flexoki.json" with { type: "json" }
import github from "./themes/github.json" with { type: "json" }
import gruvbox from "./themes/gruvbox.json" with { type: "json" }
import kanagawa from "./themes/kanagawa.json" with { type: "json" }
import lucentOrng from "./themes/lucent-orng.json" with { type: "json" }
import material from "./themes/material.json" with { type: "json" }
import matrix from "./themes/matrix.json" with { type: "json" }
import mercury from "./themes/mercury.json" with { type: "json" }
import monokai from "./themes/monokai.json" with { type: "json" }
import nightowl from "./themes/nightowl.json" with { type: "json" }
import nord from "./themes/nord.json" with { type: "json" }
import oneDark from "./themes/one-dark.json" with { type: "json" }
import opencode from "./themes/opencode.json" with { type: "json" }
import orng from "./themes/orng.json" with { type: "json" }
import osakaJade from "./themes/osaka-jade.json" with { type: "json" }
import palenight from "./themes/palenight.json" with { type: "json" }
import rosepine from "./themes/rosepine.json" with { type: "json" }
import solarized from "./themes/solarized.json" with { type: "json" }
import synthwave84 from "./themes/synthwave84.json" with { type: "json" }
import tokyonight from "./themes/tokyonight.json" with { type: "json" }
import vercel from "./themes/vercel.json" with { type: "json" }
import vesper from "./themes/vesper.json" with { type: "json" }
import zenburn from "./themes/zenburn.json" with { type: "json" }

export const BUILTIN_THEMES: Record<string, ThemeJson> = {
	aura: aura as ThemeJson,
	ayu: ayu as ThemeJson,
	carbonfox: carbonfox as ThemeJson,
	catppuccin: catppuccin as ThemeJson,
	"catppuccin-frappe": catppuccinFrappe as ThemeJson,
	"catppuccin-macchiato": catppuccinMacchiato as ThemeJson,
	cobalt2: cobalt2 as ThemeJson,
	cursor: cursor as ThemeJson,
	dracula: dracula as ThemeJson,
	everforest: everforest as ThemeJson,
	flexoki: flexoki as ThemeJson,
	github: github as ThemeJson,
	gruvbox: gruvbox as ThemeJson,
	kanagawa: kanagawa as ThemeJson,
	"lucent-orng": lucentOrng as ThemeJson,
	material: material as ThemeJson,
	matrix: matrix as ThemeJson,
	mercury: mercury as ThemeJson,
	monokai: monokai as ThemeJson,
	nightowl: nightowl as ThemeJson,
	nord: nord as ThemeJson,
	"one-dark": oneDark as ThemeJson,
	opencode: opencode as ThemeJson,
	orng: orng as ThemeJson,
	"osaka-jade": osakaJade as ThemeJson,
	palenight: palenight as ThemeJson,
	rosepine: rosepine as ThemeJson,
	solarized: solarized as ThemeJson,
	synthwave84: synthwave84 as ThemeJson,
	tokyonight: tokyonight as ThemeJson,
	vercel: vercel as ThemeJson,
	vesper: vesper as ThemeJson,
	zenburn: zenburn as ThemeJson,
}

export const DEFAULT_THEME = "opencode"

export function listThemeNames(): string[] {
	return Object.keys(BUILTIN_THEMES).sort()
}

export function getThemeJson(name: string): ThemeJson | undefined {
	return BUILTIN_THEMES[name]
}
