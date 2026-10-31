import { createTRPCProxyClient, httpBatchLink } from "@trpc/client"
import superjson from "superjson"

import type { User, Org } from "./types.js"

export interface ClientConfig {
	url: string
	authToken: string
}

export interface RooClient {
	auth: {
		me: {
			query: () => Promise<{ type: "user"; user: User } | { type: "org"; org: Org } | null>
		}
	}
}

export const createClient = ({ url, authToken }: ClientConfig): RooClient => {
	return createTRPCProxyClient({
		links: [
			httpBatchLink({
				url: `${url}/trpc`,
				transformer: superjson,
				headers: () => (authToken ? { Authorization: `Bearer ${authToken}` } : {}),
			}),
		],
		// tRPC's proxy type is resolved at runtime from the remote router, so it cannot overlap structurally.
	}) as unknown as RooClient
}
