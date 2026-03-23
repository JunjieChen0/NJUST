import { doubaoModels, doubaoDefaultModelId, type ModelInfo } from "@njust-ai-cj/types"

import type { ApiHandlerOptions } from "../../shared/api"

import type { ApiStreamUsageChunk } from "../transform/stream"
import { getModelParams } from "../transform/model-params"

import { OpenAICompatibleHandler, OpenAICompatibleConfig } from "./openai-compatible"

export class DoubaoHandler extends OpenAICompatibleHandler {
	constructor(options: ApiHandlerOptions) {
		const modelId = options.apiModelId ?? doubaoDefaultModelId
		const modelInfo = doubaoModels[modelId as keyof typeof doubaoModels] || doubaoModels[doubaoDefaultModelId]

		const config: OpenAICompatibleConfig = {
			providerName: "doubao",
			baseURL: options.doubaoBaseUrl || "https://ark.cn-beijing.volces.com/api/v3",
			apiKey: options.doubaoApiKey ?? "not-provided",
			modelId,
			modelInfo,
			modelMaxTokens: options.modelMaxTokens ?? undefined,
			temperature: options.modelTemperature ?? undefined,
		}

		super(options, config)
	}

	override getModel() {
		const id = this.options.apiModelId ?? doubaoDefaultModelId
		const info = doubaoModels[id as keyof typeof doubaoModels] || doubaoModels[doubaoDefaultModelId]
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})
		return { id, info, ...params }
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

	protected override getMaxOutputTokens(): number | undefined {
		const modelInfo = this.config.modelInfo
		return this.options.modelMaxTokens || modelInfo.maxTokens || undefined
	}
}
