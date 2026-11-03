import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
	type RouterModels,
	type ExtensionMessage,
	type ProviderSettings,
	type ModelCatalogStatus,
	type RouterProvider,
	modelCatalogConnectionSettings,
} from "@njust-ai/types"
import { vscode } from "@src/utils/vscode"

type UseRouterModelsOptions = { provider?: string; enabled?: boolean; configuration?: ProviderSettings }
type CatalogResponse = { models: RouterModels; catalog?: ModelCatalogStatus }
let requestSequence = 0

export function getRouterModels(
	provider?: string,
	configuration?: ProviderSettings,
	signal?: AbortSignal,
): Promise<CatalogResponse> {
	return new Promise((resolve, reject) => {
		const requestId = "models-" + ++requestSequence
		const cleanup = () => {
			window.removeEventListener("message", handler)
			signal?.removeEventListener("abort", aborted)
			clearTimeout(timeout)
		}
		const aborted = () => {
			cleanup()
			reject(signal?.reason ?? new Error("Model request cancelled"))
		}
		// The backend has a deadline including body reads and pagination. Leave time for IPC delivery.
		const timeout = setTimeout(() => {
			cleanup()
			reject(new Error("Router models request timed out"))
		}, 15000)
		const handler = (event: MessageEvent<ExtensionMessage>) => {
			const message = event.data
			if (
				message.type !== "routerModels" ||
				message.values?.provider !== provider ||
				message.values?.requestId !== requestId
			)
				return
			cleanup()
			if (!message.routerModels) {
				reject(new Error("No router models in response"))
				return
			}
			resolve({
				models: message.routerModels,
				catalog: provider ? message.routerModelCatalogs?.[provider as RouterProvider] : undefined,
			})
		}
		window.addEventListener("message", handler)
		signal?.addEventListener("abort", aborted, { once: true })
		if (signal?.aborted) {
			aborted()
			return
		}
		vscode.postMessage({
			type: "requestRouterModels",
			apiConfiguration: configuration,
			values: { ...(provider ? { provider } : {}), requestId, refresh: true },
		})
	})
}

export const useRouterModels = (opts: UseRouterModelsOptions = {}) => {
	const provider = opts.provider || undefined
	const connection = opts.configuration ? modelCatalogConnectionSettings(opts.configuration) : undefined
	const serialized = JSON.stringify(connection ?? {})
	const [identity, setIdentity] = useState<{ input: string; fingerprint: string }>()
	const [identityError, setIdentityError] = useState<Error>()
	useEffect(() => {
		let cancelled = false
		const timer = setTimeout(() => {
			void crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized)).then(
				(digest) => {
					if (!cancelled) {
						setIdentity({
							input: serialized,
							fingerprint: Array.from(new Uint8Array(digest), (byte) =>
								byte.toString(16).padStart(2, "0"),
							).join(""),
						})
						setIdentityError(undefined)
					}
				},
				() => {
					if (!cancelled) setIdentityError(new Error("Cannot prepare model catalog request"))
				},
			)
		}, 250)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [serialized])
	const ready = identity?.input === serialized
	const query = useQuery({
		queryKey: ["routerModels", provider || "all", ready ? identity.fingerprint : "pending"],
		queryFn: ({ signal }) => getRouterModels(provider, connection, signal),
		enabled: opts.enabled !== false && ready && !identityError,
		staleTime: 5 * 60 * 1000,
		retry: false,
	})
	return {
		...query,
		data: ready ? query.data?.models : undefined,
		catalog: ready ? query.data?.catalog : undefined,
		isLoading: opts.enabled !== false && (!ready || query.isLoading),
		isError: Boolean(identityError) || query.isError,
		error: identityError ?? query.error,
	}
}
