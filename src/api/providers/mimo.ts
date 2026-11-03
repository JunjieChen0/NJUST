import { resolveModelInfo } from "./resolveModelInfo"
import { mimoModels, mimoDefaultModelId, MIMO_DEFAULT_TEMPERATURE } from "@njust-ai/core/providers"

import type { ApiHandlerOptions } from "../../shared/api"

import { getModelParams } from "../transform/model-params"

import { OpenAICompatibleHandler, type OpenAICompatibleConfig } from "./openai-compatible"
import { requireApiKey } from "../interfaces/api-key-validator"

export class MimoHandler extends OpenAICompatibleHandler {
	constructor(options: ApiHandlerOptions) {
		const modelId = options.apiModelId ?? mimoDefaultModelId
		const modelInfo = resolveModelInfo("mimo", options, modelId, mimoModels[modelId as keyof typeof mimoModels])

		const config: OpenAICompatibleConfig = {
			providerName: "mimo",
			baseURL: options.mimoBaseUrl || "https://api.xiaomimimo.com/v1",
			apiKey: requireApiKey(options.mimoApiKey, "MiMo"),
			modelId,
			modelInfo,
			modelMaxTokens: options.modelMaxTokens ?? undefined,
			temperature: options.modelTemperature ?? undefined,
		}

		super(options, config)
	}

	override getModel() {
		const id = this.options.apiModelId ?? mimoDefaultModelId
		const info = resolveModelInfo("mimo", this.options, id, mimoModels[id as keyof typeof mimoModels])
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: MIMO_DEFAULT_TEMPERATURE,
		})
		return { id, info, ...params }
	}

	protected override getMaxOutputTokens(): number | undefined {
		const modelInfo = this.getModel().info
		return this.options.modelMaxTokens || modelInfo.maxTokens || undefined
	}
}
