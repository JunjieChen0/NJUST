import { type SambaNovaModelId, sambaNovaDefaultModelId, sambaNovaModels } from "@njust-ai/core/providers"

import type { ApiHandlerOptions } from "../../shared/api"
import { PROVIDER_BASE_URLS, API_PATHS } from "../../shared/provider-endpoints"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class SambaNovaHandler extends BaseOpenAiCompatibleProvider<SambaNovaModelId> {
	constructor(options: ApiHandlerOptions) {
		super({
			...options,
			providerName: "SambaNova",
			baseURL: `${PROVIDER_BASE_URLS.sambanova}${API_PATHS.openaiVersion}`,
			apiKey: options.sambaNovaApiKey,
			defaultProviderModelId: sambaNovaDefaultModelId,
			providerModels: sambaNovaModels,
			defaultTemperature: 0.7,
		})
	}
}
