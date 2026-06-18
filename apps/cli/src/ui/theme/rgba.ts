/**
 * RGBA color primitive — pure TypeScript, Ink-friendly.
 *
 * Ink consumes CSS hex strings (#rrggbb) for `color`/`backgroundColor`. We keep
 * the alpha channel internally so we can do tint/blend math; serialization to
 * Ink drops the alpha (Ink writes opaque cells only — see plan §0).
 */

export interface RGBA {
	readonly r: number
	readonly g: number
	readonly b: number
	readonly a: number
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

function clamp(value: number, min = 0, max = 255): number {
	if (value < min) return min
	if (value > max) return max
	return value
}

export function rgba(r: number, g: number, b: number, a = 255): RGBA {
	return { r: clamp(Math.round(r)), g: clamp(Math.round(g)), b: clamp(Math.round(b)), a: clamp(Math.round(a)) }
}

export function rgbaFromHex(hex: string): RGBA {
	if (!HEX_RE.test(hex)) {
		throw new Error(`Invalid hex color: ${hex}`)
	}
	const body = hex.slice(1)
	if (body.length === 3) {
		const r = Number.parseInt(body[0]! + body[0]!, 16)
		const g = Number.parseInt(body[1]! + body[1]!, 16)
		const b = Number.parseInt(body[2]! + body[2]!, 16)
		return rgba(r, g, b)
	}
	if (body.length === 6) {
		return rgba(
			Number.parseInt(body.slice(0, 2), 16),
			Number.parseInt(body.slice(2, 4), 16),
			Number.parseInt(body.slice(4, 6), 16),
		)
	}
	// 8-digit: #rrggbbaa
	return rgba(
		Number.parseInt(body.slice(0, 2), 16),
		Number.parseInt(body.slice(2, 4), 16),
		Number.parseInt(body.slice(4, 6), 16),
		Number.parseInt(body.slice(6, 8), 16),
	)
}

/** Serialize an RGBA back to a #rrggbb hex string for Ink. Alpha is dropped. */
export function toHex(color: RGBA): string {
	const hex = (n: number) => clamp(Math.round(n)).toString(16).padStart(2, "0")
	return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`
}

/**
 * Linear blend of `over` onto `base` weighted by alpha.
 *
 * Mirrors OpenCode's `tint(base, alpha, over)` (see context/theme.tsx). Used
 * for diffAddedBg/diffRemovedBg etc. derived from `theme.background +
 * ansiColors.green` at low alpha.
 */
export function tint(base: RGBA, alpha: number, over: RGBA): RGBA {
	const a = clamp(alpha, 0, 1)
	return rgba(base.r * (1 - a) + over.r * a, base.g * (1 - a) + over.g * a, base.b * (1 - a) + over.b * a)
}

/** Pick foreground (black/white) based on the luminance of `bg`. */
export function selectedForeground(bg: RGBA): RGBA {
	const luminance = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b
	return luminance > 128 ? rgba(0, 0, 0) : rgba(255, 255, 255)
}

/**
 * Convert an ANSI 256 code to RGBA. Mirrors OpenCode's `ansiToRgba`.
 * Used when JSON refs use numeric ANSI codes.
 */
export function ansiToRgba(code: number): RGBA {
	if (code < 16) {
		const ansi = [
			"#000000",
			"#800000",
			"#008000",
			"#808000",
			"#000080",
			"#800080",
			"#008080",
			"#c0c0c0",
			"#808080",
			"#ff0000",
			"#00ff00",
			"#ffff00",
			"#0000ff",
			"#ff00ff",
			"#00ffff",
			"#ffffff",
		]
		return rgbaFromHex(ansi[code] ?? "#000000")
	}
	if (code < 232) {
		const i = code - 16
		const b = i % 6
		const g = Math.floor(i / 6) % 6
		const r = Math.floor(i / 36)
		const v = (x: number) => (x === 0 ? 0 : x * 40 + 55)
		return rgba(v(r), v(g), v(b))
	}
	if (code < 256) {
		const gray = (code - 232) * 10 + 8
		return rgba(gray, gray, gray)
	}
	return rgba(0, 0, 0)
}
