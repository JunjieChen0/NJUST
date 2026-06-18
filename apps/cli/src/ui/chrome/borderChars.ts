/**
 * Border character sets — OpenCode-compatible.
 *
 * Ink 6's `borderStyle` accepts a `cli-boxes`-shaped object. To mirror
 * OpenCode's `SplitBorder` (left + right edges drawn with `┃` and the other
 * edges blank), we pass `borderStyle={SPLIT_BORDER}` plus
 * `borderTop={false}` + `borderBottom={false}` (or use `<Panel border=...>`).
 */

import type { BoxProps } from "ink"

/** Shape of `borderStyle` when supplied as a custom object. */
type CustomBoxStyle = Exclude<BoxProps["borderStyle"], string | undefined>

const EMPTY = " "

/**
 * `SPLIT_BORDER` — only `left`/`right` edges are drawn (with `┃`).
 *
 * Mirrors OpenCode `component/border.tsx::SplitBorder`. Pair with
 * `borderTop={false}` + `borderBottom={false}` to get the OpenCode look.
 */
export const SPLIT_BORDER: CustomBoxStyle = {
	topLeft: EMPTY,
	top: EMPTY,
	topRight: EMPTY,
	right: "┃",
	bottomRight: EMPTY,
	bottom: EMPTY,
	bottomLeft: EMPTY,
	left: "┃",
}

/**
 * `EMPTY_BORDER` — every edge is blank. Useful when you want the spatial
 * effect of a border without drawing one.
 */
export const EMPTY_BORDER: CustomBoxStyle = {
	topLeft: EMPTY,
	top: EMPTY,
	topRight: EMPTY,
	right: EMPTY,
	bottomRight: EMPTY,
	bottom: EMPTY,
	bottomLeft: EMPTY,
	left: EMPTY,
}
