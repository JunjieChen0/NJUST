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

import { Show, For, type JSX } from "solid-js"
import { Text } from "../components/index.tsx"
import { Prompt } from "../components/prompt/index.tsx"
import { createDefaultTriggers } from "../components/prompt/autocomplete.tsx"
import { useTheme } from "../context/theme.tsx"

const defaultTriggers = createDefaultTriggers()

export interface HomeProps {
	sessions?: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }>
	onNewSession: () => void
	onStartTask?: (text: string) => void
	onResumeSession?: (sessionId: string) => void
	onOpenCommandPalette?: () => void
	currentProvider?: string
	currentModel?: string
	currentMode?: string
	workspacePath?: string
	version?: string
}

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
	const sessions = () => props.sessions || []

	return (
		<box
			flexDirection="column"
			flexGrow={1}
			alignItems="center"
			justifyContent="center"
			backgroundColor={theme.colors.background}>
			<box flexGrow={1} />

			<box flexDirection="column" alignItems="center" paddingBottom={1}>
				<For each={LOGO_LINES}>
					{(line) => (
						<Text color={theme.colors.textMuted} dim>
							{line}
						</Text>
					)}
				</For>
			</box>

			<box
				flexDirection="column"
				width={60}
				borderStyle="single"
				borderColor={theme.colors.border}
				backgroundColor={theme.colors.backgroundElement}>
				<box flexDirection="row">
					<box width={1} backgroundColor={theme.colors.primary} />
					<box
						flexDirection="column"
						paddingLeft={1}
						paddingRight={1}
						paddingTop={1}
						paddingBottom={1}
						flexGrow={1}>
						<Prompt
							onSubmit={(text) => props.onStartTask?.(text)}
							placeholder='Ask anything... "What is the tech stack of this project?"'
							triggers={defaultTriggers}
							metadata={{
								provider: props.currentProvider,
								model: props.currentModel,
								mode: props.currentMode,
							}}
						/>
					</box>
				</box>
			</box>

			<box flexDirection="row" gap={3} paddingTop={1}>
				<ShortcutHint keys="tab" label="agents" />
				<ShortcutHint keys="ctrl+p" label="commands" />
				<ShortcutHint keys="ctrl+r" label="resume" />
			</box>

			<Show when={sessions().length > 0}>
				<box flexDirection="column" width={60} paddingTop={2}>
					<Text color={theme.colors.textMuted} bold>
						Recent sessions
					</Text>
					<box flexDirection="column" paddingTop={1}>
						<For each={sessions().slice(0, 5)}>
							{(session) => (
								<box
									flexDirection="row"
									gap={1}
									paddingY={1}
									onClick={() => props.onResumeSession?.(session.id)}>
									<Text color={theme.colors.primary}>›</Text>
									<box flexDirection="column" flexGrow={1}>
										<Text color={theme.colors.text} bold>
											{session.title}
										</Text>
										<Text color={theme.colors.textMuted}>
											{new Date(session.updatedAt).toLocaleString()} · {session.messageCount}{" "}
											messages
										</Text>
									</box>
								</box>
							)}
						</For>
					</box>
				</box>
			</Show>

			<box flexGrow={2} />

			<box flexDirection="row" gap={1} paddingBottom={1}>
				<Text color={theme.colors.warning}>● Tip</Text>
				<Text color={theme.colors.textMuted}>Set "share": "auto" to automatically share all sessions</Text>
			</box>
		</box>
	)
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
