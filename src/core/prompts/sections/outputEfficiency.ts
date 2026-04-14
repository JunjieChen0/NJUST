/**
 * Output Efficiency Guidelines Section
 *
 * Guides the model to produce concise, actionable output and avoid
 * wasting tokens on unnecessary content. Inspired by Claude Code's
 * getOutputEfficiencySection() which explicitly instructs the model
 * on output economy.
 */

export function getOutputEfficiencySection(): string {
	return `# Output Efficiency Guidelines

- Be direct and concise. Avoid unnecessary preamble, filler phrases, or restating what the user already said.
- When editing files, only show the changed sections with sufficient context lines, not entire file contents.
- For tool calls, use the most specific tool available rather than generic approaches (e.g., use search_files instead of reading multiple files sequentially).
- Avoid repeating information that is already present in the conversation.
- When multiple files need similar changes, describe the pattern once and reference it, rather than detailing each file separately.
- Prefer structured output (lists, tables, code blocks) over verbose prose for technical content.
- If a task is complete, state the result concisely without recapping every step taken.`
}
