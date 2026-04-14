import type OpenAI from "openai"

const TASK_STOP_DESCRIPTION = `Stop a running task by task ID. Use this when a background/delegated task should be cancelled.

Parameters:
- taskId: (required) The ID of the task to stop
- reason: (optional) Brief reason for stopping the task

Example:
{ "taskId": "abc-123", "reason": "No longer needed" }`

export default {
	type: "function",
	function: {
		name: "task_stop",
		description: TASK_STOP_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				taskId: {
					type: "string",
					description: "The ID of the task to stop",
				},
				reason: {
					type: "string",
					description: "Optional reason for stopping the task",
				},
			},
			required: ["taskId"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
