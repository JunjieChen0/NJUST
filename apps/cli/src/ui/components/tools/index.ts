/**
 * Tool renderer components for CLI TUI
 *
 * Each tool type has a specialized renderer that optimizes the display
 * of its unique data structure.
 */

import type React from "react"

import type { ToolRendererProps } from "./types.ts"
import { getToolCategory } from "./types.ts"

// Import all renderers
import { FileReadTool } from "./FileReadTool.tsx"
import { FileWriteTool } from "./FileWriteTool.tsx"
import { SearchTool } from "./SearchTool.tsx"
import { CommandTool } from "./CommandTool.tsx"
import { ModeTool } from "./ModeTool.tsx"
import { CompletionTool } from "./CompletionTool.tsx"
import { GenericTool } from "./GenericTool.tsx"

// Re-export types
export type { ToolRendererProps } from "./types.ts"
export { getToolCategory } from "./types.ts"

// Re-export utilities
export * from "./utils.ts"

// Re-export individual components for direct usage
export { FileReadTool } from "./FileReadTool.tsx"
export { FileWriteTool } from "./FileWriteTool.tsx"
export { SearchTool } from "./SearchTool.tsx"
export { CommandTool } from "./CommandTool.tsx"
export { ModeTool } from "./ModeTool.tsx"
export { CompletionTool } from "./CompletionTool.tsx"
export { GenericTool } from "./GenericTool.tsx"

/**
 * Map of tool categories to their renderer components
 */
const CATEGORY_RENDERERS: Record<string, React.FC<ToolRendererProps>> = {
	"file-read": FileReadTool,
	"file-write": FileWriteTool,
	search: SearchTool,
	command: CommandTool,
	mode: ModeTool,
	completion: CompletionTool,
	other: GenericTool,
}

/**
 * Get the appropriate renderer component for a tool
 *
 * @param toolName - The tool name/identifier
 * @returns The renderer component for this tool type
 */
export function getToolRenderer(toolName: string): React.FC<ToolRendererProps> {
	const category = getToolCategory(toolName)
	return CATEGORY_RENDERERS[category] || GenericTool
}
