import { type FireworksModelId, fireworksDefaultModelId, fireworksModels } from "@njust-ai/core/providers"

import type { ApiHandlerOptions } from "../../shared/api"
import { PROVIDER_BASE_URLS, API_PATHS } from "../../shared/provider-endpoints"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class FireworksHandler extends BaseOpenAiCompatibleProvider<FireworksModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "Fireworks",
			baseURL: `${PROVIDER_BASE_URLS.fireworks}${API_PATHS.fireworksInference}`,
			apiKey: options.fireworksApiKey,
			defaultProviderModelId: fireworksDefaultModelId,
			providerModels: fireworksModels,
			defaultTemperature: 0.5,
		})
	}
}
