import OpenAI from "openai"

import {
	doubaoCodingPlanBaseUrl,
	doubaoDefaultBaseUrl,
	doubaoModels,
	doubaoDefaultModelId,
	doubaoSeedCodeCodingPlanModelId,
	openAiModelInfoSaneDefaults,
	resolveDoubaoInferenceModelId,
	DOUBAO_DEFAULT_TEMPERATURE,
	type ModelInfo,
} from "@njust-ai-cj/types"

/** 用户自填 ep- / 控制台 Model ID 时的能力占位（定价以控制台为准） */
const doubaoCustomModelInfo: ModelInfo = {
	...openAiModelInfoSaneDefaults,
	maxTokens: 32_768,
	contextWindow: 262_144,
	supportsImages: true,
	supportsPromptCache: false,
}

import type { ApiHandlerOptions } from "../../shared/api"

import { ApiStream, ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { OpenAICompatibleHandler, OpenAICompatibleConfig } from "./openai-compatible"
import type { ApiHandlerCreateMessageMetadata } from "../index"
import { Anthropic } from "@anthropic-ai/sdk"

function trimTrailingSlash(url: string): string {
	return url.replace(/\/+$/, "")
}

/** 方舟不支持 array 上的 minItems/maxItems */
function stripDoubaoUnsupportedArrayConstraints(schema: unknown): unknown {
	if (!schema || typeof schema !== "object") {
		return schema
	}
	if (Array.isArray(schema)) {
		return schema.map(stripDoubaoUnsupportedArrayConstraints)
	}
	const node = schema as Record<string, unknown>
	const next: Record<string, unknown> = { ...node }
	if (next.type === "array") {
		delete next.minItems
		delete next.maxItems
	}
	for (const key of Object.keys(next)) {
		const v = next[key]
		if (v && typeof v === "object") {
			next[key] = stripDoubaoUnsupportedArrayConstraints(v)
		}
	}
	return next
}

export class DoubaoHandler extends OpenAICompatibleHandler {
	constructor(options: ApiHandlerOptions) {
		const catalogModelId = options.apiModelId ?? doubaoDefaultModelId
		const modelInfo =
			doubaoModels[catalogModelId as keyof typeof doubaoModels] ?? doubaoCustomModelInfo

		const userBase = (options.doubaoBaseUrl ?? "").trim()
		const effectiveBaseUrl = userBase || doubaoDefaultBaseUrl
		const usingCodingPlanEndpoint =
			trimTrailingSlash(effectiveBaseUrl) === trimTrailingSlash(doubaoCodingPlanBaseUrl)
		const inferenceModelId =
			catalogModelId === "doubao-seed-code" && usingCodingPlanEndpoint
				? doubaoSeedCodeCodingPlanModelId
				: resolveDoubaoInferenceModelId(catalogModelId)

		const config: OpenAICompatibleConfig = {
			providerName: "doubao",
			baseURL: effectiveBaseUrl,
			apiKey: options.doubaoApiKey ?? "not-provided",
			modelId: inferenceModelId,
			modelInfo,
			modelMaxTokens: options.modelMaxTokens ?? undefined,
			temperature: options.modelTemperature ?? undefined,
		}

		super(options, config)
	}

	protected override convertToolsForOpenAI(tools: any[] | undefined): any[] | undefined {
		const converted = super.convertToolsForOpenAI(tools)
		if (!converted) {
			return converted
		}
		return converted.map((tool) => {
			if (tool?.type !== "function" || !tool.function?.parameters) {
				return tool
			}
			return {
				...tool,
				function: {
					...tool.function,
					parameters: stripDoubaoUnsupportedArrayConstraints(tool.function.parameters),
				},
			}
		})
	}

	override getModel() {
		const id = this.options.apiModelId ?? doubaoDefaultModelId
		const info = doubaoModels[id as keyof typeof doubaoModels] ?? doubaoCustomModelInfo
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: DOUBAO_DEFAULT_TEMPERATURE,
		})
		return { id, info, ...params }
	}

	override async *createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		metadata?: ApiHandlerCreateMessageMetadata,
	): ApiStream {
		const catalogModelId = this.options.apiModelId ?? doubaoDefaultModelId
		const { info: modelInfo } = this.getModel()

		// 仅当 Base 为 Coding Plan 时才映射到 ark-code-latest
		const userBase = (this.options.doubaoBaseUrl ?? "").trim()
		const effectiveBaseUrl = userBase || doubaoDefaultBaseUrl
		const usingCodingPlanEndpoint =
			trimTrailingSlash(effectiveBaseUrl) === trimTrailingSlash(doubaoCodingPlanBaseUrl)
		const actualModelId =
			catalogModelId === "doubao-seed-code" && usingCodingPlanEndpoint
				? doubaoSeedCodeCodingPlanModelId
				: resolveDoubaoInferenceModelId(catalogModelId)

		// 用原生 OpenAI SDK，避免 AI SDK 消息转换破坏 tool result
		const client = new OpenAI({ baseURL: effectiveBaseUrl, apiKey: this.config.apiKey })

		// 自己拼 OpenAI 格式消息，不走 AI SDK 的 convertToAiSdkMessages
		const openAiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
			{ role: "system", content: systemPrompt },
		]

		for (const msg of messages) {
			if (typeof msg.content === "string") {
				openAiMessages.push({ role: msg.role as any, content: msg.content })
			} else {
				const parts: OpenAI.Chat.ChatCompletionContentPart[] = []
				const toolResults: Array<{ tool_call_id: string; role: "tool"; content: string }> = []

				for (const part of msg.content) {
					if (part.type === "text") {
						parts.push({ type: "text", text: part.text })
					} else if (part.type === "image") {
						const source = part.source as { type: string; media_type?: string; data?: string }
						if (source.type === "base64" && source.media_type && source.data) {
							parts.push({
								type: "image_url",
								image_url: { url: `data:${source.media_type};base64,${source.data}` },
							})
						}
					} else if (part.type === "tool_result") {
						const content =
							typeof part.content === "string"
								? part.content
								: part.content?.map((c) => (c.type === "text" ? c.text : "")).join("\n") ?? ""
						toolResults.push({ tool_call_id: part.tool_use_id, role: "tool", content })
					}
				}

				// 如果 user message 只有 tool result，保持一个 placeholder content 避免 API 报缺少 content
				if (msg.role === "user" && parts.length === 0 && toolResults.length > 0) {
					parts.push({ type: "text", text: "(tool result)" })
				}

				if (parts.length > 0) {
					openAiMessages.push({ role: msg.role as any, content: parts })
				}
				openAiMessages.push(...toolResults)
			}
		}

		const openAiTools = this.convertToolsForOpenAI(metadata?.tools)
		const maxTokens = this.options.modelMaxTokens ?? modelInfo.maxTokens

		const response = await client.chat.completions.create({
			model: actualModelId,
			temperature: this.options.modelTemperature ?? DOUBAO_DEFAULT_TEMPERATURE,
			messages: openAiMessages,
			stream: true,
			stream_options: { include_usage: true },
			max_tokens: maxTokens,
			tools: openAiTools,
			tool_choice: metadata?.tool_choice,
			parallel_tool_calls: metadata?.parallelToolCalls ?? true,
		})

		let lastUsage

		for await (const chunk of response) {
			const delta = chunk.choices?.[0]?.delta ?? {}

			if (delta.content) {
				yield { type: "text", text: delta.content }
			}

			if ("reasoning_content" in delta && delta.reasoning_content) {
				yield { type: "reasoning", text: (delta.reasoning_content as string) || "" }
			}

			if (delta.tool_calls) {
				for (const toolCall of delta.tool_calls) {
					yield {
						type: "tool_call_partial",
						index: toolCall.index,
						id: toolCall.id,
						name: toolCall.function?.name,
						arguments: toolCall.function?.arguments,
					}
				}
			}

			if (chunk.usage) {
				lastUsage = chunk.usage
			}
		}

		if (lastUsage) {
			yield this.processUsageMetrics({
				inputTokens: lastUsage.prompt_tokens,
				outputTokens: lastUsage.completion_tokens,
				details: {
					cachedInputTokens: (lastUsage.prompt_tokens_details as any)?.cached_tokens,
					reasoningTokens: (lastUsage.prompt_tokens_details as any)?.reasoning_tokens,
				},
			})
		}
	}

	protected override processUsageMetrics(usage: {
		inputTokens?: number
		outputTokens?: number
		details?: {
			cachedInputTokens?: number
			reasoningTokens?: number
		}
		raw?: Record<string, unknown>
	}): ApiStreamUsageChunk {
		return {
			type: "usage",
			inputTokens: usage.inputTokens || 0,
			outputTokens: usage.outputTokens || 0,
			cacheReadTokens: usage.details?.cachedInputTokens,
			reasoningTokens: usage.details?.reasoningTokens,
		}
	}
}
