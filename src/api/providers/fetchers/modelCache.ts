import * as path from "path"
import fs from "fs/promises"
import * as fsSync from "fs"

import NodeCache from "node-cache"
import { z } from "zod"

import type { ProviderName, ModelRecord } from "@njust-ai/types"
import { modelInfoSchema } from "@njust-ai/types"

import { logger } from "../../../shared/logger"
import { safeWriteJson } from "../../../utils/safeWriteJson"

import { getCacheDirectoryPath } from "../../../utils/storage"
import type { RouterName } from "../../../shared/api"
import { fileExistsAtPath } from "../../../utils/fs"

import { getModelCacheStore } from "./modelCacheStore"
import { getOpenRouterModels } from "./openrouter"
import { getVercelAiGatewayModels } from "./vercel-ai-gateway"
import { getRequestyModels } from "./requesty"
import { getUnboundModels } from "./unbound"
import { getLiteLLMModels } from "./litellm"
import { GetModelsOptions } from "../../../shared/api"
import { getOllamaModels } from "./ollama"
import { getLMStudioModels } from "./lmstudio"
import { getRooModels } from "./njust-ai"
import { TIMING } from "../../../shared/constants"

import type { DynamicModelInfo, DynamicModelRecord, ListModelsOptions, ModelCatalogResult } from "../modelTypes"
import { providerFetcherMap } from "../providerFetcherMap"
import { fallbackModels } from "../fallbackModels"
import { modelCatalogIdentity } from "../modelCatalogIdentity"
import { fetchOpenAICompatibleModels, resolveOpenAIModelOptions } from "./openai-compatible"
import { fetchAnthropicModels } from "./anthropic"
import { fetchGeminiModels } from "./gemini"

const memoryCache = new NodeCache({ stdTTL: TIMING.MODEL_CACHE_TTL_S, checkperiod: TIMING.MODEL_CACHE_TTL_S })

// Zod schema for validating ModelRecord structure from disk cache
const modelRecordSchema = z.record(z.string(), modelInfoSchema)

const diskCacheEntrySchema = z.object({
	timestamp: z.number(),
	models: z.record(z.string(), modelInfoSchema),
})

// Track in-flight refresh requests to prevent concurrent API calls for the same provider
// This prevents race conditions where multiple calls might overwrite each other's results
const inFlightRefresh = new Map<string, Promise<ModelRecord>>()

function legacyCacheKey(options: { provider: ProviderName; apiKey?: string; baseUrl?: string }): string {
	const connection =
		options.provider === "njust-ai" ? { ...options, baseUrl: options.baseUrl?.replace(/\/?v1\/?$/, "") } : options
	return options.provider === "openrouter" || options.provider === "vercel-ai-gateway"
		? options.provider
		: modelCatalogIdentity(options.provider, connection)
}

async function writeModels(router: RouterName, data: ModelRecord, key: string) {
	const basePath = getModelCacheStore()?.globalStorageUri.fsPath
	if (!basePath) {
		logger.debug("ModelCache", `Skipping ${router} model write: cacheStore not initialized`)
		return
	}
	const filename = `${key}_models.json`
	const cacheDir = await getCacheDirectoryPath(basePath)
	await safeWriteJson(path.join(cacheDir, filename), data)
}

async function _readModels(router: RouterName): Promise<ModelRecord | undefined> {
	const basePath = getModelCacheStore()?.globalStorageUri.fsPath
	if (!basePath) {
		return undefined
	}
	const filename = `${router}_models.json`
	const cacheDir = await getCacheDirectoryPath(basePath)
	const filePath = path.join(cacheDir, filename)
	const exists = await fileExistsAtPath(filePath)
	if (!exists) {
		return undefined
	}

	return modelRecordSchema.parse(JSON.parse(await fs.readFile(filePath, "utf8")))
}

/**
 * Fetch models from the provider API.
 * Extracted to avoid duplication between getModels() and refreshModels().
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from the provider API
 */
