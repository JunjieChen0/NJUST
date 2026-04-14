import type OpenAI from "openai"

const TASK_LIST_DESCRIPTION = `List tasks from the task board with optional filtering. Returns tasks sorted by most recently updated first.

Parameters:
- status: (optional) Filter by status: "pending", "in_progress", "completed", or "failed"
- priority: (optional) Filter by priority: "high", "medium", or "low"
- limit: (optional) Maximum number of tasks to return

Example: List all pending tasks
{ "status": "pending" }

Example: List high-priority in-progress tasks
{ "status": "in_progress", "priority": "high", "limit": 10 }`

const STATUS_DESCRIPTION = `Filter by status: pending, in_progress, completed, or failed`
const PRIORITY_DESCRIPTION = `Filter by priority: high, medium, or low`
const LIMIT_DESCRIPTION = `Maximum number of tasks to return`

export default {
	type: "function",
	function: {
		name: "task_list",
		description: TASK_LIST_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				status: {
					type: ["string", "null"],
					enum: ["pending", "in_progress", "completed", "failed", null],
					description: STATUS_DESCRIPTION,
				},
				priority: {
					type: ["string", "null"],
					enum: ["high", "medium", "low", null],
					description: PRIORITY_DESCRIPTION,
				},
				limit: {
					type: ["number", "null"],
					description: LIMIT_DESCRIPTION,
				},
			},
			required: [],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
