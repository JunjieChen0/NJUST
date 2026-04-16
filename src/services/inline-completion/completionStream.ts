import * as vscode from "vscode"

import type { ApiHandler, ApiHandlerCreateMessageMetadata } from "../../api"

/**
 * Collect plain text from the streaming API (stops on cancellation).
 * - Forces `tool_choice: "none"` so OpenAI-compatible APIs return message text instead of tool calls.
 * - If the model only emits `reasoning` chunks (e.g. some R1-style streams), uses that as fallback when main text is empty.
 */
export async function streamCompletionText(
	api: ApiHandler,
	systemPrompt: string,
	userPrompt: string,
	options: { token?: vscode.CancellationToken; taskId?: string; mode?: string },
): Promise<string> {
	const metadata: ApiHandlerCreateMessageMetadata = {
		taskId: options.taskId ?? "inline-completion",
		mode: options.mode,
		suppressPreviousResponseId: true,
		/** Critical for inline completion: avoid empty `delta.content` when the model would rather call tools. */
		tool_choice: "none",
	}
	const stream = api.createMessage(systemPrompt, [{ role: "user", content: userPrompt }], metadata)
	let text = ""
	let reasoning = ""
	for await (const chunk of stream) {
		if (options.token?.isCancellationRequested) {
			break
		}
		if (chunk.type === "text") {
			text += chunk.text
		}
		if (chunk.type === "reasoning") {
			reasoning += chunk.text
		}
		if (chunk.type === "error") {
			throw new Error(chunk.message || chunk.error)
		}
	}
	const primary = text.trim()
	if (primary.length > 0) {
		return text
	}
	/** Some providers stream code-like output only in the reasoning channel for small completions. */
	if (reasoning.trim().length > 0) {
		return reasoning
	}
	return text
}
