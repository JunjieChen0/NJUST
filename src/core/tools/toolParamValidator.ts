/**
 * Tool Parameter Validator
 *
 * Provides runtime validation of tool call parameters using zod schemas.
 * When a model emits a tool call with invalid or missing arguments, this
 * layer catches the error early — before the tool executes — and produces
 * a clear error message that can be fed back to the model for self-correction.
 *
 * Only the most commonly used (and error-prone) tools are covered here.
 * Unregistered tools pass through without validation.
 *
 * **Aliases:** Some tool names are aliases of canonical tools (see TOOL_ALIASES).
 * Validation resolves *safe* aliases (same parameter shape) to the canonical schema.
 * `edit_file` is NOT aliased to `edit` (different optional fields).
 */
import { z } from "zod"

import {
	optionalBooleanCoerced,
	optionalNumberOrNumericString,
	optionalPositiveIntCoerced,
} from "./toolParamZodHelpers"

const pathSchema = z.string().min(1, "path must not be empty")

const toolSchemas = {
	read_file: z.object({
		path: pathSchema,
		offset: optionalPositiveIntCoerced,
		limit: optionalPositiveIntCoerced,
		start_line: optionalPositiveIntCoerced,
		end_line: optionalPositiveIntCoerced,
	}),

	write_to_file: z.object({
		path: pathSchema,
		content: z.string(),
	}),

	apply_diff: z.object({
		path: pathSchema,
		diff: z.string().min(1, "diff must not be empty"),
	}),

	apply_patch: z.object({
		patch: z.string().min(1, "patch must not be empty"),
	}),

	edit: z.object({
		file_path: pathSchema,
		old_string: z.string(),
		new_string: z.string(),
		replace_all: optionalBooleanCoerced,
	}),

	/** Distinct from `edit`: uses expected_replacements, not replace_all. */
	edit_file: z.object({
		file_path: pathSchema,
		old_string: z.string(),
		new_string: z.string(),
		expected_replacements: optionalPositiveIntCoerced,
	}),

	search_and_replace: z.object({
		file_path: pathSchema,
		old_string: z.string(),
		new_string: z.string(),
		replace_all: optionalBooleanCoerced,
	}),

	execute_command: z.object({
		command: z.string().min(1, "command must not be empty"),
		cwd: z.string().optional().nullable(),
		timeout: optionalNumberOrNumericString,
	}),

	search_files: z.object({
		path: pathSchema,
		regex: z.string().min(1, "regex must not be empty"),
		file_pattern: z.string().optional().nullable(),
	}),

	list_files: z.object({
		path: pathSchema,
		recursive: z.union([z.boolean(), z.string()]).optional(),
	}),

	use_mcp_tool: z.object({
		server_name: z.string().min(1, "server_name must not be empty"),
		tool_name: z.string().min(1, "tool_name must not be empty"),
		arguments: z.record(z.unknown()).optional(),
	}),

	new_task: z.object({
		mode: z.string().min(1, "mode must not be empty"),
		message: z.string().min(1, "message must not be empty"),
	}),

	switch_mode: z.object({
		mode_slug: z.string().min(1, "mode_slug must not be empty"),
		reason: z.string().optional(),
	}),

	codebase_search: z.object({
		query: z.string().min(1, "query must not be empty"),
		path: z.string().optional(),
	}),

	web_search: z.object({
		search_query: z.string().min(1, "search_query must not be empty"),
		count: optionalPositiveIntCoerced,
	}),

	web_fetch: z.object({
		url: z.string().url("url must be a valid URL"),
	}),

	ask_followup_question: z.object({
		question: z.string().min(1, "question must not be empty"),
	}),

	attempt_completion: z.object({
		result: z.string().min(1, "result must not be empty"),
	}),
} as const satisfies Record<string, z.ZodTypeAny>

type ValidatableToolName = keyof typeof toolSchemas

/**
 * Map alias tool names to a schema key when parameter shapes match.
 * Do not add `edit_file`→`edit` here (different fields).
 */
const VALIDATION_SCHEMA_BY_ALIAS: Partial<Record<string, ValidatableToolName>> = {
	write_file: "write_to_file",
	search_replace: "edit",
	search_and_replace: "edit",
}

function resolveValidationSchemaKey(toolName: string): ValidatableToolName | undefined {
	if (toolName in toolSchemas) {
		return toolName as ValidatableToolName
	}
	return VALIDATION_SCHEMA_BY_ALIAS[toolName]
}

export interface ToolValidationResult {
	valid: boolean
	/** Human-readable error for feeding back to the model. */
	error?: string
}

/**
 * Validate the arguments for a named tool.
 * Returns `{ valid: true }` for tools without a registered schema (pass-through).
 */
export function validateToolParams(toolName: string, params: Record<string, unknown>): ToolValidationResult {
	const schemaKey = resolveValidationSchemaKey(toolName)
	const schema = schemaKey ? toolSchemas[schemaKey] : undefined
	if (!schema) {
		return { valid: true }
	}

	const result = schema.safeParse(params)
	if (result.success) {
		return { valid: true }
	}

	const issues = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
	return {
		valid: false,
		error: `Invalid parameters for tool "${toolName}": ${issues}`,
	}
}

/**
 * Returns the list of tool names that have registered validation schemas.
 */
export function getValidatableToolNames(): string[] {
	return Object.keys(toolSchemas)
}