async function fetchModelsFromProvider(options: GetModelsOptions): Promise<ModelRecord> {
	const { provider } = options

	let models: ModelRecord

	switch (provider) {
		case "openrouter":
			models = await getOpenRouterModels()
			break
		case "requesty":
			// Requesty models endpoint requires an API key for per-user custom policies.
			models = await getRequestyModels(options.baseUrl, options.apiKey)
			break
		case "unbound":
			models = await getUnboundModels(options.apiKey)
			break
		case "litellm":
			// Type safety ensures apiKey and baseUrl are always provided for LiteLLM.
			models = await getLiteLLMModels(options.apiKey, options.baseUrl, options.signal)
			break
		case "ollama":
			models = await getOllamaModels(options.baseUrl, options.apiKey)
			break
		case "lmstudio":
			models = await getLMStudioModels(options.baseUrl)
			break
		case "vercel-ai-gateway":
			models = await getVercelAiGatewayModels()
			break
		case "njust-ai": {
			const rooBaseUrl = options.baseUrl ?? process.env.NJUST_AI_PROVIDER_URL ?? ""
			if (!rooBaseUrl) {
				return {}
			}
			models = await getRooModels(rooBaseUrl, options.apiKey)
			break
		}
		default: {
			throw new Error(`fetchModelsFromProvider does not support provider: ${provider as string}`)
		}
	}

	return models
}

/**
 * Get models from the cache or fetch them from the provider and cache them.
 * There are two caches:
 * 1. Memory cache - This is a simple in-memory cache that is used to store models for a short period of time.
 * 2. File cache - This is a file-based cache that is used to store models for a longer period of time.
 *
 * @param router - The router to fetch models from.
 * @param apiKey - Optional API key for the provider.
 * @param baseUrl - Optional base URL for the provider (currently used only for LiteLLM).
 * @returns The models from the cache or the fetched models.
 */
export const getModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	options.signal?.throwIfAborted()
	const { provider } = options

	let models = getModelsFromCache(provider, options)

	if (models) {
		return models
	}

	try {
		models = await fetchModelsFromProvider(options)
		options.signal?.throwIfAborted()
		const modelCount = Object.keys(models).length

		// Only cache non-empty results to prevent persisting failed API responses
		// Empty results could indicate API failure rather than "no models exist"
		if (modelCount > 0) {
			memoryCache.set(legacyCacheKey(options), models)

			await writeModels(provider, models, legacyCacheKey(options)).catch((err) =>
				logger.error("ModelCache", `Error writing ${provider} models to file cache:`, err),
			)
		} else {
			// Empty results - do nothing
		}

		return models
	} catch (error) {
		// Log the error and re-throw it so the caller can handle it (e.g., show a UI message).
		logger.error("ModelCache", `Failed to fetch models in modelCache for ${provider}:`, error)

		throw error // Re-throw the original error to be handled by the caller.
	}
}

/**
 * Force-refresh models from API, bypassing cache.
 * Uses atomic writes so cache remains available during refresh.
 * This function also prevents concurrent API calls for the same provider using
 * in-flight request tracking to avoid race conditions.
 *
 * @param options - Provider options for fetching models
 * @returns Fresh models from API, or existing cache if refresh yields worse data
 */
export const refreshModels = async (options: GetModelsOptions): Promise<ModelRecord> => {
	const { provider } = options

	// Check if there's already an in-flight refresh for this provider
	// This prevents race conditions where multiple concurrent refreshes might
	// overwrite each other's results
	const existingRequest = inFlightRefresh.get(legacyCacheKey(options))
	if (existingRequest) {
		return existingRequest
	}

	// Create the refresh promise and track it
	const refreshPromise = (async (): Promise<ModelRecord> => {
		try {
			// Force fresh API fetch - skip getModelsFromCache() check
			const models = await fetchModelsFromProvider(options)
			const modelCount = Object.keys(models).length

			// Get existing cached data for comparison
			const existingCache = getModelsFromCache(provider, options)
			const existingCount = existingCache ? Object.keys(existingCache).length : 0

			if (modelCount === 0) {
				if (existingCount > 0) {
					return existingCache!
				} else {
					return {}
				}
			}

			// Update memory cache first
			memoryCache.set(legacyCacheKey(options), models)

			// Atomically write to disk (safeWriteJson handles atomic writes)
			await writeModels(provider, models, legacyCacheKey(options)).catch((err) =>
				logger.error("ModelCache", `Error writing ${provider} models to disk:`, err),
			)

			return models
		} catch (error) {
			// Log the error for debugging, then return existing cache if available (graceful degradation)
			logger.error("ModelCache", `Failed to refresh ${provider} models:`, error)
			return getModelsFromCache(provider, options) || {}
		} finally {
			// Always clean up the in-flight tracking
			inFlightRefresh.delete(legacyCacheKey(options))
		}
	})()

	// Track the in-flight request
	inFlightRefresh.set(legacyCacheKey(options), refreshPromise)

	return refreshPromise
}

