import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveProviderCatalog, listProviderModels, getModels } from "../modelCache"
import { setModelCacheStore } from "../modelCacheStore"
import { modelCatalogIdentity } from "../../modelCatalogIdentity"

beforeEach(() => setModelCacheStore(undefined))
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
	vi.useRealTimers()
})
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })

describe("model catalog identity and freshness", () => {
	it.each(["apiKey", "baseUrl", "headers"] as const)(
		"does not share failure backoff across different %s",
		async (field) => {
			const request = vi.fn(async () => new Response("denied", { status: 401 }))
			vi.stubGlobal("fetch", request)
			const first = {
				apiKey: `scope-${field}`,
				baseUrl: "https://backoff-scope.invalid/v1",
				headers: { "x-tenant": "first" },
			}
			await resolveProviderCatalog("openai", first)
			const next =
				field === "apiKey"
					? { ...first, apiKey: "next" }
					: field === "baseUrl"
						? { ...first, baseUrl: "https://next.invalid/v1" }
						: { ...first, headers: { "x-tenant": "next" } }
			await resolveProviderCatalog("openai", next)
			expect(request).toHaveBeenCalledTimes(2)
		},
	)
	it("clears failure backoff on a successful manual refresh", async () => {
		const request = vi.fn(async () => new Response("denied", { status: 401 }))
		vi.stubGlobal("fetch", request)
		const options = { apiKey: "recovery", baseUrl: "https://recovery.invalid/v1" }
		await resolveProviderCatalog("openai", options)
		request.mockResolvedValue(json({ data: [{ id: "recovered" }] }))
		await resolveProviderCatalog("openai", { ...options, forceRefresh: true })
		const cached = await resolveProviderCatalog("openai", options)
		expect(cached).toMatchObject({ source: "api", stale: false })
		expect(cached.models.recovered).toBeDefined()
		expect(request).toHaveBeenCalledTimes(2)
	})
	it("retries a failed refresh after backoff while retaining the original receipt time", async () => {
		vi.useFakeTimers()
		const request = vi.fn(async () => json({ data: [{ id: "receipt" }] }))
		vi.stubGlobal("fetch", request)
		const options = { apiKey: "receipt", baseUrl: "https://receipt.invalid/v1" }
		const first = await resolveProviderCatalog("openai", options)
		request.mockResolvedValue(new Response("denied", { status: 403 }))
		const failed = await resolveProviderCatalog("openai", { ...options, forceRefresh: true })
		expect(failed.fetchedAt).toBe(first.fetchedAt)
		await vi.advanceTimersByTimeAsync(30_001)
		request.mockResolvedValue(json({ data: [{ id: "fresh-receipt" }] }))
		const recovered = await resolveProviderCatalog("openai", options)
		expect(request).toHaveBeenCalledTimes(3)
		expect(recovered.models["fresh-receipt"]).toBeDefined()
		expect(recovered.fetchedAt).toBeGreaterThan(first.fetchedAt!)
	})
	it("does not put caller cancellation into failure backoff", async () => {
		const request = vi.fn(async () => new Response(new ReadableStream()))
		vi.stubGlobal("fetch", request)
		const options = { apiKey: "cancelling", baseUrl: "https://cancelling.invalid/v1" }
		const controller = new AbortController()
		const cancelled = resolveProviderCatalog("openai", { ...options, signal: controller.signal })
		const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" })
		await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
		controller.abort()
		await rejected
		request.mockResolvedValue(json({ data: [{ id: "after-cancel" }] }))
		const result = await resolveProviderCatalog("openai", options)
		expect(result.models["after-cancel"]).toBeDefined()
		expect(request).toHaveBeenCalledTimes(2)
	})
	it("backs off after an initial body timeout rather than adding another ten-second wait", async () => {
		vi.useFakeTimers()
		const request = vi.fn(async () => new Response(new ReadableStream()))
		vi.stubGlobal("fetch", request)
		const options = { apiKey: "cooldown", baseUrl: "https://cooldown.invalid/v1" }
		const first = resolveProviderCatalog("openai", options)
		await vi.advanceTimersByTimeAsync(10_000)
		expect(await first).toMatchObject({ refreshError: "unavailable", stale: true })
		const started = Date.now()
		let elapsed = -1
		const second = resolveProviderCatalog("openai", options).then((result) => {
			elapsed = Date.now() - started
			return result
		})
		await vi.advanceTimersByTimeAsync(10_000)
		expect((await second).fetchedAt).toBeUndefined()
		expect(elapsed).toBe(0)
		expect(request).toHaveBeenCalledTimes(1)
	})
	it("lets force refresh bypass failure backoff and retries normally after backoff expires", async () => {
		vi.useFakeTimers()
		const request = vi.fn(async () => new Response("denied", { status: 401 }))
		vi.stubGlobal("fetch", request)
		const options = { apiKey: "backoff", baseUrl: "https://backoff.invalid/v1" }
		await resolveProviderCatalog("openai", options)
		await resolveProviderCatalog("openai", options)
		expect(request).toHaveBeenCalledTimes(1)
		await resolveProviderCatalog("openai", { ...options, forceRefresh: true })
		expect(request).toHaveBeenCalledTimes(2)
		await vi.advanceTimersByTimeAsync(30_001)
		await resolveProviderCatalog("openai", options)
		expect(request).toHaveBeenCalledTimes(3)
	})
	it("keeps a newer successful receipt when an older concurrent request fails", async () => {
		let release!: (response: Response) => void
		const firstResponse = new Promise<Response>((resolve) => {
			release = resolve
		})
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockImplementationOnce(() => firstResponse)
				.mockResolvedValueOnce(json({ data: [{ id: "newest-receipt" }] })),
		)
		const first = resolveProviderCatalog("qwen", {
			apiKey: "parallel",
			forceRefresh: true,
			signal: new AbortController().signal,
		})
		const newer = await resolveProviderCatalog("qwen", {
			apiKey: "parallel",
			forceRefresh: true,
			signal: new AbortController().signal,
		})
		release(new Response("denied", { status: 403 }))
		const failed = await first
		expect(failed.fetchedAt).toBe(newer.fetchedAt)
		expect(Object.keys(failed.models)).toEqual(["newest-receipt"])
		expect(failed.stale).toBe(true)
	})
	it.each(["credentials", "headers"] as const)("isolates changes to %s at the same endpoint", async (field) => {
		let calls = 0
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json({ data: [{ id: `model-${++calls}` }] })),
		)
		const first = {
			apiKey: `fixture-${field}`,
			baseUrl: "https://same-endpoint.invalid/v1",
			headers: { "x-tenant": "a" },
		}
		await listProviderModels("openai-native", { ...first, forceRefresh: true })
		const next =
			field === "credentials" ? { ...first, apiKey: "other-account" } : { ...first, headers: { "x-tenant": "b" } }
		expect(Object.keys(await listProviderModels("openai-native", next))).toEqual(["model-2"])
	})
	it("does not reuse a different endpoint or account's models", async () => {
		const fetch = vi.fn(async (url: string) =>
			json({ data: [{ id: url.includes("account-a") ? "model-a" : "model-b" }] }),
		)
		vi.stubGlobal("fetch", fetch)
		await listProviderModels("qwen", { apiKey: "a", baseUrl: "https://account-a.invalid/v1", forceRefresh: true })
		const second = await listProviderModels("qwen", { apiKey: "b", baseUrl: "https://account-b.invalid/v1" })
		expect(Object.keys(second)).toEqual(["model-b"])
		expect(fetch).toHaveBeenCalledTimes(2)
	})
	it("deduplicates only the same configuration and force refresh bypasses cached data", async () => {
		const fetch = vi.fn(async () => json({ data: [{ id: "fresh-model" }] }))
		vi.stubGlobal("fetch", fetch)
		const options = { apiKey: "dedup", forceRefresh: true }
		const [a, b] = await Promise.all([
			resolveProviderCatalog("qwen", options),
			resolveProviderCatalog("qwen", options),
		])
		expect(a).toEqual(b)
		expect(fetch).toHaveBeenCalledTimes(1)
		await resolveProviderCatalog("qwen", { apiKey: "dedup" })
		expect(fetch).toHaveBeenCalledTimes(1)
		await resolveProviderCatalog("qwen", options)
		expect(fetch).toHaveBeenCalledTimes(2)
	})
	it("keeps the original timestamp and explicitly reports stale data on refresh failure", async () => {
		vi.useFakeTimers()
		const fetch = vi.fn(async () => json({ data: [{ id: "last-good" }] }))
		vi.stubGlobal("fetch", fetch)
		const initial = await resolveProviderCatalog("qwen", { apiKey: "stale", forceRefresh: true })
		await vi.advanceTimersByTimeAsync(1000)
		fetch.mockResolvedValue(new Response("denied", { status: 403 }))
		const stale = await resolveProviderCatalog("qwen", { apiKey: "stale", forceRefresh: true })
		expect(stale).toMatchObject({
			source: "stale-disk-cache",
			fetchedAt: initial.fetchedAt,
			stale: true,
			refreshError: "unauthorized",
		})
		expect(stale.models["last-good"]).toBeDefined()
	})
	it("does not cache empty lists as successful discovery", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => json({ data: [] })),
		)
		const result = await resolveProviderCatalog("qwen", { apiKey: "empty", forceRefresh: true })
		expect(result).toMatchObject({ source: "hardcoded-fallback", stale: true, refreshError: "empty" })
		expect(result.fetchedAt).toBeUndefined()
	})
	it("uses a digest for secrets and normalizes header ordering", () => {
		const a = modelCatalogIdentity("qwen", {
			apiKey: "secret",
			baseUrl: "https://example.invalid",
			headers: { B: "2", a: "1" },
		})
		const b = modelCatalogIdentity("qwen", {
			apiKey: "secret",
			baseUrl: "https://example.invalid",
			headers: { A: "1", b: "2" },
		})
		expect(a).toMatch(/^[a-f0-9]{64}$/)
		expect(a).toBe(b)
		expect(a).not.toContain("secret")
		expect(a).not.toBe(modelCatalogIdentity("qwen", { apiKey: "other" }))
	})
	it("does not convert cancellation into a cached fallback", async () => {
		const controller = new AbortController()
		controller.abort()
		await expect(resolveProviderCatalog("qwen", { signal: controller.signal })).rejects.toMatchObject({
			name: "AbortError",
		})
	})
	it("isolates legacy router catalogs by endpoint and API key", async () => {
		const request = vi.fn(async (url: string) => json({ data: [{ id: url.includes("router-a") ? "a" : "b" }] }))
		vi.stubGlobal("fetch", request)
		// The legacy Requesty fetcher uses axios; LiteLLM has a dedicated mock in its own suite.
		const { default: axios } = await import("axios")
		vi.spyOn(axios, "get").mockImplementation(async (url) => ({
			data: {
				data: [
					{
						id: String(url).includes("router-a") ? "a" : "b",
						max_output_tokens: 4096,
						context_window: 128000,
					},
				],
			},
		}))
		const a = await getModels({ provider: "requesty", apiKey: "legacy-a", baseUrl: "https://router-a.invalid" })
		const b = await getModels({ provider: "requesty", apiKey: "legacy-b", baseUrl: "https://router-b.invalid" })
		expect(Object.keys(a)).not.toEqual(Object.keys(b))
	})
})
