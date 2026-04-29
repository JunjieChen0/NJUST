import type OpenAI from "openai"

const WEB_SEARCH_DESCRIPTION = `Search the web for real-time information. Use this tool when you need up-to-date information that may not be in your training data, such as:
- Current library versions, API changes, or deprecations
- Recent news, announcements, or release notes
- Current documentation or best practices that may have changed
- Debugging errors that reference recent changes in frameworks or services

The tool returns search results with titles, URLs, and content snippets. Always cite the source URLs when presenting information from web search results.

Parameters:
- search_query: (required) The search query string. Be specific and include relevant keywords.
- count: (optional) Number of results to return (1-10, default 5).

Example: Search for the latest React documentation
{ "search_query": "React 19 new features documentation 2026", "count": 5 }`

export default {
	type: "function",
	function: {
		name: "web_search",
		description: WEB_SEARCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				search_query: {
					type: "string",
					description: "The search query to look up on the web",
				},
				count: {
					type: ["number", "null"],
					description: "Number of results to return (1-10, default 5)",
				},
			},
			required: ["search_query"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
