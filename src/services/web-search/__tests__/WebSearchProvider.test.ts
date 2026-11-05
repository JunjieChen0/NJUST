import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { guardedFetch } from "../../../core/security/networkGuard"
import {
	BaiduFreeSearchProvider,
	BaiduSearchProvider,
	BingSearchProvider,
	DuckDuckGoSearchProvider,
	GoogleSearchProvider,
	SerpApiSearchProvider,
	SogouFreeSearchProvider,
	TavilySearchProvider,
} from "../WebSearchProvider"

vi.mock("../../../core/security/networkGuard", () => ({ guardedFetch: vi.fn() }))

const guarded = vi.mocked(guardedFetch)
const result = { title: "Cangjie", url: "https://example.com/docs", snippet: "Language documentation" }
const ddgHtml = `<a rel="nofollow" href="${result.url}" class="result-link">${result.title}</a>`
const sogouHtml = `<h3><a href="${result.url}">${result.title}</a></h3>`
const baiduHtml = '<h3><a href="https://www.baidu.com/link?url=docs">Cangjie</a></h3>'

describe("search requests", () => {
	beforeEach(() => {
		vi.resetAllMocks()
		vi.stubGlobal(
			"fetch",
			vi.fn(() => {
				throw new Error("Unguarded request")
			}),
		)
	})
	afterEach(() => {
		vi.unstubAllGlobals()
		vi.useRealTimers()
	})

	it.each([
		["Tavily", () => new TavilySearchProvider("test-key"), JSON.stringify({ results: [result] })],
		[
			"Google",
			() => new GoogleSearchProvider("test-key|cx"),
			JSON.stringify({ items: [{ ...result, link: result.url }] }),
		],
		["Baidu API", () => new BaiduSearchProvider("test-key"), JSON.stringify({ references: [result] })],
		[
			"SerpAPI",
			() => new SerpApiSearchProvider("test-key"),
			JSON.stringify({ organic_results: [{ ...result, link: result.url }] }),
		],
		["DuckDuckGo", () => new DuckDuckGoSearchProvider(), ddgHtml],
		["Baidu Free", () => new BaiduFreeSearchProvider(), baiduHtml],
		["Sogou Free", () => new SogouFreeSearchProvider(), sogouHtml],
	] as const)("%s uses guarded requests and still returns results", async (_name, create, body) => {
		guarded.mockImplementation(async () => new Response(body))
		const results = await create().search("Cangjie", 5)
		expect(results[0]?.title).toBe("Cangjie")
		expect(guarded).toHaveBeenCalled()
		expect(fetch).not.toHaveBeenCalled()
	})

	it("uses the current Baidu POST contract and parses references", async () => {
		guarded.mockResolvedValue(Response.json({ references: [{ ...result, content: "content" }] }))
		const results = await new BaiduSearchProvider("baidu-test-key").search("Cangjie", 3)
		expect(results).toEqual([result])
		const [url, init] = guarded.mock.calls[0]!
		expect(url).toBe("https://qianfan.baidubce.com/v2/ai_search/web_search")
		expect(init?.method).toBe("POST")
		expect(init?.headers).toMatchObject({ Authorization: "Bearer baidu-test-key" })
		expect(JSON.parse(init?.body as string)).toEqual({
			messages: [{ role: "user", content: "Cangjie" }],
			search_source: "baidu_search_v2",
			resource_type_filter: [{ type: "web", top_k: 3 }],
		})
	})

	it("authenticates Tavily using the documented Bearer header", async () => {
		guarded.mockResolvedValue(Response.json({ results: [result] }))
		await new TavilySearchProvider("dummy-key").search("Cangjie", 1)
		const [, init] = guarded.mock.calls[0]!
		expect(init?.headers).toMatchObject({ Authorization: "Bearer dummy-key" })
		expect(JSON.parse(init?.body as string)).not.toHaveProperty("api_key")
	})

	it("reports a Baidu business error instead of an empty successful search", async () => {
		guarded.mockResolvedValue(Response.json({ code: "invalid_api_key", message: "Invalid key" }))
		await expect(new BaiduSearchProvider("bad-key").search("Cangjie", 1)).rejects.toThrow("Invalid key")
	})

	it("reports a SerpAPI business error instead of an empty successful search", async () => {
		guarded.mockResolvedValue(Response.json({ error: "Search provider unavailable" }))
		await expect(new SerpApiSearchProvider("test-key").search("Cangjie", 1)).rejects.toThrow("provider unavailable")
	})

	it("accepts SerpAPI's successful zero-result response even when it includes an error explanation", async () => {
		guarded.mockResolvedValue(
			Response.json({
				search_metadata: { status: "Success" },
				error: "Google hasn't returned any results for this query.",
			}),
		)
		expect(await new SerpApiSearchProvider("dummy-key").search("Cangjie", 1)).toEqual([])
	})

	it("does not call the retired Bing API or reuse its key with another provider", async () => {
		await expect(new BingSearchProvider("legacy-key").search("Cangjie", 1)).rejects.toThrow("2025-08-11")
		expect(guarded).not.toHaveBeenCalled()
		expect(fetch).not.toHaveBeenCalled()
	})

	it("preserves Baidu to Sogou fallback on an ordinary upstream failure", async () => {
		guarded
			.mockRejectedValueOnce(new Error("Baidu unavailable"))
			.mockImplementation(async () => new Response(sogouHtml))
		expect(await new BaiduFreeSearchProvider().search("Cangjie", 1)).toEqual([{ ...result, snippet: "" }])
		expect(guarded).toHaveBeenCalledTimes(3)
	})

	it("finds Baidu results after a large page preamble without falling back", async () => {
		guarded.mockResolvedValue(
			new Response(
				`<head><script>${"x".repeat(750_000)}</script></head><div id="content_left">${baiduHtml}</div>`,
			),
		)
		expect((await new BaiduFreeSearchProvider().search("Cangjie", 1))[0]?.title).toBe("Cangjie")
		expect(guarded).toHaveBeenCalledTimes(1)
	})

	it("does not start Sogou fallback when Baidu is cancelled", async () => {
		const controller = new AbortController()
		guarded.mockImplementation(
			async (_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
				}),
		)
		const pending = new BaiduFreeSearchProvider().search("Cangjie", 1, controller.signal)
		const outcome = expect(pending).rejects.toMatchObject({ name: "AbortError" })
		controller.abort()
		await outcome
		expect(guarded).toHaveBeenCalledTimes(1)
	})

	it("does not start a search after cancellation during Sogou warm-up", async () => {
		const controller = new AbortController()
		guarded.mockImplementation(async () => {
			controller.abort()
			throw controller.signal.reason
		})
		await expect(new SogouFreeSearchProvider().search("Cangjie", 1, controller.signal)).rejects.toMatchObject({
			name: "AbortError",
		})
		expect(guarded).toHaveBeenCalledTimes(1)
	})

	it("cancels a SerpAPI retry delay without sending another request", async () => {
		const controller = new AbortController()
		guarded.mockResolvedValue(new Response("rate limited", { status: 429 }))
		const pending = new SerpApiSearchProvider("test-key").search("Cangjie", 1, controller.signal)
		const outcome = expect(pending).rejects.toMatchObject({ name: "AbortError" })
		await vi.waitFor(() => expect(guarded).toHaveBeenCalledTimes(1))
		controller.abort()
		await outcome
		expect(guarded).toHaveBeenCalledTimes(1)
	})

	it("distinguishes a request timeout from user cancellation", async () => {
		vi.useFakeTimers()
		guarded.mockImplementation(
			async (_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })
				}),
		)
		const outcome = expect(new DuckDuckGoSearchProvider().search("Cangjie", 1)).rejects.toThrow("timed out")
		await vi.advanceTimersByTimeAsync(15_000)
		await outcome
	})

	it.each([200, 202])("rejects a DuckDuckGo challenge with HTTP %i", async (status) => {
		guarded.mockResolvedValue(new Response('<form action="/anomaly.js">Challenge</form>', { status }))
		await expect(new DuckDuckGoSearchProvider().search("Cangjie", 1)).rejects.toThrow("anti-bot")
	})

	it("reports an unrecognized page instead of claiming there are no relevant results", async () => {
		guarded.mockResolvedValue(new Response("<html>Unexpected upstream page</html>"))
		await expect(new DuckDuckGoSearchProvider().search("Cangjie", 1)).rejects.toThrow("unrecognized")
	})

	it("allows an explicit legitimate zero-result page", async () => {
		guarded.mockResolvedValue(new Response('<div class="no-results">No results found</div>'))
		expect(await new DuckDuckGoSearchProvider().search("Cangjie", 1)).toEqual([])
	})
})
