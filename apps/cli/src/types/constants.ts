import { reasoningEffortsExtended } from "@njust-ai/types"

export const DEFAULT_FLAGS = {
	mode: "code",
	reasoningEffort: "medium" as const,
	model: "anthropic/claude-opus-4.6",
	consecutiveMistakeLimit: 10,
}

export const REASONING_EFFORTS = [...reasoningEffortsExtended, "unspecified", "disabled"]

/**
 * Default timeout in seconds for auto-approving followup questions.
 * Used in both the TUI (App.tsx) and the extension host (extension-host.ts).
 */
export const FOLLOWUP_TIMEOUT_SECONDS = 60

/**
 * Five-line block ASCII logo for the empty-home state of the TUI.
 * Reads as `NJUST_AI`; rendered in pure black to keep the wordmark
 * crisp against the muted terminal background.
 *
 * Compressed from a 7-row Standard/Big block font down to 5 rows by
 * dropping the two interior repeated rows of each glyph; this keeps
 * the brand legible while reclaiming vertical space for the prompt.
 *
 * Rows 1 and 5 are nudged 3 cells right so the wider top/bottom
 * strokes of `N` line up with the rest of the letters.
 */
export const NJUST_AI_LOGO = [
	"   ███    ██        ██████  ██    ██  ███████  ████████          ██████  ████████",
	"████   ██           ██   ██    ██  ██          ██             ██    ██    ██",
	"██  ██ ██           ██   ██    ██  ███████     ██             ████████    ██",
	"██   ████    ██     ██   ██    ██       ██     ██             ██    ██    ██",
	"   ██     ██     ██████      ██████   ███████     ██    ██████   ██    ██ ████████",
]

export const AUTH_BASE_URL = process.env.NJUST_AI_AUTH_BASE_URL ?? ""

export const SDK_BASE_URL = process.env.NJUST_AI_SDK_BASE_URL ?? ""
