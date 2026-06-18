import { memo, useEffect, useState } from "react"
import { Text, useStdout } from "ink"

import { Panel } from "../chrome/Panel.js"
import { useTheme } from "../theme.js"
import type { Toast, ToastType } from "../hooks/useToast.js"

interface ToastDisplayProps {
	toast: Toast | null
	/**
	 * When true, render absolutely-positioned in the top-right corner
	 * (OpenCode style). When false, render inline (legacy behaviour, used in
	 * tests and contexts where parent already lays it out).
	 *
	 * Defaults to `false` so existing call sites and snapshot tests keep
	 * working; opt-in via `floating` once App.tsx wraps the chrome.
	 */
	floating?: boolean
}

function variantColor(type: ToastType, theme: ReturnType<typeof useTheme>): string {
	switch (type) {
		case "success":
			return theme.success
		case "warning":
			return theme.warning
		case "error":
			return theme.error
		case "info":
		default:
			return theme.info
	}
}

function variantIcon(type: ToastType): string {
	switch (type) {
		case "success":
			return "✓"
		case "warning":
			return "⚠"
		case "error":
			return "✗"
		case "info":
		default:
			return "ℹ"
	}
}

/**
 * `<ToastDisplay>` — OpenCode-style toast.
 *
 * `floating={true}`: an absolutely-positioned panel in the top-right corner of
 * the terminal — backgroundPanel fill, side-border colored by variant,
 * max-width 60 (mirrors `opencode/src/cli/cmd/tui/ui/toast.tsx`).
 *
 * `floating={false}` (default): inline rendering — keeps the historical
 * Roo-Code call site behaviour (caller chooses position).
 *
 * Ink can't do real alpha fade-out, so we just unmount when the upstream
 * `useToast` hook drops the entry. The auto-dismiss timer lives there.
 */
function ToastDisplay({ toast, floating = false }: ToastDisplayProps) {
	const theme = useTheme()
	const { stdout } = useStdout()
	const [columns, setColumns] = useState(stdout?.columns ?? 80)

	useEffect(() => {
		if (!stdout) return
		const onResize = () => setColumns(stdout.columns ?? 80)
		stdout.on("resize", onResize)
		return () => {
			stdout.off("resize", onResize)
		}
	}, [stdout])

	if (!toast) return null

	const color = variantColor(toast.type, theme)
	const icon = variantIcon(toast.type)
	// Match OpenCode's `Math.min(60, dimensions().width - 6)` clamp.
	const maxWidth = Math.max(20, Math.min(60, columns - 6))
	const truncated =
		toast.message.length > maxWidth - 4 ? toast.message.slice(0, maxWidth - 7) + "..." : toast.message

	if (!floating) {
		// Inline mode — single line of text. Used in tests and current call
		// sites until App.tsx adopts the floating chrome.
		return (
			<Text>
				<Text color={color}>{icon}</Text> <Text color={theme.text}>{truncated}</Text>
			</Text>
		)
	}

	return (
		<Panel
			position="absolute"
			marginTop={1}
			marginRight={1}
			alignSelf="flex-end"
			border={["left", "right"]}
			borderColor={color}
			backgroundColor={theme.backgroundPanel}
			paddingLeft={2}
			paddingRight={2}
		>
			<Text color={theme.text} wrap="truncate-end">
				<Text color={color}>{icon}</Text> {truncated}
			</Text>
		</Panel>
	)
}

export default memo(ToastDisplay)
