import { afterEach, describe, expect, it, vi } from "vitest"
import { DuckDuckGoSearchProvider } from "../WebSearchProvider"

vi.mock("node:dns/promises", () => ({
	lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
	default: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}))

describe("search network boundary", () => {
	afterEach(() => vi.unstubAllGlobals())

	it("uses the real guard to reject a redirect into the private network", async () => {
		const transport = vi.fn(
			async (_url: string, _init?: RequestInit) =>
				new Response("redirect", {
					status: 302,
					headers: { Location: "http://127.0.0.1/private" },
				}),
		)
		vi.stubGlobal("fetch", transport)
		await expect(new DuckDuckGoSearchProvider().search("Cangjie", 1)).rejects.toThrow(/Blocked private/)
		expect(transport).toHaveBeenCalledTimes(1)
		expect(transport.mock.calls[0]?.[0]).toContain("https://lite.duckduckgo.com/")
	})

	it("still parses a successful public response through the real guard", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response('<a rel="nofollow" href="https://example.com/docs" class="result-link">Cangjie</a>'),
			),
		)
		expect(await new DuckDuckGoSearchProvider().search("Cangjie", 1)).toEqual([
			{ title: "Cangjie", url: "https://example.com/docs", snippet: "" },
		])
	})
})
