/**
 * Sanitizes XML-style tool call markup that some models output in text content
 * instead of using native function calling (OpenAI tool_calls API).
 *
 * This module detects and strips such patterns to prevent:
 *   1. XML tags leaking into the DOM as visible HTML elements
 *   2. "Model response incomplete" errors (MODEL_NO_TOOLS_USED)
 *
 * It can also PARSE XML tool calls into native ToolUse objects so the tool
 * execution pipeline can handle them transparently.
 *
 * The sanitization handles both complete and partial (streaming) XML tool calls.
 */

import type { ToolName } from "@njust-ai/types"
import { toolNames } from "@njust-ai/types"
import type { ToolUse } from "../../shared/tools"
import { resolveToolAlias } from "../prompts/tools/filter-tools-for-mode"
import { NativeToolCallParser } from "./NativeToolCallParser"

/**
 * Regex patterns for detecting XML tool call markup.
 * Uses new RegExp constructor to avoid issues with angle brackets in source.
 */
const XML_TOOL_CALL_DETECT_RE = new RegExp(
	[
		"<\\/?tool_call\\s*>",
		"<\\/?function\\s*=\\s*\\w+\\s*>",
		"<\\/?function\\s*>",
		"<\\/?parameter\\s*=\\s*\\w+\\s*>",
		"<\\/?parameter\\s*>",
	].join("|"),
	"g",
)

/**
 * Matches a complete XML tool call block including all inner content.
 * From opening tool_call tag to closing tool_call tag.
 */
const XML_TOOL_CALL_BLOCK_RE = new RegExp("<tool_call\\s*>[\\s\\S]*?<\\/tool_call\\s*>", "g")

/**
 * Matches partial (incomplete, streaming) XML tool call content that starts
 * with an opening tag but has no closing tag yet.
 */
const XML_TOOL_CALL_PARTIAL_RE = new RegExp("<tool_call\\s*>[\\s\\S]*$", "g")

export interface SanitizeResult {
	/** The cleaned content with XML tool call markup removed. */
	content: string
	/** Whether any XML tool call markup was detected and stripped. */
	hadXmlToolCalls: boolean
}

/**
 * Detect and strip XML-style tool call markup from text content.
 *
 * Handles three cases:
 * 1. Complete tool call blocks (opening tag through closing tag) - removed entirely
 * 2. Partial streaming tool calls (opening tag, no closing tag) - removed entirely
 * 3. Individual function/parameter tags - removed
 *
 * @param content - The text content to sanitize
 * @returns Object with cleaned content and whether XML tool calls were found
 */
export function sanitizeXmlToolCalls(content: string): SanitizeResult {
	if (!content) {
		return { content, hadXmlToolCalls: false }
	}

	// Quick check: does the content contain any XML tool call patterns?
	if (!XML_TOOL_CALL_DETECT_RE.test(content)) {
		return { content, hadXmlToolCalls: false }
	}

	// Reset lastIndex since we reuse the same regex
	XML_TOOL_CALL_DETECT_RE.lastIndex = 0

	let cleaned = content

	// Step 1: Remove complete tool call blocks
	cleaned = cleaned.replace(XML_TOOL_CALL_BLOCK_RE, "")

	// Step 2: Remove partial/streaming tool calls (opening tag without closing)
	cleaned = cleaned.replace(XML_TOOL_CALL_PARTIAL_RE, "")

	// Step 3: Remove any remaining individual XML tool-related tags
	cleaned = cleaned.replace(XML_TOOL_CALL_DETECT_RE, "")

	// Clean up excess whitespace left after stripping
	cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim()

	return {
		content: cleaned,
		hadXmlToolCalls: true,
	}
}

// ── XML Tool Call Parsing ────────────────────────────────────────────────

/**
 * Regex for extracting complete tool_call blocks (non-greedy, captures inner body).
 * Separate instance from the sanitization regex to avoid lastIndex interference.
 */
const XML_BLOCK_EXTRACT_RE = new RegExp("<tool_call\\s*>([\\s\\S]*?)<\\/tool_call\\s*>", "g")

/**
 * Extracts the function name from the inner body of a tool_call block.
 * Matches patterns like: function="execute_command" or function=execute_command
 */
