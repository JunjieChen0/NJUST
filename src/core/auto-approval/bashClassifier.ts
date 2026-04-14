export type BashRisk = "safe" | "medium" | "dangerous"

const SAFE_PREFIXES = [
	"ls",
	"dir",
	"pwd",
	"cat",
	"type",
	"find",
	"grep",
	"rg",
	"git status",
	"git log",
	"git diff",
]

const DANGEROUS_PATTERNS: RegExp[] = [
	/\brm\s+-rf\b/i,
	/\bsudo\b/i,
	/\bchmod\s+777\b/i,
	/>\s*\/dev\/(sda|disk\d)/i,
	/\|\s*(sh|bash|zsh|pwsh|powershell)\b/i,
]

const MEDIUM_PREFIXES = ["git commit", "npm install", "pnpm install", "yarn add", "pip install"]

export function classifyBashCommand(command: string): BashRisk {
	const c = command.trim().toLowerCase()
	if (!c) return "safe"
	if (DANGEROUS_PATTERNS.some((p) => p.test(command))) return "dangerous"
	if (SAFE_PREFIXES.some((p) => c.startsWith(p))) return "safe"
	if (MEDIUM_PREFIXES.some((p) => c.startsWith(p))) return "medium"
	return "medium"
}