/**
 * Initialize background model cache refresh.
 * Refreshes public provider caches without blocking or requiring auth.
 * Should be called once during extension activation.
 */
export function initializeModelCacheRefresh(): void {
	// Wait for extension to fully activate before refreshing
	setTimeout(async () => {
		// Providers that work without API keys
		const publicProviders: Array<{ provider: RouterName; options: GetModelsOptions }> = [
			{ provider: "openrouter", options: { provider: "openrouter" } },
			{ provider: "vercel-ai-gateway", options: { provider: "vercel-ai-gateway" } },
		]

		// Refresh each provider in background (fire and forget)
		for (const { options } of publicProviders) {
			refreshModels(options).catch((err) => {
				logger.debug("ModelCache", "background refresh", err)
			})

			// Small delay between refreshes to avoid API rate limits
			await new Promise((resolve) => setTimeout(resolve, 500))
		}
	}, 2000)
}

/**
 * Flush models memory cache for a specific router.
 *
 * @param options - The options for fetching models, including provider, apiKey, and baseUrl
 * @param refresh - If true, immediately fetch fresh data from API
 */
export const flushModels = async (options: GetModelsOptions, refresh: boolean = false): Promise<void> => {
	if (refresh) {
		// Don't delete memory cache - let refreshModels atomically replace it
		// This prevents a race condition where getModels() might be called
		// before refresh completes, avoiding a gap in cache availability
		// Await the refresh to ensure the cache is updated before returning
		await refreshModels(options)
	} else {
		// Only delete memory cache when not refreshing
		memoryCache.del(legacyCacheKey(options))
	}
}

/**
 * Get models from cache, checking memory first, then disk.
 * This ensures providers always have access to last known good data,
 * preventing fallback to hardcoded defaults on startup.
 *
 * @param provider - The provider to get models for.
 * @returns Models from memory cache, disk cache, or undefined if not cached.
 */
export function getModelsFromCache(
	provider: ProviderName,
	options: { apiKey?: string; baseUrl?: string } = {},
): ModelRecord | undefined {
	const key = legacyCacheKey({ provider, ...options })
	// Check memory cache first (fast)
	const memoryModels = memoryCache.get<ModelRecord>(key)
	if (memoryModels) {
		return memoryModels
	}

	// Memory cache miss - try to load from disk synchronously
	// This is acceptable because it only happens on cold start or after cache expiry
	try {
		const filename = `${key}_models.json`
		const cacheDir = getCacheDirectoryPathSync()
		if (!cacheDir) {
			return undefined
		}

		const filePath = path.join(cacheDir, filename)

		// Use synchronous fs to avoid async complexity in getModel() callers
		if (fsSync.existsSync(filePath)) {
			const data = fsSync.readFileSync(filePath, "utf8")
			const models = JSON.parse(data)

			// Validate the disk cache data structure using Zod schema
			// This ensures the data conforms to ModelRecord = Record<string, ModelInfo>
			const validation = modelRecordSchema.safeParse(models)
			if (!validation.success) {
				logger.error(
					"ModelCache",
					`Invalid disk cache data structure for ${provider}:`,
					z.treeifyError(validation.error),
				)
				return undefined
			}

			// Populate memory cache for future fast access
			memoryCache.set(key, validation.data)

			return validation.data
		}
	} catch (error) {
		logger.error("ModelCache", `Error loading ${provider} models from disk:`, error)
	}

	return undefined
}

