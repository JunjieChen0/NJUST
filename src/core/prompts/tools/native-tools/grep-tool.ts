import type OpenAI from "openai"

const GREP_TOOL_DESCRIPTION = `Request to perform a regex text search across files using ripgrep. This tool searches for patterns in file contents, returning matching lines with file paths, line numbers, and surrounding context.

Use this tool for fast, targeted text searches when you know what pattern to look for. It complements codebase_search (semantic) and search_files by providing pure regex-based matching with context lines.

Parameters:
- pattern: (required) The regular expression pattern to search for. Uses Rust regex syntax.
- path: (optional, defaults to '.') The directory path to search in (relative to the current workspace directory). This directory will be recursively searched.
- include: (optional) Glob pattern to filter which files are searched (e.g., '*.ts', '*.{js,jsx}'). If not provided, all files are searched.
- exclude: (optional) Glob pattern to exclude files from the search (e.g., '*.test.ts', 'node_modules/**').
- contextLines: (optional) Number of context lines to show before and after each match. Defaults to 1.

Example: Search for TODO comments in TypeScript files
{ "pattern": "TODO:", "include": "*.ts" }

Example: Search for function definitions in src directory
{ "pattern": "function\\s+\\w+\\s*\\(", "path": "src" }

Example: Search for import statements excluding test files
{ "pattern": "^import .+ from", "path": ".", "include": "*.ts", "exclude": "*.test.ts" }

Example: Search for function definitions
{ "pattern": "(function|const|let|var)\\s+\\w+\\s*[=(]", "path": "src", "include": "*.ts" }

Example: Search for error messages
{ "pattern": "(Error|throw|reject)\\b.*", "include": "*.{ts,js}" }`

const PATTERN_PARAMETER_DESCRIPTION = `Rust-compatible regular expression pattern to search for in file contents`

const PATH_PARAMETER_DESCRIPTION = `Directory to search recursively, relative to the workspace (defaults to '.')`

const INCLUDE_PARAMETER_DESCRIPTION = `Optional glob pattern to filter which files are searched (e.g., '*.ts')`

const EXCLUDE_PARAMETER_DESCRIPTION = `Optional glob pattern to exclude files from the search (e.g., '*.test.ts')`

const CONTEXT_LINES_PARAMETER_DESCRIPTION = `Number of context lines to display before and after each match (defaults to 1)`

export default {
	type: "function",
	function: {
		name: "grep",
		description: GREP_TOOL_DESCRIPTION,
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
				include: {
					type: ["string", "null"],
					description: INCLUDE_PARAMETER_DESCRIPTION,
				},
				exclude: {
					type: ["string", "null"],
					description: EXCLUDE_PARAMETER_DESCRIPTION,
				},
				contextLines: {
					type: ["number", "null"],
					description: CONTEXT_LINES_PARAMETER_DESCRIPTION,
				},
			},
			required: ["pattern"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
