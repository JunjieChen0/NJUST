import { resolveModelInfo } from "./resolveModelInfo"
import { glmModels, glmDefaultModelId } from "@njust-ai/core/providers"

import type { ApiHandlerOptions } from "../../shared/api"

import { getModelParams } from "../transform/model-params"

import { OpenAICompatibleHandler, OpenAICompatibleConfig } from "./openai-compatible"
import { requireApiKey } from "../interfaces/api-key-validator"

export class GlmHandler extends OpenAICompatibleHandler {
	constructor(options: ApiHandlerOptions) {
		const modelId = options.apiModelId ?? glmDefaultModelId
		const modelInfo = resolveModelInfo("glm", options, modelId, glmModels[modelId as keyof typeof glmModels])

		const config: OpenAICompatibleConfig = {
			providerName: "glm",
			baseURL: options.glmBaseUrl || "https://open.bigmodel.cn/api/paas/v4",
			apiKey: requireApiKey(options.glmApiKey, "GLM"),
			modelId,
			modelInfo,
			modelMaxTokens: options.modelMaxTokens ?? undefined,
			temperature: options.modelTemperature ?? undefined,
		}

		super(options, config)
	}

	override getModel() {
		const id = this.options.apiModelId ?? glmDefaultModelId
		const info = resolveModelInfo("glm", this.options, id, glmModels[id as keyof typeof glmModels])
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
