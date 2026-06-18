import type { ProviderName, ReasoningEffortExtended } from "@njust-ai/types"
import type { OutputFormat } from "./json-events.js"

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
	provider?: ProviderName
	model?: string
	mode?: string
	terminalShell?: string
	reasoningEffort?: ReasoningEffortFlagOptions
	consecutiveMistakeLimit?: number
	ephemeral: boolean
	oneshot: boolean
	outputFormat?: OutputFormat
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
	provider?: ProviderName
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
	/** Active theme name (one of the bundled OpenCode-compatible themes) */
	theme?: string
	/** Locked theme mode — when set, user pinned dark/light explicitly */
	themeModeLock?: "dark" | "light"
	/**
	 * Per-provider API keys persisted via the `/connect` slash command.
	 * Stored on disk in `cli-settings.json` (mode 0o600). At startup the
	 * matching entry is injected into `process.env` for the corresponding
	 * provider env var (e.g. `OPENROUTER_API_KEY`). Plain text — not
	 * encrypted; suitable for local development. For production use prefer
	 * native env vars or a secret manager.
	 */
	apiKeysByProvider?: Record<string, string>
}
