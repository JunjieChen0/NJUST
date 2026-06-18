import { Box, Text } from "ink"
import { Select } from "@inkjs/ui"

import { OnboardingProviderChoice, NJUST_AI_LOGO } from "@/types/index.js"
import { useTheme } from "../../theme.js"

export interface OnboardingScreenProps {
	onSelect: (choice: OnboardingProviderChoice) => void
}

export function OnboardingScreen({ onSelect }: OnboardingScreenProps) {
	const theme = useTheme()
	return (
		<Box flexDirection="column" gap={1}>
			{NJUST_AI_LOGO.map((line, i) => (
				<Text key={i} color={i === 0 ? theme.primary : theme.text} bold={i === 1}>
					{line}
				</Text>
			))}
			<Text dimColor>Welcome! How would you like to connect to an LLM provider?</Text>
			<Select
				options={[
					{ label: "Connect to NJUST_AI Cloud", value: OnboardingProviderChoice.NjustAI },
					{ label: "Bring your own API key", value: OnboardingProviderChoice.Byok },
				]}
				onChange={(value: string) => {
					onSelect(value as OnboardingProviderChoice)
				}}
			/>
		</Box>
	)
}
