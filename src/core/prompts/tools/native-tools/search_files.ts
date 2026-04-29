import type OpenAI from "openai"

const SEARCH_FILES_DESCRIPTION = `Request to perform a regex search across files in a specified directory, providing context-rich results. This tool searches for patterns or specific content across multiple files, displaying each match with encapsulating context.

Craft your regex patterns carefully to balance specificity and flexibility. Use this tool to find code patterns, TODO comments, function definitions, or any text-based information across the project. The results include surrounding context, so analyze the surrounding code to better understand the matches. Leverage this tool in combination with other tools for more comprehensive analysis.

Parameters:
- path: (optional, defaults to '.') The path of the directory to search in (relative to the current workspace directory). This directory will be recursively searched.
- regex: (required) The regular expression pattern to search for. Uses Rust regex syntax.
- file_pattern: (optional) Glob pattern to filter files (e.g., '*.ts' for TypeScript files). If not provided, it will search all files (*).
- semantic_query: (optional) Natural language query for semantic (keyword-based) search. When provided and the path points to the bundled CangjieCorpus, the tool uses BM25-ranked keyword matching instead of regex, returning the most relevant documentation chunks. Falls back to regex if no semantic index is available.

Important:
- If you are unsure about \`path\`, explicitly pass \`"."\`.

Example: Searching for all .ts files in the current directory
{ "path": ".", "regex": ".*", "file_pattern": "*.ts" }

Example: Searching for function definitions in JavaScript files
{ "path": "src", "regex": "function\\s+\\w+", "file_pattern": "*.js" }

Example: Semantic search in CangjieCorpus documentation
{ "path": "<cangjie_corpus_root>", "regex": ".*", "semantic_query": "如何使用 HashMap 遍历键值对" }`

const PATH_PARAMETER_DESCRIPTION = `Directory to search recursively, relative to the workspace`

const REGEX_PARAMETER_DESCRIPTION = `Rust-compatible regular expression pattern to match`

const FILE_PATTERN_PARAMETER_DESCRIPTION = `Optional glob to limit which files are searched (e.g., *.ts)`

const SEMANTIC_QUERY_PARAMETER_DESCRIPTION = `Optional natural language query for semantic search in CangjieCorpus. When set, uses keyword-ranked matching instead of regex for the bundled corpus path.`

export default {
	type: "function",
	function: {
		name: "search_files",
		description: SEARCH_FILES_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				path: {
					type: "string",
					description: PATH_PARAMETER_DESCRIPTION,
				},
				regex: {
					type: "string",
					description: REGEX_PARAMETER_DESCRIPTION,
				},
				file_pattern: {
					type: ["string", "null"],
					description: FILE_PATTERN_PARAMETER_DESCRIPTION,
				},
				semantic_query: {
					type: ["string", "null"],
					description: SEMANTIC_QUERY_PARAMETER_DESCRIPTION,
				},
			},
			required: ["path", "regex"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