/**
 * Synchronous version of getCacheDirectoryPath for use in getModelsFromCache.
 * Returns the cache directory path without async operations.
 */
function getCacheDirectoryPathSync(): string | undefined {
	try {
		const globalStoragePath = getModelCacheStore()?.globalStorageUri?.fsPath
		if (!globalStoragePath) {
			return undefined
		}
		const cachePath = path.join(globalStoragePath, "cache")
		return cachePath
	} catch (error) {
		logger.error("ModelCache", "Error getting cache directory path:", error)
		return undefined
	}
}

// Dynamic catalogs are scoped to the effective endpoint and authentication identity.
const DISK_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const dynamicMemoryCache = new NodeCache({ stdTTL: DISK_CACHE_TTL_MS / 1000, checkperiod: TIMING.MODEL_CACHE_TTL_S })
const dynamicInFlight = new Map<string, Promise<ModelCatalogResult>>()
const failedCatalogs = new NodeCache({ stdTTL: 30, checkperiod: TIMING.MODEL_CACHE_TTL_S })

function resolveCatalogOptions(provider: ProviderName, options: ListModelsOptions): ListModelsOptions {
	if (providerFetcherMap[provider] === "openai-compatible") return resolveOpenAIModelOptions(provider, options)
	if (provider === "anthropic")
		return {
			...options,
			apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
			baseUrl: options.baseUrl || "https://api.anthropic.com/v1",
		}
	if (provider === "gemini")
		return {
			...options,
			apiKey: options.apiKey ?? process.env.GEMINI_API_KEY,
			baseUrl: options.baseUrl || "https://generativelanguage.googleapis.com/v1beta",
		}
	if (provider === "minimax")
		return {
			...options,
			apiKey: options.apiKey ?? process.env.MINIMAX_API_KEY,
			baseUrl: options.baseUrl || "https://api.minimax.io/anthropic/v1",
		}
	return options
}

function dynamicDiskPath(key: string): string | undefined {
	const dir = getCacheDirectoryPathSync()
	return dir ? path.join(dir, "catalog_" + key + ".json") : undefined
}

function readCatalog(provider: ProviderName, key: string): ModelCatalogResult | undefined {
	const memory = dynamicMemoryCache.get<ModelCatalogResult>(key)
	if (memory) return memory
	const file = dynamicDiskPath(key)
	if (!file || !fsSync.existsSync(file)) return undefined
	try {
		const parsed = JSON.parse(fsSync.readFileSync(file, "utf8"))
		if (parsed.configFingerprint !== key || parsed.provider !== provider) return undefined
		const entry = diskCacheEntrySchema.parse(parsed)
		const stale = Date.now() - entry.timestamp >= DISK_CACHE_TTL_MS
		const result: ModelCatalogResult = {
			provider,
			configFingerprint: key,
			models: tagModels(entry.models, stale ? "stale-disk-cache" : "disk-cache"),
			source: stale ? "stale-disk-cache" : "disk-cache",
			fetchedAt: entry.timestamp,
			stale,
		}
		dynamicMemoryCache.set(key, result)
		return result
	} catch (error) {
		logger.debug("ModelCache", "Could not read scoped model catalog", error)
		return undefined
	}
}

function tagModels(models: ModelRecord, source: DynamicModelInfo["source"]): DynamicModelRecord {
	return Object.fromEntries(Object.entries(models).map(([id, info]) => [id, { ...info, source }]))
}

export function peekProviderCatalog(
	provider: ProviderName,
	options: ListModelsOptions = {},
): ModelCatalogResult | undefined {
	const resolved = resolveCatalogOptions(provider, options)
	return readCatalog(provider, modelCatalogIdentity(provider, resolved))
}

