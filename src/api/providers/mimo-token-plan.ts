import { resolveModelInfo } from "./resolveModelInfo"
import {
	mimoTokenPlanModels,
	mimoTokenPlanDefaultModelId,
	MIMO_TOKEN_PLAN_DEFAULT_TEMPERATURE,
} from "@njust-ai/core/providers"

import type { ApiHandlerOptions } from "../../shared/api"

import { getModelParams } from "../transform/model-params"

import { OpenAICompatibleHandler, type OpenAICompatibleConfig } from "./openai-compatible"
import { requireApiKey } from "../interfaces/api-key-validator"

export class MimoTokenPlanHandler extends OpenAICompatibleHandler {
	constructor(options: ApiHandlerOptions) {
		const modelId = options.apiModelId ?? mimoTokenPlanDefaultModelId
		const modelInfo = resolveModelInfo(
			"mimo-token-plan",
			options,
			modelId,
			mimoTokenPlanModels[modelId as keyof typeof mimoTokenPlanModels],
		)

		const config: OpenAICompatibleConfig = {
			providerName: "mimo-token-plan",
			baseURL: "https://token-plan-cn.xiaomimimo.com/v1",
			apiKey: requireApiKey(options.mimoTokenPlanApiKey, "MiMo Token Plan"),
			modelId,
			modelInfo,
			modelMaxTokens: options.modelMaxTokens ?? undefined,
			temperature: options.modelTemperature ?? undefined,
		}

		super(options, config)
	}

	override getModel() {
		const id = this.options.apiModelId ?? mimoTokenPlanDefaultModelId
		const info = resolveModelInfo(
			"mimo-token-plan",
			this.options,
			id,
			mimoTokenPlanModels[id as keyof typeof mimoTokenPlanModels],
		)
		const params = getModelParams({
			format: "openai",
			modelId: id,
			model: info,
			settings: this.options,
			defaultTemperature: MIMO_TOKEN_PLAN_DEFAULT_TEMPERATURE,
		})
		return { id, info, ...params }
	}

	protected override getMaxOutputTokens(): number | undefined {
		const modelInfo = this.getModel().info
		return this.options.modelMaxTokens || modelInfo.maxTokens || undefined
	}
}
