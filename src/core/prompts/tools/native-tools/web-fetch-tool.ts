import type OpenAI from "openai"

const WEB_FETCH_DESCRIPTION = `Fetch the content of a web page by URL. Use this tool to retrieve and read the contents of a specific URL, such as:
- Reading documentation pages, API references, or technical articles
- Fetching raw content from web endpoints
- Extracting text or structured data from web pages

The tool supports multiple output formats:
- "text" (default): Extracts readable text content, stripping HTML tags
- "html": Returns raw HTML content
- "json": Parses and returns JSON response data
- "markdown": Converts HTML content to Markdown format

Security: Only HTTP and HTTPS URLs are allowed. Requests have a 30s timeout and 5MB size limit.

Parameters:
- url: (required) The HTTP or HTTPS URL to fetch.
- format: (optional) Output format - "text", "html", "json", or "markdown". Default: "text".
- maxLength: (optional) Maximum character length of the returned content. Default: 100000.

Example: Fetch a documentation page as markdown
{ "url": "https://docs.example.com/api", "format": "markdown" }

Example: Fetch a web page as text
{ "url": "https://example.com/about" }

Example: Fetch API JSON data
{ "url": "https://api.example.com/v1/users", "format": "json" }`

export default {
	type: "function",
	function: {
		name: "web_fetch",
		description: WEB_FETCH_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				url: {
					type: "string",
					description: "The HTTP or HTTPS URL to fetch content from",
				},
				format: {
					type: ["string", "null"],
					enum: ["text", "html", "json", "markdown", null],
					description:
						'Output format: "text" (extract readable text), "html" (raw HTML), "json" (JSON data), "markdown" (convert to Markdown). Default: "text".',
				},
				maxLength: {
					type: ["number", "null"],
					description: "Maximum character length of the returned content. Default: 100000.",
				},
			},
			required: ["url", "format", "maxLength"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
