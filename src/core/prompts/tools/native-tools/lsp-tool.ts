import type OpenAI from "openai"

const LSP_TOOL_DESCRIPTION = `Query language server (LSP) for code intelligence. Supports:
- "definition": Go to definition of a symbol at a given position.
- "references": Find all references to a symbol at a given position.
- "hover": Get hover/type information for a symbol at a given position.
- "symbols": Search workspace symbols by name.
- "implementations": Find implementations of an interface/abstract at a given position.

Requires a running language server for the target language. Line and character are 1-based.

Parameters:
- action: The LSP action to perform.
- filePath: Path to the file (relative to workspace root).
- line: (Required for definition/references/hover/implementations) 1-based line number.
- character: (Required for definition/references/hover/implementations) 1-based column number.
- symbolName: (Required for symbols) The symbol name to search for in the workspace.

Example: Go to definition
{ "action": "definition", "filePath": "src/index.ts", "line": 10, "character": 5 }

Example: Find references
{ "action": "references", "filePath": "src/utils.ts", "line": 25, "character": 12 }

Example: Hover info
{ "action": "hover", "filePath": "src/main.ts", "line": 3, "character": 8 }

Example: Workspace symbol search
{ "action": "symbols", "filePath": ".", "symbolName": "MyClass" }

Example: Find implementations
{ "action": "implementations", "filePath": "src/types.ts", "line": 15, "character": 10 }`

export default {
	type: "function",
	function: {
		name: "lsp",
		description: LSP_TOOL_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				action: {
					type: "string",
					enum: ["definition", "references", "hover", "symbols", "implementations"],
					description:
						'The LSP action to perform: "definition", "references", "hover", "symbols", or "implementations".',
				},
				filePath: {
					type: "string",
					description: "Path to the file, relative to the workspace root.",
				},
				line: {
					type: ["integer", "null"],
					description:
						"1-based line number. Required for definition, references, hover, and implementations.",
				},
				character: {
					type: ["integer", "null"],
					description:
						"1-based column number. Required for definition, references, hover, and implementations.",
				},
				symbolName: {
					type: ["string", "null"],
					description: 'Symbol name to search for. Required for "symbols" action.',
				},
			},
			required: ["action", "filePath", "line", "character", "symbolName"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
