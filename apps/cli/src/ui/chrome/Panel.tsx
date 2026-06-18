import { Box, type BoxProps } from "ink"
import type { PropsWithChildren } from "react"

import { SPLIT_BORDER } from "./borderChars.js"

/** Sides on which to draw borders (mirrors OpenCode's `border={["left"]}` array). */
export type PanelBorderSide = "top" | "bottom" | "left" | "right"

export interface PanelProps extends Omit<BoxProps, "borderStyle" | "borderColor" | "borderTop" | "borderBottom" | "borderLeft" | "borderRight"> {
	/** Which sides to draw a border on. Defaults to no border. */
	border?: PanelBorderSide[]
	/** Border color (CSS hex). */
	borderColor?: string
	/** Override the cli-boxes BoxStyle for the border characters. Defaults to OpenCode's `SPLIT_BORDER` (`┃`). */
	borderStyle?: BoxProps["borderStyle"]
}

/**
 * `<Panel>` — Ink Box with OpenCode-compatible border semantics.
 *
 * Pass `border={["left"]}` to render only the left edge (the most common
 * pattern in OpenCode for prompt input + side rails). Defaults to OpenCode's
 * `SPLIT_BORDER` characters (`┃`). When `border` is omitted, no border is
 * drawn at all (Ink's `borderStyle` is left undefined).
 */
export function Panel({
	border,
	borderColor,
	borderStyle = SPLIT_BORDER,
	children,
	...rest
}: PropsWithChildren<PanelProps>) {
	if (!border || border.length === 0) {
		return <Box {...rest}>{children}</Box>
	}

	return (
		<Box
			{...rest}
			borderStyle={borderStyle}
			borderColor={borderColor}
			borderTop={border.includes("top")}
			borderBottom={border.includes("bottom")}
			borderLeft={border.includes("left")}
			borderRight={border.includes("right")}
		>
			{children}
		</Box>
	)
}
