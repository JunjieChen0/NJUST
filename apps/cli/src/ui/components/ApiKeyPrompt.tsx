import { useState } from "react"
import { Box, Text, useInput } from "ink"
import * as theme from "../theme.ts"
import { ASCII_NJUST_AI } from "@/types/constants.js"
import { setKV } from "@/lib/storage/index.js"

interface ApiKeyPromptProps {
	provider: string
	onSubmit: (apiKey: string) => void
	onExit: () => void
}

export function ApiKeyPrompt({ provider, onSubmit, onExit }: ApiKeyPromptProps) {
	const [apiKey, setApiKey] = useState("")
	const [submitted, setSubmitted] = useState(false)

	useInput((input, key) => {
		if (key.escape) {
			onExit()
			return
		}
		if (key.return && apiKey.trim()) {
			setSubmitted(true)
			void setKV("apiKey", apiKey.trim()).then(() => {
				onSubmit(apiKey.trim())
			})
			return
		}
		if (key.backspace) {
			setApiKey((prev) => prev.slice(0, -1))
			return
		}
		if (input && !key.ctrl && !key.meta && input.length === 1) {
			setApiKey((prev) => prev + input)
		}
	})

	return (
		<Box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
			<Box flexDirection="column" gap={1} padding={2} borderStyle="round" borderColor={theme.borderColorActive}>
				<Text color={theme.primary} bold>
					{ASCII_NJUST_AI}
				</Text>
				<Text color={theme.text} bold>
					Welcome to NJUST_AI CLI
				</Text>
				{submitted ? (
					<Text color={theme.success}>✓ API key saved. Connecting...</Text>
				) : (
					<>
						<Text color={theme.textMuted}>
							Provider: <Text color={theme.text}>{provider}</Text>
						</Text>
						<Text color={theme.textMuted}>Enter your API key to get started:</Text>
						<Box>
							<Text color={theme.promptColorActive}>{"> "}</Text>
							<Text color={theme.text}>{"*".repeat(apiKey.length)}</Text>
							<Text color={theme.promptColorActive}>█</Text>
						</Box>
						<Text color={theme.dimText}>Enter to submit • Esc to exit</Text>
					</>
				)}
			</Box>
		</Box>
	)
}
