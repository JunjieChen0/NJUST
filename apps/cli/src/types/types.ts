import type { ProviderName, ReasoningEffortExtended } from "@njust-ai/types"
import type { OutputFormat } from "./json-events.ts"

export const supportedProviders = [
	"anthropic",
	"bedrock",
	"baseten",
	"deepseek",
	"fireworks",
	"gemini",
	"gemini-cli",
	"mistral",
	"moonshot",
	"minimax",
	"qwen",
	"doubao",
	"glm",
	"openai-codex",
	"openai-native",
	"qwen-code",
	"sambanova",
	"vertex",
	"xai",
	"zai",
	"mimo",
	"mimo-token-plan",
	"openrouter",
	"vercel-ai-gateway",
	"litellm",
	"requesty",
	"njust-ai",
	"unbound",
	"ollama",
	"lmstudio",
	"openai",
] as const satisfies ProviderName[]

export type SupportedProvider = (typeof supportedProviders)[number]

export function isSupportedProvider(provider: string): provider is SupportedProvider {
	return supportedProviders.includes(provider as SupportedProvider)
}

export type ReasoningEffortFlagOptions = ReasoningEffortExtended | "unspecified" | "disabled"

export type FlagOptions = {
	promptFile?: string
	createWithSessionId?: string
	sessionId?: string
	continue: boolean
	workspace?: string
	print: boolean
	stdinPromptStream: boolean
	signalOnlyExit: boolean
	extension?: string
	debug: boolean
	requireApproval: boolean
	exitOnError: boolean
	apiKey?: string
	provider?: SupportedProvider
	model?: string
	mode?: string
	terminalShell?: string
	reasoningEffort?: ReasoningEffortFlagOptions
	consecutiveMistakeLimit?: number
	ephemeral: boolean
	oneshot: boolean
	outputFormat?: OutputFormat
	/** TUI engine selection: "ink" or "opentui" */
	tuiEngine?: "ink" | "opentui"
}

export enum OnboardingProviderChoice {
	NjustAI = "njust-ai",
	Byok = "byok",
}

export interface OnboardingResult {
	choice: OnboardingProviderChoice
	token?: string
	skipped: boolean
}

export interface CliSettings {
	onboardingProviderChoice?: OnboardingProviderChoice
	/** Default mode to use (e.g., "code", "architect", "ask", "debug") */
	mode?: string
	/** Default provider to use */
	provider?: SupportedProvider
	/** Default model to use */
	model?: string
	/** Default reasoning effort level */
	reasoningEffort?: ReasoningEffortFlagOptions
	/** Default consecutive error/repetition limit before guidance prompts */
	consecutiveMistakeLimit?: number
	/** Require manual approval for tools/commands/browser/MCP actions */
	requireApproval?: boolean
	/** @deprecated Legacy inverse setting kept for backward compatibility */
	dangerouslySkipPermissions?: boolean
	/** Exit upon task completion */
	oneshot?: boolean
	/** Per-provider API keys (encrypted at rest) */
	providerApiKeys?: Record<SupportedProvider, string>
}
