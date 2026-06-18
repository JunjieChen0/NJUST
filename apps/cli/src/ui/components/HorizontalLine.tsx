import { Text } from "ink"

import { useTheme } from "../theme.js"
import { useTerminalSize } from "../hooks/TerminalSizeContext.js"

interface HorizontalLineProps {
	active?: boolean
}

export function HorizontalLine({ active = false }: HorizontalLineProps) {
	const theme = useTheme()
	const { columns } = useTerminalSize()
	const color = active ? theme.borderColorActive : theme.borderColor
	return <Text color={color}>{"─".repeat(columns)}</Text>
}
