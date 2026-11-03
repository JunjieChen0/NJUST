import { type ModelInfo, type ProviderName, mergeCatalogModelInfo, unknownCatalogModelInfo } from "@njust-ai/types"
import type { ApiHandlerOptions } from "../../shared/api"
import { peekProviderCatalog } from "./fetchers/modelCache"
import { modelConnection } from "./modelConnection"

export const unknownModelInfo = unknownCatalogModelInfo

/** Merge only facts about this exact model; list endpoints often omit capabilities and prices. */
export function resolveModelInfo(
	provider: ProviderName,
	options: ApiHandlerOptions,
	id: string,
	builtin?: ModelInfo,
): ModelInfo {
	if (options.modelSnapshot?.current?.id === id) return options.modelSnapshot.current.info
	const catalog = peekProviderCatalog(provider, modelConnection(provider, options))
	const dynamic = catalog?.models[id]
	return mergeCatalogModelInfo(builtin, dynamic)
}
