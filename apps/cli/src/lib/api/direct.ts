/**
 * Direct API Handler — bypasses the extension bundle entirely.
 * Uses Node.js built-in fetch for all API calls.
 * Supports OpenAI-compatible providers and Anthropic's API.
 */

export interface ChatMessage {
	role: "user" | "assistant" | "system"
	content: string
}

export interface ChatStreamEvent {
	type: "text" | "reasoning" | "error" | "done"
	text?: string
	error?: string
}

/**
 * Get the base URL for an OpenAI-compatible provider.
 */
function getOpenAIBaseUrl(provider: string): string {
	const urls: Record<string, string> = {
		"openai-native": "https://api.openai.com/v1",
		openai: "https://api.openai.com/v1",
		"openai-codex": "https://api.openai.com/v1",
		openrouter: "https://openrouter.ai/api/v1",
		deepseek: "https://api.deepseek.com",
		fireworks: "https://api.fireworks.ai/inference/v1",
		mistral: "https://api.mistral.ai/v1",
		moonshot: "https://api.moonshot.cn/v1",
		minimax: "https://api.minimax.chat/v1",
		qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
		"qwen-code": "https://dashscope.aliyuncs.com/compatible-mode/v1",
		doubao: "https://ark.cn-beijing.volces.com/api/v3",
		glm: "https://open.bigmodel.cn/api/paas/v4",
		sambanova: "https://api.sambanova.ai/v1",
		xai: "https://api.x.ai/v1",
		zai: "https://api.z.ai/v1",
		litellm: "https://api.litellm.ai/v1",
		requesty: "https://api.requesty.ai/v1",
		unbound: "https://api.unbound.ai/v1",
		"vercel-ai-gateway": "https://gateway.ai.vercel.com/v1",
		baseten: "https://bridge.baseten.co/v1",
		ollama: "http://localhost:11434/v1",
		lmstudio: "http://localhost:1234/v1",
		njustAi: "https://router.njust-ai.com/v1",
	}
	return urls[provider] || "https://api.openai.com/v1"
}

/**
 * Get the Anthropic API URL.
 */
const ANTHROPIC_URL = "https://api.anthropic.com/v1"

/**
 * Create a streaming chat completion using OpenAI-compatible API.
 */
async function* streamOpenAI(
	apiKey: string,
	model: string,
	messages: ChatMessage[],
	baseUrl: string,
): AsyncGenerator<ChatStreamEvent> {
	const response = await fetch(`${baseUrl}/chat/completions`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify({
			model,
			messages: messages.map((m) => ({
				role: m.role,
				content: m.content,
			})),
			stream: true,
		}),
	})

	if (!response.ok) {
		const body = await response.text().catch(() => "")
		yield { type: "error", error: `API error ${response.status}: ${body}` }
		return
	}

	const reader = response.body?.getReader()
	if (!reader) {
		yield { type: "error", error: "No response body" }
		return
	}

	const decoder = new TextDecoder()
	let buffer = ""

	while (true) {
		const { done, value } = await reader.read()
		if (done) break

		buffer += decoder.decode(value, { stream: true })
		const lines = buffer.split("\n")
		buffer = lines.pop() || ""

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed || !trimmed.startsWith("data: ")) continue

			const data = trimmed.slice(6)
			if (data === "[DONE]") {
				yield { type: "done" }
				return
			}

			try {
				const parsed = JSON.parse(data)
				const delta = parsed.choices?.[0]?.delta
				if (delta?.content) {
					yield { type: "text", text: delta.content }
				}
				if (delta?.reasoning_content) {
					yield { type: "reasoning", text: delta.reasoning_content }
				}
			} catch {
				// Skip unparseable chunks
			}
		}
	}

	yield { type: "done" }
}

/**
 * Create a streaming chat completion using Anthropic's Messages API.
 */
async function* streamAnthropic(
	apiKey: string,
	model: string,
	messages: ChatMessage[],
): AsyncGenerator<ChatStreamEvent> {
	const response = await fetch(`${ANTHROPIC_URL}/messages`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
		body: JSON.stringify({
			model,
			max_tokens: 8192,
			messages: messages.map((m) => ({
				role: m.role === "system" ? "user" : m.role,
				content: m.content,
			})),
			stream: true,
		}),
	})

	if (!response.ok) {
		const body = await response.text().catch(() => "")
		yield { type: "error", error: `Anthropic API error ${response.status}: ${body}` }
		return
	}

	const reader = response.body?.getReader()
	if (!reader) {
		yield { type: "error", error: "No response body" }
		return
	}

	const decoder = new TextDecoder()
	let buffer = ""

	while (true) {
		const { done, value } = await reader.read()
		if (done) break

		buffer += decoder.decode(value, { stream: true })
		const lines = buffer.split("\n")
		buffer = lines.pop() || ""

		for (const line of lines) {
			const trimmed = line.trim()
			if (!trimmed || !trimmed.startsWith("data: ")) continue

			const data = trimmed.slice(6)
			try {
				const parsed = JSON.parse(data)
				if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
					yield { type: "text", text: parsed.delta.text }
				}
				if (parsed.type === "message_delta" && parsed.delta?.stop_reason === "end_turn") {
					yield { type: "done" }
				}
			} catch {
				// Skip unparseable chunks
			}
		}
	}

	yield { type: "done" }
}

/**
 * Main streaming chat function. Routes to the appropriate API based on provider.
 */
export function streamChat(
	provider: string,
	apiKey: string,
	model: string,
	messages: ChatMessage[],
	baseUrl?: string,
): AsyncGenerator<ChatStreamEvent> {
	if (provider === "anthropic" || provider === "vertex" || provider === "bedrock") {
		return streamAnthropic(apiKey, model, messages)
	}

	return streamOpenAI(apiKey, model, messages, baseUrl || getOpenAIBaseUrl(provider))
}
