import type OpenAI from "openai"

const TASK_UPDATE_DESCRIPTION = `Update an existing task on the task board. Use to change status, title, description, or priority.

Parameters:
- taskId: (required) The ID of the task to update
- status: (optional) New status: "pending", "in_progress", "completed", or "failed"
- title: (optional) Updated title
- description: (optional) Updated description
- priority: (optional) Updated priority: "high", "medium", or "low"

Example: Mark a task as completed
{ "taskId": "abc-123", "status": "completed" }

Example: Update title and priority
{ "taskId": "abc-123", "title": "Implement login page v2", "priority": "high" }`

const TASK_ID_DESCRIPTION = `The ID of the task to update`
const STATUS_DESCRIPTION = `New status: pending, in_progress, completed, or failed`
const TITLE_DESCRIPTION = `Updated title for the task`
const DESCRIPTION_DESCRIPTION = `Updated description for the task`
const PRIORITY_DESCRIPTION = `Updated priority: high, medium, or low`

export default {
	type: "function",
	function: {
		name: "task_update",
		description: TASK_UPDATE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				taskId: {
					type: "string",
					description: TASK_ID_DESCRIPTION,
				},
				status: {
					type: ["string", "null"],
					enum: ["pending", "in_progress", "completed", "failed", null],
					description: STATUS_DESCRIPTION,
				},
				title: {
					type: ["string", "null"],
					description: TITLE_DESCRIPTION,
				},
				description: {
					type: ["string", "null"],
					description: DESCRIPTION_DESCRIPTION,
				},
				priority: {
					type: ["string", "null"],
					enum: ["high", "medium", "low", null],
					description: PRIORITY_DESCRIPTION,
				},
			},
			required: ["taskId"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
