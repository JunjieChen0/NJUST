export interface WebSearchResult {
	title: string
	url: string
	snippet: string
}

export interface WebSearchProvider {
	search(query: string, count: number): Promise<WebSearchResult[]>
}

export class TavilySearchProvider implements WebSearchProvider {
	constructor(private apiKey: string) {}

	async search(query: string, count: number): Promise<WebSearchResult[]> {
		const truncatedQuery = query.length > 400 ? query.slice(0, 400) : query

		const controller = new AbortController()
		const timeoutId = setTimeout(() => controller.abort(), 15_000)

		try {
			const response = await fetch("https://api.tavily.com/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					api_key: this.apiKey,
					query: truncatedQuery,
					max_results: Math.min(count, 10),
					search_depth: "basic",
					include_answer: false,
				}),
				signal: controller.signal,
			})

			if (!response.ok) {
				if (response.status === 429) {
					throw new Error("Web search rate limited. Please wait a moment and try again.")
				}
				throw new Error(`Web search failed with status ${response.status}: ${response.statusText}`)
			}

			const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> }

			if (!data.results || !Array.isArray(data.results)) {
				return []
			}

			return data.results.map((r) => ({
				title: r.title || "Untitled",
				url: r.url || "",
				snippet: r.content || "",
			}))
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				throw new Error("Web search timed out after 15 seconds.")
			}
			throw error
		} finally {
			clearTimeout(timeoutId)
		}
	}
}

export function formatSearchResults(results: WebSearchResult[]): string {
	if (results.length === 0) {
		return "No relevant web search results found."
	}

	return results
		.map((r, i) => `**${i + 1}. ${r.title}**\n${r.url}\n${r.snippet}`)
		.join("\n\n---\n\n")
}
