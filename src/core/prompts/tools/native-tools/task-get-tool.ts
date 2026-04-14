import type OpenAI from "openai"

const TASK_GET_DESCRIPTION = `Get detailed information about a specific task by its ID. Returns the full task including status, priority, description, dependencies, and timestamps.

Parameters:
- taskId: (required) The ID of the task to retrieve

Example: Get task details
{ "taskId": "abc-123" }`

const TASK_ID_DESCRIPTION = `The ID of the task to retrieve`

export default {
	type: "function",
	function: {
		name: "task_get",
		description: TASK_GET_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				taskId: {
					type: "string",
					description: TASK_ID_DESCRIPTION,
				},
			},
			required: ["taskId"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