const FUNC_NAME_RE = new RegExp('<function\\s*=\\s*"?(\\w+)"?\\s*>')

/**
 * Extracts all parameter name-value pairs from the inner body.
 * Matches patterns like: parameter="command" ... value ... /parameter
 */
const PARAM_RE = new RegExp('<parameter\\s*=\\s*"?(\\w+)"?\\s*>([\\s\\S]*?)<\\/parameter\\s*>', "g")

/** A tool call parsed from XML markup. */
export interface ParsedXmlToolCall {
	name: string
	args: Record<string, string>
}

export interface ParseXmlResult {
	content: string
	parsedToolCalls: ToolUse[]
	hadXmlToolCalls: boolean
}

/** Counter for generating unique IDs for XML-converted tool calls. */
let xmlToolCallIdCounter = 0

/**
 * Extract raw tool call data (name + params) from the inner body of a
 * tool_call XML block.
 */
function extractRawToolCall(body: string): ParsedXmlToolCall | null {
	const funcMatch = FUNC_NAME_RE.exec(body)
	if (!funcMatch) return null

	const name = funcMatch[1]
	if (!name) return null

	const args: Record<string, string> = {}
	PARAM_RE.lastIndex = 0
	let paramMatch: RegExpExecArray | null
	while ((paramMatch = PARAM_RE.exec(body)) !== null) {
		if (paramMatch[1] && paramMatch[2] !== undefined) {
			args[paramMatch[1]] = paramMatch[2]
		}
	}

	return { name, args }
}

/**
 * Parse XML tool call markup into native ToolUse objects that the existing
 * tool execution pipeline can handle transparently.
 *
 * This function:
 * 1. Finds complete tool_call blocks in the content
 * 2. Extracts tool name and parameters from each block
 * 3. Converts each to a ToolUse via NativeToolCallParser.parseToolCall()
 *    (which handles alias resolution, type coercion, and validation)
 * 4. Returns cleaned content and the resulting ToolUse array
 *
 * @param content - The text content potentially containing XML tool call markup
 * @returns Cleaned content and an array of ToolUse objects ready for execution
 */
export function parseXmlToolCalls(content: string): ParseXmlResult {
	if (!content) {
		return { content, parsedToolCalls: [], hadXmlToolCalls: false }
	}

	XML_BLOCK_EXTRACT_RE.lastIndex = 0
	if (!XML_BLOCK_EXTRACT_RE.test(content)) {
		return { content, parsedToolCalls: [], hadXmlToolCalls: false }
	}

	XML_BLOCK_EXTRACT_RE.lastIndex = 0

	const toolCalls: ToolUse[] = []
	let cleaned = content

	let blockMatch: RegExpExecArray | null
	while ((blockMatch = XML_BLOCK_EXTRACT_RE.exec(content)) !== null) {
		const body = blockMatch[1]
		if (!body) continue
		const raw = extractRawToolCall(body)
		if (!raw) continue

		// Resolve tool alias to canonical name for validation
		const resolvedName = resolveToolAlias(raw.name) as ToolName
		if (!toolNames.includes(resolvedName)) continue

		// Build JSON arguments string for NativeToolCallParser
		const argsJson = JSON.stringify(raw.args)
		const id = "xmltc_" + Date.now() + "_" + ++xmlToolCallIdCounter

		// Delegate to NativeToolCallParser for full validation, type coercion,
		// parameter alias remapping, and nativeArgs construction.
		const toolUse = NativeToolCallParser.parseToolCall({
			id,
			name: resolvedName,
			arguments: argsJson,
		})

		if (toolUse && toolUse.type === "tool_use") {
			// parseToolCall does not propagate the id field — set it manually.
			;(toolUse as ToolUse).id = id
			toolCalls.push(toolUse as ToolUse)
		}
	}

	// Remove complete tool_call blocks from content
	cleaned = cleaned.replace(XML_TOOL_CALL_BLOCK_RE, "")
	// Remove any remaining individual tags
	cleaned = cleaned.replace(XML_TOOL_CALL_DETECT_RE, "")
	cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim()

	return {
		content: cleaned,
		parsedToolCalls: toolCalls,
		hadXmlToolCalls: true,
	}
}
