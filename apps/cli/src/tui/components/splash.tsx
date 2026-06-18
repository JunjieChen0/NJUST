import { useTheme } from "../context/theme.tsx"
import { Text } from "../components/index.tsx"

const LOGO_LINES = [
	"██████╗  ██████╗  ██████╗ ",
	"██╔══██╗██╔═══██╗██╔═══██╗",
	"██████╔╝██║   ██║██║   ██║",
	"██╔══██╗██║   ██║██║   ██║",
	"██║  ██║╚██████╔╝╚██████╔╝",
	"╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ",
]

export function Splash() {
	const { theme } = useTheme()
	return (
		<box
			position="absolute"
			top={0}
			left={0}
			width="100%"
			height="100%"
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			backgroundColor={theme.colors.background}
			zIndex={2000}>
			<box flexDirection="column" alignItems="center" paddingBottom={1}>
				{LOGO_LINES.map((line) => (
					<Text color={theme.colors.primary} bold key={line}>
						{line}
					</Text>
				))}
			</box>
			<Text color={theme.colors.textMuted}>Loading...</Text>
		</box>
	)
}

export function LoadingOverlay() {
	const { theme } = useTheme()
	return (
		<box
			position="absolute"
			top={0}
			left={0}
			width="100%"
			height="100%"
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			backgroundColor={theme.colors.background}
			zIndex={1500}>
			<Text color={theme.colors.primary} bold>
				●
			</Text>
			<Text color={theme.colors.textMuted}>Running...</Text>
		</box>
	)
}
