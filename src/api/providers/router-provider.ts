import OpenAI from "openai"

import { type ModelInfo, type ModelRecord } from "@njust-ai/types"

import { ApiHandlerOptions, RouterName } from "../../shared/api"

import { BaseProvider } from "./base-provider"
import { getModels, getModelsFromCache } from "./fetchers/modelCache"

import { DEFAULT_HEADERS } from "./constants"
import { requireApiKey } from "../interfaces/api-key-validator"
import { getApiRequestTimeout } from "./utils/timeout-config"
import { unknownModelInfo } from "./resolveModelInfo"

type RouterProviderOptions = {
	name: RouterName
	baseURL: string
	apiKey?: string
	modelId?: string
	defaultModelId: string
	defaultModelInfo: ModelInfo
	options: ApiHandlerOptions
}

export abstract class RouterProvider extends BaseProvider {
	protected readonly options: ApiHandlerOptions
	protected readonly name: RouterName
	protected models: ModelRecord = {}
	protected readonly modelId?: string
	protected readonly defaultModelId: string
	protected readonly defaultModelInfo: ModelInfo
	protected readonly client: OpenAI

	constructor({ options, name, baseURL, apiKey, modelId, defaultModelId, defaultModelInfo }: RouterProviderOptions) {
		super()

		this.options = options
		this.name = name
		this.modelId = modelId
		this.defaultModelId = defaultModelId
		this.defaultModelInfo = defaultModelInfo

		const resolvedApiKey = requireApiKey(apiKey, name)

		this.client = new OpenAI({
			baseURL,
			apiKey: resolvedApiKey,
			defaultHeaders: {
				...DEFAULT_HEADERS,
				...(options.openAiHeaders || {}),
			},
			timeout: getApiRequestTimeout(),
		})
	}

	public async fetchModel(signal?: AbortSignal) {
		this.models = await getModels({
			provider: this.name,
			apiKey: this.client.apiKey,
			baseUrl: this.client.baseURL,
			...(signal ? { signal } : {}),
		})
		return this.getModel()
	}

	override getModel(): { id: string; info: ModelInfo } {
		const id = this.modelId ?? this.defaultModelId
		if (this.options.modelSnapshot?.current?.id === id) return { id, info: this.options.modelSnapshot.current.info }

		// First check instance models (populated by fetchModel)
		if (this.models[id]) {
			return { id, info: this.models[id] }
		}

		// Fall back to global cache (synchronous disk/memory cache)
		// This ensures models are available before fetchModel() is called
		const cachedModels = getModelsFromCache(this.name, { apiKey: this.client.apiKey, baseUrl: this.client.baseURL })
		if (cachedModels?.[id]) {
			// Also populate instance models for future calls
			this.models = cachedModels
			return { id, info: cachedModels[id] }
		}

		return { id, info: id === this.defaultModelId ? this.defaultModelInfo : unknownModelInfo }
	}

	protected supportsTemperature(modelId: string): boolean {
		return !modelId.startsWith("openai/o3-mini")
	}

	protected override shouldUseStrictMode(): boolean {
		return false
	}
}
