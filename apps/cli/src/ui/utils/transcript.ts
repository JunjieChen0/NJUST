import type { TUIMessage } from "../types.js"

/**
 * Format the current session messages as a Markdown transcript.
 *
 * Each user/assistant message is rendered with a heading. Tool calls,
 * thinking blocks, and system events are included as indented sections.
 */
export function formatTranscript(
	messages: TUIMessage[],
	options: { includeThinking?: boolean; includeToolDetails?: boolean } = {},
): string {
	const { includeThinking = true, includeToolDetails = true } = options
	const lines: string[] = []
	const now = new Date()

	lines.push(`# Session Transcript`)
	lines.push("")
	lines.push(`**Exported:** ${now.toLocaleString()}`)
	lines.push("")
	lines.push("---")
	lines.push("")

	for (const msg of messages) {
		switch (msg.role) {
			case "user":
				lines.push("## User")
				lines.push("")
				lines.push(msg.content || "(empty)")
				lines.push("")
				break

			case "assistant":
				lines.push("## Assistant")
				lines.push("")
				lines.push(msg.content || "(empty)")
				lines.push("")
				break

			case "thinking":
				if (includeThinking) {
					lines.push("<details><summary>Thinking</summary>")
					lines.push("")
					lines.push(msg.content || "(empty)")
					lines.push("")
					lines.push("</details>")
					lines.push("")
				}
				break

			case "tool":
				if (includeToolDetails) {
					const toolName = msg.toolDisplayName || msg.toolName || "tool"
					lines.push(`**Tool: ${toolName}**`)
					lines.push("")
					if (msg.toolDisplayOutput) {
						lines.push("```")
						lines.push(msg.toolDisplayOutput)
						lines.push("```")
						lines.push("")
					}
				}
				break

			case "system":
				if (includeToolDetails) {
					lines.push(`> ${msg.content || ""}`)
					lines.push("")
				}
				break
		}
	}

	lines.push("---")
	lines.push("")
	lines.push(`*${messages.length} messages total*`)

	return lines.join("\n")
}

/**
 * Extract the text of the last assistant message.
 */
export function getLastAssistantMessage(messages: TUIMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i]
		if (msg && msg.role === "assistant") {
			return msg.content || null
		}
	}
	return null
}
