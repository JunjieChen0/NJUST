/**
 * Home Route - OpenCode-aligned Immersive Welcome
 *
 * Full-screen centered layout with:
 *   - Pixel-style ASCII logo (centered)
 *   - Card-style prompt input with blue accent border
 *   - Provider / model hint below input
 *   - Footer shortcuts and tips
 *
 * Designed to be the entry point before any session starts.
 */

import { Show, type JSX } from "solid-js"
import { Text } from "../components/index.tsx"
import { useTheme } from "../context/theme.tsx"

export interface HomeProps {
	sessions?: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }>
	onNewSession: () => void
	onResumeSession?: (sessionId: string) => void
	onOpenCommandPalette?: () => void
	currentProvider?: string
	currentModel?: string
	currentMode?: string
	workspacePath?: string
	version?: string
}

// Pixel-style ASCII art for "roo" (similar to OpenCode's pixel logo)
const LOGO_LINES = [
	"██████╗  ██████╗  ██████╗ ",
	"██╔══██╗██╔═══██╗██╔═══██╗",
	"██████╔╝██║   ██║██║   ██║",
	"██╔══██╗██║   ██║██║   ██║",
	"██║  ██║╚██████╔╝╚██████╔╝",
	"╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ",
]

export function Home(props: HomeProps) {
	const { theme } = useTheme()

	return (
		<box
			flexDirection="column"
			flexGrow={1}
			alignItems="center"
			justifyContent="center"
			backgroundColor={theme.colors.background}>
			{/* Spacer to push content to visual center */}
			<box flexGrow={1} />

			{/* Logo */}
			<box flexDirection="column" alignItems="center" paddingBottom={2}>
				<For each={LOGO_LINES}>
					{(line) => (
						<Text color={theme.colors.textMuted} dim>
							{line}
						</Text>
					)}
				</For>
			</box>

			{/* Input card */}
			<box
				flexDirection="column"
				width={60}
				borderStyle="single"
				borderColor={theme.colors.border}
				backgroundColor={theme.colors.backgroundElement}>
				{/* Blue accent left border simulation */}
				<box flexDirection="row">
					<box width={1} backgroundColor={theme.colors.primary} />
					<box
						flexDirection="column"
						paddingLeft={1}
						paddingRight={1}
						paddingTop={1}
						paddingBottom={1}
						flexGrow={1}>
						{/* Placeholder text */}
						<Text color={theme.colors.textMuted} dim>
							Ask anything... "What is the tech stack of this project?"
						</Text>

						{/* Provider / model hint */}
						<Show when={props.currentProvider || props.currentModel}>
							<box flexDirection="row" gap={1} paddingTop={1}>
								<Text color={theme.colors.primary} bold>
									{props.currentMode || "Build"}
								</Text>
								<Text color={theme.colors.textMuted}>·</Text>
								<Text color={theme.colors.textMuted}>
									{props.currentProvider}
									{props.currentModel ? ` ${props.currentModel}` : ""}
								</Text>
							</box>
						</Show>
					</box>
				</box>
			</box>

			{/* Shortcuts hint */}
			<box flexDirection="row" gap={3} paddingTop={1}>
				<ShortcutHint keys="tab" label="agents" />
				<ShortcutHint keys="ctrl+p" label="commands" />
			</box>

			{/* Spacer */}
			<box flexGrow={2} />

			{/* Footer tip */}
			<box flexDirection="row" gap={1} paddingBottom={1}>
				<Text color={theme.colors.warning}>● Tip</Text>
				<Text color={theme.colors.textMuted}>Set "share": "auto" to automatically share all sessions</Text>
			</box>
		</box>
	)
}

// =============================================================================
// Sub-components
// =============================================================================

function For(props: { each: string[]; children: (item: string) => JSX.Element }) {
	return <>{props.each.map(props.children)}</>
}

function ShortcutHint(props: { keys: string; label: string }) {
	const { theme } = useTheme()
	return (
		<box flexDirection="row" gap={1}>
			<Text color={theme.colors.text} bold>
				{props.keys}
			</Text>
			<Text color={theme.colors.textMuted}>{props.label}</Text>
		</box>
	)
}
