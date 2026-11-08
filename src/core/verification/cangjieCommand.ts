/** Parse one shell command without chaining, file redirection or shell expansion. */
export function parseCangjieCommand(command: string): { executable: string; tool: string; args: string[] } | undefined {
	const normalized = command
		.trim()
		.replace(/\s+2>&1(?=\s|$)/g, "")
		.trim()
	const quoted = normalized.match(/^(["'])(.*?)\1(?:\s+|$)(.*)$/)
	const [executable = "", ...args] = quoted ? [quoted[2]!, ...quoted[3]!.split(/\s+/)] : normalized.split(/\s+/)
	if (
		!executable ||
		(quoted && /[`$%\r\n]/.test(executable)) ||
		/[;&|`$%<>(){}@'"^\r\n]/.test(quoted ? quoted[3]! : normalized)
	)
		return undefined
	const tool = (executable.split(/[\\/]/).pop() ?? "").toLowerCase().replace(/\.exe$/, "")
	return { executable, tool, args: args.filter(Boolean) }
}
