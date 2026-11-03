import React from "react"
import { webcrypto } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ProviderSettings } from "@njust-ai/types"
import { vscode } from "@src/utils/vscode"
import { getRouterModels, useRouterModels } from "../useRouterModels"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))
const request = vi.mocked(vscode.postMessage)
const sent = (index: number) => request.mock.calls[index]![0]!
beforeEach(() => {
	vi.stubGlobal("crypto", webcrypto)
	request.mockClear()
})
afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})
const reply = (requestId: unknown, id: string) =>
	window.dispatchEvent(
		new MessageEvent("message", {
			data: {
				type: "routerModels",
				values: { provider: "qwen", requestId },
				routerModels: { qwen: { [id]: { contextWindow: 32000, supportsPromptCache: false } } },
				routerModelCatalogs: {
					qwen: { configFingerprint: "server-identity", source: "api", fetchedAt: 1234, stale: false },
				},
			},
		}),
	)
const wrapperFor =
	(client: QueryClient) =>
	({ children }: { children: React.ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	)
const configuration = (key: string): ProviderSettings => ({
	apiProvider: "qwen",
	qwenApiKey: key,
	qwenBaseUrl: `https://${key}.invalid/v1`,
	apiModelId: "chosen-new-model",
})

describe("model catalog request correlation", () => {
	it("ignores an older response from the same provider", async () => {
		const pending = getRouterModels("qwen", configuration("fixture"))
		const id = sent(0).values?.requestId
		let settled = false
		void pending.then(() => {
			settled = true
		})
		reply("old-request", "old")
		await Promise.resolve()
		expect(settled).toBe(false)
		reply(id, "current")
		expect((await pending).models.qwen).toHaveProperty("current")
	})
	it("removes the listener when cancelled", async () => {
		const controller = new AbortController()
		const remove = vi.spyOn(window, "removeEventListener")
		const pending = getRouterModels("qwen", configuration("cancel"), controller.signal)
		controller.abort()
		await expect(pending).rejects.toMatchObject({ name: "AbortError" })
		expect(remove).toHaveBeenCalledWith("message", expect.any(Function))
		remove.mockRestore()
	})
	it("queries unsaved connection settings without saving or exposing secrets in query keys", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const { result } = renderHook(
			() => useRouterModels({ provider: "qwen", configuration: configuration("draft-secret") }),
			{ wrapper: wrapperFor(client) },
		)
		await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
		const message = sent(0)
		expect(message).toMatchObject({
			type: "requestRouterModels",
			apiConfiguration: { qwenApiKey: "draft-secret", qwenBaseUrl: "https://draft-secret.invalid/v1" },
			values: { refresh: true },
		})
		expect(message.apiConfiguration?.apiModelId).toBeUndefined()
		expect(
			JSON.stringify(
				client
					.getQueryCache()
					.getAll()
					.map((query) => query.queryKey),
			),
		).not.toContain("draft-secret")
		act(() => {
			reply(message.values?.requestId, "new-model")
		})
		await waitFor(() => expect(result.current.data?.qwen).toHaveProperty("new-model"))
		expect(request.mock.calls.every(([value]) => value.type === "requestRouterModels")).toBe(true)
	})
	it("does not replace a new connection's models with an older response", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const { result, rerender } = renderHook(
			({ config }) => useRouterModels({ provider: "qwen", configuration: config }),
			{ initialProps: { config: configuration("a") }, wrapper: wrapperFor(client) },
		)
		await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
		const first = sent(0)
		rerender({ config: configuration("b") })
		await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
		act(() => {
			reply(first.values?.requestId, "a-only")
		})
		expect(result.current.data).toBeUndefined()
		act(() => {
			reply(sent(1).values?.requestId, "b-only")
		})
		await waitFor(() => expect(result.current.data?.qwen).toHaveProperty("b-only"))
		expect(result.current.data?.qwen).not.toHaveProperty("a-only")
	})
	it("refresh requests a new catalog even when query data is cached", async () => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
		const { result } = renderHook(
			() => useRouterModels({ provider: "qwen", configuration: configuration("refresh") }),
			{ wrapper: wrapperFor(client) },
		)
		await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
		act(() => {
			reply(sent(0).values?.requestId, "first")
		})
		await waitFor(() => expect(result.current.data?.qwen).toHaveProperty("first"))
		let refreshed!: ReturnType<typeof result.current.refetch>
		act(() => {
			refreshed = result.current.refetch()
		})
		await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
		expect(sent(1).values?.refresh).toBe(true)
		await act(async () => {
			reply(sent(1).values?.requestId, "second")
			await refreshed
		})
		await waitFor(() => expect(result.current.data?.qwen).toHaveProperty("second"))
	})
})
