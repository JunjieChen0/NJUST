import { useState, useMemo, useRef } from "react"
import { Box, Text, useInput } from "ink"
import { Select } from "@inkjs/ui"
import * as theme from "../theme.ts"
import { ASCII_NJUST_AI } from "@/types/constants.js"
import { supportedProviders } from "@/types/index.js"
import { setKV } from "@/lib/storage/index.js"
import type { SupportedProvider } from "@/types/index.js"

interface WelcomeScreenProps {
	onReady: (provider: SupportedProvider, apiKey: string) => void
	onExit: () => void
}

type Step = "provider" | "apikey" | "submitting"

const providerLabels: Record<SupportedProvider, string> = {
	"njust-ai": "NJUST_AI Cloud",
	anthropic: "Anthropic (Claude)",
	"openai-native": "OpenAI (GPT-4)",
	openai: "OpenAI (Compatible)",
	gemini: "Google Gemini",
	"gemini-cli": "Google Gemini CLI",
	openrouter: "OpenRouter",
	"vercel-ai-gateway": "Vercel AI Gateway",
	litellm: "LiteLLM",
	requesty: "Requesty",
	unbound: "Unbound",
	ollama: "Ollama (Local)",
	lmstudio: "LM Studio (Local)",
	bedrock: "AWS Bedrock",
	baseten: "Baseten",
	deepseek: "DeepSeek",
	fireworks: "Fireworks AI",
	mistral: "Mistral AI",
	moonshot: "Moonshot AI",
	minimax: "MiniMax",
	qwen: "Qwen (Alibaba)",
	"qwen-code": "Qwen Code",
	doubao: "Doubao (ByteDance)",
	glm: "GLM (Zhipu)",
	"openai-codex": "OpenAI Codex",
	sambanova: "SambaNova",
	vertex: "Google Vertex AI",
	xai: "xAI (Grok)",
	zai: "Z AI",
	mimo: "Mimo",
	"mimo-token-plan": "Mimo Token Plan",
}

export function WelcomeScreen({ onReady, onExit }: WelcomeScreenProps) {
	const [step, setStep] = useState<Step>("provider")
	const [provider, setProvider] = useState<SupportedProvider | undefined>()
	const [apiKey, setApiKey] = useState("")
	const apiKeyRef = useRef(apiKey)
	const providerRef = useRef(provider)
	apiKeyRef.current = apiKey
	providerRef.current = provider

	const providerOptions = useMemo(
		() =>
			supportedProviders.map((p) => ({
				label: providerLabels[p],
				value: p,
			})),
		[],
	)

	useInput((inputChar, key) => {
		if (key.escape) {
			onExit()
			return
		}
		if (step === "apikey") {
			if (key.return && apiKeyRef.current.trim().length > 0) {
				const finalKey = apiKeyRef.current.trim()
				const finalProvider = providerRef.current!
				setStep("submitting")
				void setKV("provider", finalProvider).then(() =>
					setKV("apiKey", finalKey).then(() => {
						onReady(finalProvider, finalKey)
					}),
				)
				return
			}
			if (key.backspace || key.delete) {
				setApiKey((prev) => prev.slice(0, -1))
				return
			}
			// Regular character input: allow single chars and paste chunks
			if (
				inputChar &&
				inputChar.length >= 1 &&
				!key.return &&
				!key.escape &&
				!key.tab &&
				!key.backspace &&
				!key.delete &&
				!key.upArrow &&
				!key.downArrow &&
				!key.leftArrow &&
				!key.rightArrow &&
				!key.home &&
				!key.end &&
				!key.pageUp &&
				!key.pageDown
			) {
				setApiKey((prev) => prev + inputChar)
			}
		}
	})

	if (step === "provider") {
		return (
			<Box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
				<Box flexDirection="column" gap={1} padding={2}>
					<Text color={theme.primary} bold>
						{ASCII_NJUST_AI}
					</Text>
					<Text color={theme.text} bold>
						Welcome to NJUST_AI CLI
					</Text>
					<Text color={theme.textMuted}>Select your AI provider to get started:</Text>
					<Box marginTop={1}>
						<Select
							options={providerOptions}
							onChange={(value) => {
								if (value && typeof value === "string") {
									setProvider(value as SupportedProvider)
									setStep("apikey")
								}
							}}
						/>
					</Box>
					<Text color={theme.dimText}>Esc to exit</Text>
				</Box>
			</Box>
		)
	}

	if (step === "apikey") {
		return (
			<Box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
				<Box
					flexDirection="column"
					gap={1}
					padding={2}
					borderStyle="round"
					borderColor={theme.borderColorActive}>
					<Text color={theme.primary} bold>
						{ASCII_NJUST_AI}
					</Text>
					<Text color={theme.text} bold>
						Welcome to NJUST_AI CLI
					</Text>
					<Text color={theme.textMuted}>
						Provider: <Text color={theme.text}>{providerLabels[provider!]}</Text>
					</Text>
					<Text color={theme.textMuted}>Enter your API key:</Text>
					<Box>
						<Text color={theme.promptColorActive}>{"> "}</Text>
						<Text color={theme.text}>{"*".repeat(apiKey.length)}</Text>
						<Text color={theme.promptColorActive}>█</Text>
					</Box>
					<Text color={theme.dimText}>Enter to submit • Esc to exit</Text>
				</Box>
			</Box>
		)
	}

	// step === "submitting"
	return (
		<Box flexDirection="column" justifyContent="center" alignItems="center" flexGrow={1}>
			<Box flexDirection="column" gap={1} padding={2}>
				<Text color={theme.success}>✓ API key saved. Connecting...</Text>
			</Box>
		</Box>
	)
}
