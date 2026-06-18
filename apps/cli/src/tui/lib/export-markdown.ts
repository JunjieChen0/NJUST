import os from "os"
import path from "path"
import fs from "fs/promises"
import type { TuiMessage, TuiPart } from "../runtime/types.ts"

function escapeMarkdown(text: string): string {
	return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\*/g, "\\*").replace(/_/g, "\\_")
}

function formatTimestamp(ts: number): string {
	return new Date(ts).toISOString()
}

function renderPart(part: TuiPart): string {
	if (part.type === "text") {
		return escapeMarkdown(part.content || "")
	}
	if (part.type === "reasoning") {
		return `\n> Reasoning: ${escapeMarkdown(part.content || "")}\n`
	}
	if (part.type === "tool") {
		const name = part.toolName || "tool"
		const status = part.status
		let out = `\n**Tool: ${name}** [${status}]\n\n`
		if (part.toolParams) {
			out += "```json\n" + JSON.stringify(part.toolParams, null, 2) + "\n```\n\n"
		}
		if (part.content) {
			out += "```\n" + escapeMarkdown(part.content) + "\n```\n\n"
		}
		if (part.toolError) {
			out += `**Error:** ${escapeMarkdown(part.toolError)}\n\n`
		}
		return out
	}
	return ""
}

function renderMessage(message: TuiMessage, parts: Map<string, TuiPart>): string {
	const roleLabel = message.role === "user" ? "👤 User" : message.role === "tool" ? "🔧 Tool" : "🤖 Assistant"
	const ts = formatTimestamp(message.createdAt)
	let out = `## ${roleLabel} \u003c!-- ${message.id} @ ${ts} -->\n\n`

	if (message.role === "user") {
		out += `> ${escapeMarkdown(message.content || "")
			.split("\n")
			.join("\n> ")}\n\n`
	} else if (message.part) {
		out += renderPart(message.part)
	} else if (message.partIds && message.partIds.length > 0) {
		for (const partId of message.partIds) {
			const part = parts.get(partId)
			if (part) {
				out += renderPart(part)
			}
		}
	} else {
		out += escapeMarkdown(message.content || "") + "\n\n"
	}

	return out
}

export async function exportSessionToMarkdown(options: {
	sessionId: string
	title: string
	provider: string
	model: string
	mode: string
	workspacePath: string
	messages: TuiMessage[]
	parts: Map<string, TuiPart>
	tokenUsage?: { total: number; context: number; cost?: number }
}): Promise<string> {
	const exportsDir = path.join(os.homedir(), ".njust-ai", "exports")
	await fs.mkdir(exportsDir, { recursive: true })

	const sanitizedTitle = options.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "_").slice(0, 50)
	const filename = `${sanitizedTitle}_${options.sessionId}_${Date.now()}.md`
	const filePath = path.join(exportsDir, filename)

	let md = `# ${options.title}\n\n`
	md += `- **Session ID:** ${options.sessionId}\n`
	md += `- **Provider:** ${options.provider}\n`
	md += `- **Model:** ${options.model}\n`
	md += `- **Mode:** ${options.mode}\n`
	md += `- **Workspace:** ${options.workspacePath}\n`
	if (options.tokenUsage) {
		md += `- **Tokens:** ${options.tokenUsage.total} total / ${options.tokenUsage.context} context`
		if (options.tokenUsage.cost !== undefined) {
			md += ` / $${options.tokenUsage.cost.toFixed(4)}`
		}
		md += "\n"
	}
	md += `- **Exported At:** ${new Date().toISOString()}\n\n`
	md += "---\n\n"

	for (const message of options.messages) {
		md += renderMessage(message, options.parts)
	}

	await fs.writeFile(filePath, md, "utf8")
	return filePath
}