async function fetchDynamicModels(provider: ProviderName, options: ListModelsOptions): Promise<DynamicModelRecord> {
	switch (providerFetcherMap[provider]) {
		case "openai-compatible":
			return fetchOpenAICompatibleModels(provider, options)
		case "anthropic":
			return fetchAnthropicModels(options)
		case "gemini":
			return fetchGeminiModels(options)
		default:
			throw new Error("Model listing is unsupported for this provider")
	}
}

export async function resolveProviderCatalog(
	provider: ProviderName,
	input: ListModelsOptions = {},
): Promise<ModelCatalogResult> {
	const options = resolveCatalogOptions(provider, input)
	options.signal?.throwIfAborted()
	const key = modelCatalogIdentity(provider, options)
	const kind = providerFetcherMap[provider]
	const fallback = (refreshError: ModelCatalogResult["refreshError"]): ModelCatalogResult => ({
		provider,
		configFingerprint: key,
		models: fallbackModels[provider] ?? {},
		source: "hardcoded-fallback",
		stale: true,
		refreshError,
	})
	if (!kind || kind === "fallback-only" || kind === "existing" || options.listingUnsupported)
		return fallback("unsupported")
	const cached = readCatalog(provider, key)
	const failed = failedCatalogs.get<ModelCatalogResult>(key)
	if (!options.forceRefresh && failed) return failed
	if (
		!options.forceRefresh &&
		!cached?.refreshError &&
		!cached?.stale &&
		cached?.fetchedAt &&
		Date.now() - cached.fetchedAt < TIMING.MODEL_CACHE_TTL_S * 1000
	)
		return cached
	// Cancellable callers own their request; cancelling one caller must not cancel another.
	const existing = !options.signal ? dynamicInFlight.get(key) : undefined
	if (existing) return existing
	const pending = (async (): Promise<ModelCatalogResult> => {
		try {
			const models = modelRecordSchema.parse(await fetchDynamicModels(provider, options))
			if (
				Object.values(models).some(
					(model) => model.contextWindow <= 0 || (model.maxTokens != null && model.maxTokens <= 0),
				)
			)
				throw new SyntaxError("Invalid model limits")
			options.signal?.throwIfAborted()
			if (Object.keys(models).length === 0)
				throw Object.assign(new Error("Empty model catalog"), { catalogError: "empty" })
			const result: ModelCatalogResult = {
				provider,
				configFingerprint: key,
				models: tagModels(models, "api"),
				source: "api",
				fetchedAt: Date.now(),
				stale: false,
			}
			dynamicMemoryCache.set(key, result)
			failedCatalogs.del(key)
			const file = dynamicDiskPath(key)
			if (file)
				await safeWriteJson(file, {
					provider,
					configFingerprint: key,
					timestamp: result.fetchedAt,
					models: result.models,
				}).catch((error) => logger.debug("ModelCache", "Could not persist scoped model catalog", error))
			return result
		} catch (error) {
			options.signal?.throwIfAborted()
			// Do not send provider error bodies (which can echo credentials) to the UI or logs.
			const details = error as { status?: number; catalogError?: ModelCatalogResult["refreshError"] }
			const reason =
				details.catalogError ??
				(details.status === 401 || details.status === 403
					? "unauthorized"
					: error instanceof SyntaxError || error instanceof z.ZodError
						? "invalid_response"
						: "unavailable")
			logger.debug("ModelCache", "Model catalog refresh failed: " + reason)
			const known = readCatalog(provider, key) ?? cached
			const result: ModelCatalogResult = known
				? {
						...known,
						models: tagModels(known.models, "stale-disk-cache"),
						source: "stale-disk-cache",
						stale: true,
						refreshError: reason,
					}
				: fallback(reason)
			if (known) dynamicMemoryCache.set(key, result)
			failedCatalogs.set(key, result)
			return result
		} finally {
			if (!options.signal) dynamicInFlight.delete(key)
		}
	})()
	if (!options.signal) dynamicInFlight.set(key, pending)
	return pending
}

export async function listProviderModels(
	provider: ProviderName,
	options: ListModelsOptions = {},
): Promise<DynamicModelRecord> {
	return (await resolveProviderCatalog(provider, options)).models
}
