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

import { Show, For, createSignal } from "solid-js"
import { Text } from "../components/index.tsx"
import { Prompt } from "../components/prompt/index.tsx"
import { createDefaultTriggers } from "../components/prompt/autocomplete.tsx"
import { useTheme } from "../context/theme.tsx"
import { Dialog } from "../dialogs/index.tsx"

const defaultTriggers = createDefaultTriggers()

export interface HomeProps {
	sessions?: Array<{ id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }>
	onNewSession: () => void
	onStartTask?: (text: string) => void
	onResumeSession?: (sessionId: string) => void
	onRenameSession?: (sessionId: string, title: string) => void
	onDeleteSession?: (sessionId: string) => void
	onForkSession?: (sessionId: string) => void
	onOpenCommandPalette?: () => void
	onOpenAgentPicker?: () => void
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

	function confirmDelete(sessionId: string, title: string) {
		Dialog.confirm("Delete Session", `Delete "${title}"? This cannot be undone.`, (ok) => {
			if (ok) props.onDeleteSession?.(sessionId)
		})
	}

	function promptRename(sessionId: string, currentTitle: string) {
		Dialog.prompt("Rename Session", currentTitle, (value) => {
			if (value?.trim()) props.onRenameSession?.(sessionId, value.trim())
		})
	}

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
				<ShortcutHint keys="tab" label="agents" onClick={props.onOpenAgentPicker} />
				<ShortcutHint keys="ctrl+p" label="commands" onClick={props.onOpenCommandPalette} />
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
								<SessionRow
									session={session}
									onResume={props.onResumeSession}
									onRename={props.onRenameSession ? promptRename : undefined}
									onDelete={props.onDeleteSession ? confirmDelete : undefined}
									onFork={props.onForkSession}
								/>
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

function SessionRow(props: {
	session: { id: string; title: string; createdAt: number; updatedAt: number; messageCount: number }
	onResume?: (sessionId: string) => void
	onRename?: (sessionId: string, title: string) => void
	onDelete?: (sessionId: string, title: string) => void
	onFork?: (sessionId: string) => void
}) {
	const { theme } = useTheme()
	const [hovered, setHovered] = createSignal(false)
	return (
		<box
			flexDirection="row"
			gap={1}
			paddingY={1}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onClick={() => props.onResume?.(props.session.id)}>
			<Text color={theme.colors.primary}>›</Text>
			<box flexDirection="column" flexGrow={1}>
				<Text color={theme.colors.text} bold>
					{props.session.title}
				</Text>
				<Text color={theme.colors.textMuted}>
					{new Date(props.session.updatedAt).toLocaleString()} · {props.session.messageCount} messages
				</Text>
			</box>
			<Show when={hovered()}>
				<box flexDirection="row" gap={2}>
					<Show when={props.onRename}>
						<Text
							color={theme.colors.primary}
							onClick={(e) => {
								e.stopPropagation?.()
								props.onRename?.(props.session.id, props.session.title)
							}}
							dim>
							[Rename]
						</Text>
					</Show>
					<Show when={props.onFork}>
						<Text
							color={theme.colors.secondary}
							onClick={(e) => {
								e.stopPropagation?.()
								props.onFork?.(props.session.id)
							}}
							dim>
							[Fork]
						</Text>
					</Show>
					<Show when={props.onDelete}>
						<Text
							color={theme.colors.error}
							onClick={(e) => {
								e.stopPropagation?.()
								props.onDelete?.(props.session.id, props.session.title)
							}}
							dim>
							[Delete]
						</Text>
					</Show>
				</box>
			</Show>
		</box>
	)
}

function ShortcutHint(props: { keys: string; label: string; onClick?: () => void }) {
	const { theme } = useTheme()
	return (
		<box flexDirection="row" gap={1} onClick={props.onClick}>
			<Text color={theme.colors.text} bold>
				{props.keys}
			</Text>
			<Text color={theme.colors.textMuted}>{props.label}</Text>
		</box>
	)
}
