import { createHash } from "node:crypto"
import type { ProviderName } from "@njust-ai/types"
import type { ListModelsOptions } from "./modelTypes"

/** Only the digest leaves this function; credentials and header values never enter cache names. */
export function modelCatalogIdentity(provider: ProviderName, options: ListModelsOptions): string {
	const headers = Object.entries(options.headers ?? {})
		.map(([key, value]): [string, string] => [key.toLowerCase(), value])
		.sort(([a], [b]) => a.localeCompare(b))
	return createHash("sha256")
		.update(
			JSON.stringify([
				provider,
				options.baseUrl ?? "",
				options.apiKey ?? "",
				headers,
				options.apiVersion ?? "",
				options.listingUnsupported ?? false,
			]),
		)
		.digest("hex")
}
