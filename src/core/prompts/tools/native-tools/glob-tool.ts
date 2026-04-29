import type OpenAI from "openai"

const GLOB_TOOL_DESCRIPTION = `Search for files matching a glob pattern. This tool finds files by name/path pattern using standard glob syntax (e.g. "**/*.ts", "src/**/*.test.js"). It returns matching file paths (relative to the search directory), respecting .gitignore rules. Results are limited to 2000 files.

Parameters:
- pattern: The glob pattern to match files against (e.g. "**/*.ts", "src/**/*.{js,jsx}", "*.json").
- path: (Optional) The directory to search in, relative to the workspace root. Defaults to the workspace root if omitted.

Example: Find all TypeScript files
{ "pattern": "**/*.ts" }

Example: Find test files under src
{ "pattern": "**/*.test.{ts,js}", "path": "src" }

Example: Find JSON config files in root
{ "pattern": "*.json" }`

const PATTERN_PARAMETER_DESCRIPTION = `Glob pattern to match files (e.g. "**/*.ts", "src/**/*.js")`

const PATH_PARAMETER_DESCRIPTION = `Directory to search in, relative to the workspace root. Defaults to workspace root if omitted.`

export default {
	type: "function",
	function: {
		name: "glob",
		description: GLOB_TOOL_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				pattern: {
					type: "string",
					description: PATTERN_PARAMETER_DESCRIPTION,
				},
				path: {
					type: ["string", "null"],
					description: PATH_PARAMETER_DESCRIPTION,
				},
			},
			required: ["pattern"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
