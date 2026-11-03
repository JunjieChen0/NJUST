import { resolveModelInfo } from "./resolveModelInfo"
import { moonshotModels, moonshotDefaultModelId } from "@njust-ai/core/providers"

import type { ApiHandlerOptions } from "../../shared/api"

import type { ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { OpenAICompatibleHandler, OpenAICompatibleConfig } from "./openai-compatible"
import { requireApiKey } from "../interfaces/api-key-validator"

export class MoonshotHandler extends OpenAICompatibleHandler {
	constructor(options: ApiHandlerOptions) {
		const modelId = options.apiModelId ?? moonshotDefaultModelId
		const modelInfo = resolveModelInfo(
			"moonshot",
			options,
			modelId,
			moonshotModels[modelId as keyof typeof moonshotModels],
		)

		const config: OpenAICompatibleConfig = {
			providerName: "moonshot",
			baseURL: options.moonshotBaseUrl || "https://api.moonshot.ai/v1",
			apiKey: requireApiKey(options.moonshotApiKey, "Moonshot"),
			modelId,
			modelInfo,
			modelMaxTokens: options.modelMaxTokens ?? undefined,
			temperature: options.modelTemperature ?? undefined,
		}

		super(options, config)
	}

	override getModel() {
		const id = this.options.apiModelId ?? moonshotDefaultModelId
		const info = resolveModelInfo("moonshot", this.options, id, moonshotModels[id as keyof typeof moonshotModels])
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})
		return { id, info, ...params }
	}

	/**
	 * Override to handle Moonshot's usage metrics, including caching.
	 * Moonshot returns cached_tokens in a different location than standard OpenAI.
	 */
	protected override processUsageMetrics(
		usage: Parameters<OpenAICompatibleHandler["processUsageMetrics"]>[0],
	): ApiStreamUsageChunk {
		// Moonshot uses cached_tokens at the top level of raw usage data
		const rawUsage = usage.raw as { cached_tokens?: number } | undefined

		return {
			...super.processUsageMetrics(usage),
			cacheReadTokens:
				usage.inputTokenDetails?.cacheReadTokens ?? rawUsage?.cached_tokens ?? usage.details?.cachedInputTokens,
		}
	}

	/**
	 * Override to always include max_tokens for Moonshot (not max_completion_tokens).
	 * Moonshot requires max_tokens parameter to be sent.
	 */
	protected override getMaxOutputTokens(): number | undefined {
		const modelInfo = this.getModel().info
		// Moonshot always requires max_tokens
		return this.options.modelMaxTokens || modelInfo.maxTokens || undefined
	}
}
