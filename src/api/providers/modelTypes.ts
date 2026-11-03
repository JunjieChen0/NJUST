import type { ModelInfo } from "@njust-ai/types"

export type ModelSource = "api" | "disk-cache" | "stale-disk-cache" | "hardcoded-fallback"

export interface DynamicModelInfo extends ModelInfo {
	source: ModelSource
}

export type DynamicModelRecord = Record<string, DynamicModelInfo>

export interface ListModelsOptions {
	apiKey?: string
	baseUrl?: string
	forceRefresh?: boolean
	headers?: Record<string, string>
	signal?: AbortSignal
	apiVersion?: string
	listingUnsupported?: boolean
}

export interface ModelCatalogResult {
	provider: import("@njust-ai/types").ProviderName
	configFingerprint: string
	models: DynamicModelRecord
	source: ModelSource
	fetchedAt?: number
	stale: boolean
	refreshError?: "empty" | "unauthorized" | "unsupported" | "unavailable" | "invalid_response"
}

export type FetcherKind = "openai-compatible" | "anthropic" | "gemini" | "existing" | "fallback-only"

export type ModelFetcher = (options: ListModelsOptions) => Promise<DynamicModelRecord>
