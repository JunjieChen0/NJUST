/**
 * `<SessionFooter>` — bottom-of-screen status bar.
 *
 * Mirrors OpenCode `routes/session/footer.tsx`: directory on the left,
 * status chips on the right (LSP/MCP/Permissions counts, plus a `/status`
 * hint). Roo-Code's extension doesn't currently surface live LSP/MCP counts
 * to the CLI, so those slots are wired but conditional — they appear only
 * when the upstream data is non-zero.
 */

import { memo } from "react"
import { Box, Text } from "ink"
import path from "path"

import { useTheme } from "../theme.js"
import { useFooterWelcome } from "../hooks/useFooterWelcome.js"

export interface SessionFooterProps {
	/** Absolute workspace path; will be tilde-shortened relative to $HOME. */
	workspacePath?: string
	/** Number of LSP servers currently active. Hidden when 0/undefined. */
	lspCount?: number
	/** Number of MCP servers connected. Hidden when 0/undefined. */
	mcpCount?: number
	/** True when at least one MCP server is in `failed` state. */
	mcpHasError?: boolean
	/** Number of pending permission requests. Hidden when 0/undefined. */
	permissionCount?: number
	/** Show the `/status` slash-command hint at the right end. */
	showStatusHint?: boolean
	/**
	 * Whether a provider is currently connected. When `false` (the default),
	 * the footer periodically shows a `Get started /connect` nudge, mirroring
	 * OpenCode's `routes/session/footer.tsx`. When `true`, the nudge never
	 * appears and the normal status row is shown.
	 */
	connected?: boolean
}

function tildeShorten(p: string): string {
	const home = process.env.HOME || process.env.USERPROFILE
	if (!home) return p
	const normHome = home.replace(/[\\/]+$/, "")
	const normP = path.normalize(p)
	if (normP === normHome) return "~"
	if (normP.startsWith(normHome + path.sep)) {
		return "~" + normP.slice(normHome.length).replace(/\\/g, "/")
	}
	return p
}

function SessionFooter({
	workspacePath,
	lspCount,
	mcpCount,
	mcpHasError,
	permissionCount,
	showStatusHint = true,
	connected = false,
}: SessionFooterProps) {
	const theme = useTheme()
	const dir = workspacePath ? tildeShorten(workspacePath) : ""
	const hasPermissions = (permissionCount ?? 0) > 0
	const hasLsp = (lspCount ?? 0) > 0
	const hasMcp = (mcpCount ?? 0) > 0

	// OpenCode-style welcome nudge: only toggles when not connected.
	const welcome = useFooterWelcome(connected)

	return (
		<Box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
			<Text color={theme.textMuted}>{dir}</Text>
			<Box flexDirection="row" gap={2} flexShrink={0}>
				{welcome ? (
					<Text color={theme.text}>
						Get started <Text color={theme.textMuted}>/connect</Text>
					</Text>
				) : (
					<>
						{hasPermissions && (
							<Text color={theme.warning}>
								<Text color={theme.warning}>△</Text> {permissionCount} Permission
								{permissionCount! > 1 ? "s" : ""}
							</Text>
						)}
						{hasLsp && (
							<Text color={theme.text}>
								<Text color={theme.success}>●</Text> {lspCount} LSP
							</Text>
						)}
						{hasMcp && (
							<Text color={theme.text}>
								<Text color={mcpHasError ? theme.error : theme.success}>⊙</Text> {mcpCount} MCP
							</Text>
						)}
						{showStatusHint && <Text color={theme.textMuted}>/status</Text>}
					</>
				)}
			</Box>
		</Box>
	)
}

export default memo(SessionFooter)
