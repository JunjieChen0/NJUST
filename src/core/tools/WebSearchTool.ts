import { BaseTool, type ToolCallbacks } from "./BaseTool"
import type { Task } from "../task/Task"
import { TavilySearchProvider, formatSearchResults } from "../../services/web-search/WebSearchProvider"

class WebSearchToolImpl extends BaseTool<"web_search"> {
	readonly name = "web_search" as const

	async execute(
		params: { search_query: string; count?: number | null },
		task: Task,
		{ askApproval, handleError, pushToolResult }: ToolCallbacks,
	): Promise<void> {
		try {
			const query = params.search_query
			const count = params.count ?? 5

			if (!query || query.trim().length === 0) {
				pushToolResult("Error: search_query is required and cannot be empty.")
				return
			}

			const provider = task.providerRef.deref()
			const state = await provider?.getState()
			const apiKey = state?.webSearchApiKey

			if (!apiKey) {
				pushToolResult(
					"Error: Web search API key is not configured. Please set the 'njust-ai-cj.webSearchApiKey' setting in VS Code with your Tavily API key. You can get a free key at https://tavily.com",
				)
				return
			}

			const approved = await askApproval("tool", JSON.stringify({ tool: "web_search", query, count }))
			if (!approved) {
				pushToolResult("Web search was not approved by the user.")
				return
			}

			const searchProvider = new TavilySearchProvider(apiKey)
			const results = await searchProvider.search(query, count)
			const formatted = formatSearchResults(results)

			pushToolResult(formatted)
		} catch (error) {
			await handleError("web search", error instanceof Error ? error : new Error(String(error)))
		} finally {
			this.resetPartialState()
		}
	}
}

export const webSearchTool = new WebSearchToolImpl()
