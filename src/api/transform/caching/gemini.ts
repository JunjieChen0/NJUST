import OpenAI from "openai"

import type { CacheableTextPart } from "./types"

type CacheableSystemMessage = Omit<OpenAI.Chat.ChatCompletionSystemMessageParam, "content"> & {
	content: CacheableTextPart[]
}

export function addCacheBreakpoints(
	systemPrompt: string,
	messages: OpenAI.Chat.ChatCompletionMessageParam[],
	frequency: number = 10,
): OpenAI.Chat.ChatCompletionMessageParam[] {
	// Shallow clone to avoid mutating the caller's array.
	const result = [...messages]

	// *Always* cache the system prompt.
	const systemMessage: CacheableSystemMessage = {
		role: "system",
		content: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
	}
	result[0] = systemMessage

	// Add breakpoints every N user messages based on frequency.
	let count = 0

	for (let i = 0; i < result.length; i++) {
		const msg = result[i]!
		if (msg.role !== "user") {
			continue
		}

		if (typeof msg.content === "string") {
			result[i] = { ...msg, content: [{ type: "text" as const, text: msg.content }] }
		}

		const isNthMessage = count % frequency === frequency - 1

		if (isNthMessage) {
			const content = result[i]!.content
			if (Array.isArray(content)) {
				let lastTextPart = content.filter((part) => part.type === "text").pop() as CacheableTextPart | undefined

				if (!lastTextPart) {
					lastTextPart = { type: "text", text: "..." } // Placeholder if no text part exists.
					content.push(lastTextPart)
				}

				;(lastTextPart as CacheableTextPart).cache_control = { type: "ephemeral" }
			}
		}

		count++
	}

	return result
}
