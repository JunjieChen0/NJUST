/**
 * Tool restrictions for check-only Cangjie work (verify requests and read-only agents):
 * they may read, search, build and test, but never change sources by any route.
 */

const WRITE_TOOLS = [
	"write_to_file",
	"apply_diff",
	"edit",
	"search_and_replace",
	"search_replace",
	"edit_file",
	"apply_patch",
	"notebook_edit",
	"generate_image",
]

/** Tools whose effects are opaque or that start other work which could write files. */
const OPAQUE_TOOLS = [
	"use_mcp_tool",
	"custom_tool",
	"run_slash_command",
	"skill",
	"new_task",
	"task_create",
	// Leaving Cangjie mode would drop the route-based check-only guard.
	"switch_mode",
]

const BLOCKED_TOOLS = new Set([...WRITE_TOOLS, ...OPAQUE_TOOLS])

const READ_ONLY_AGENT_TYPES = new Set(["CangjieExplore", "CangjieVerify"])

/**
 * Shell features that could chain another command, redirect output into a file, or run a nested
 * expression (PowerShell evaluates `( )`, `@( )` and `{ }` before the outer command).
 */
const SHELL_SIDE_EFFECT_RE = /[;&|`$%<>(){}@'"^\r\n]/
const CJPM_READ_ONLY_ARGS = new Set(["build", "check", "test", "--version", "--help"])
const CJC_READ_ONLY_ARGS = new Set(["--version", "-v", "--help"])

export function isReadOnlyCangjieAgent(agentType: string | undefined): boolean {
	return agentType !== undefined && READ_ONLY_AGENT_TYPES.has(agentType)
}

/** Split "<exe> args..." where the executable may be a quoted path with spaces. */
function splitCommand(command: string): { tool: string; args: string[] } {
	const quoted = command.match(/^(["'])(.*?)\1(?:\s+|$)(.*)$/)
	const [exe = "", ...args] = quoted ? [quoted[2] ?? "", ...(quoted[3] ?? "").split(/\s+/)] : command.split(/\s+/)
	const tool = (exe.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.exe$/, "")
	return { tool, args: args.filter(Boolean) }
}

function isReadOnlyCommand(command: string): boolean {
	const { tool, args } = splitCommand(command)
	switch (tool) {
		case "cjpm":
			return (
				(args.length === 1 && CJPM_READ_ONLY_ARGS.has(args[0]!)) ||
				(args.length === 3 && args[0] === "test" && args[1] === "--filter" && !args[2]!.startsWith("-")) ||
				(args.length === 2 && args[0] === "test" && /^--filter=[^-\s].*$/.test(args[1]!))
			)
		case "cjc":
			return args.length === 1 && CJC_READ_ONLY_ARGS.has(args[0]!)
		case "cjlint":
			return args.length === 2 && args[0] === "-f" && !args[1]!.startsWith("-")
		default:
			return false
	}
}

function validateCommand(command: unknown): string | null {
	if (typeof command !== "string" || command.trim() === "") {
		return "Check-only task: execute_command requires a cjpm build/check/test, cjc, or cjlint command."
	}
	const normalized = command
		.trim()
		.replace(/\s*2>&1\s*/g, " ")
		.trim()
	// A quoted executable path (e.g. "C:\Program Files (x86)\...\cjpm.exe") is inert; check the rest.
	const quoted = normalized.match(/^(["'])(.*?)\1(?:\s+|$)(.*)$/)
	const afterExecutable = quoted ? quoted[3]! : normalized
	if (
		(quoted && /[`$%\r\n]/.test(quoted[2]!)) ||
		SHELL_SIDE_EFFECT_RE.test(afterExecutable) ||
		!isReadOnlyCommand(normalized)
	) {
		return (
			`Check-only task: command "${command.trim()}" is not allowed. Only cjpm build/check/test, ` +
			"toolchain version/help queries, or cjlint -f <path> may run. Arguments cannot contain quotes or escapes; " +
			"no chaining, pipes, or redirection; use the cwd " +
			"parameter to change directory. Report problems instead of changing files."
		)
	}
	return null
}

/** Returns a rejection message when the tool use could modify sources in check-only work, else null. */
export function validateCheckOnlyToolUse(toolName: string, params: Record<string, unknown>): string | null {
	if (BLOCKED_TOOLS.has(toolName)) {
		return `Check-only task: "${toolName}" is not allowed because it can modify files. Report findings instead of editing.`
	}
	if (toolName === "agent" && !isReadOnlyCangjieAgent(params.agentType as string | undefined)) {
		return (
			`Check-only task: delegating agentType "${String(params.agentType ?? "custom")}" is not allowed; ` +
			"only CangjieExplore or CangjieVerify may run. Report findings instead of repairing."
		)
	}
	if (toolName === "execute_command") return validateCommand(params.command)
	return null
}
