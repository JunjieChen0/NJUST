import { resolveModelInfo } from "./resolveModelInfo"
import { qwenModels, qwenDefaultModelId } from "@njust-ai/core/providers"

import type { ApiHandlerOptions } from "../../shared/api"

import { getModelParams } from "../transform/model-params"

import { OpenAICompatibleHandler, OpenAICompatibleConfig } from "./openai-compatible"
import { requireApiKey } from "../interfaces/api-key-validator"

export class QwenHandler extends OpenAICompatibleHandler {
	constructor(options: ApiHandlerOptions) {
		const modelId = options.apiModelId ?? qwenDefaultModelId
		const modelInfo = resolveModelInfo("qwen", options, modelId, qwenModels[modelId as keyof typeof qwenModels])

		const config: OpenAICompatibleConfig = {
			providerName: "qwen",
			baseURL: options.qwenBaseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1",
			apiKey: requireApiKey(options.qwenApiKey, "Alibaba Cloud Model Studio (百炼)"),
			modelId,
			modelInfo,
			modelMaxTokens: options.modelMaxTokens ?? undefined,
			temperature: options.modelTemperature ?? undefined,
		}

		super(options, config)
	}

	override getModel() {
		const id = this.options.apiModelId ?? qwenDefaultModelId
		const info = resolveModelInfo("qwen", this.options, id, qwenModels[id as keyof typeof qwenModels])
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: 0,
		})
		return { id, info, ...params }
	}

	protected override getMaxOutputTokens(): number | undefined {
		const modelInfo = this.getModel().info
		return this.options.modelMaxTokens || modelInfo.maxTokens || undefined
	}
}
