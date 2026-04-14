import type OpenAI from "openai"

const TASK_OUTPUT_DESCRIPTION = `Read persisted output/messages for a task by task ID. Supports pagination for long histories.

Parameters:
- taskId: (required) The ID of the task
- offset: (optional) Zero-based starting index (default: 0)
- limit: (optional) Number of items to return (default: 50, max: 200)

Example:
{ "taskId": "abc-123", "offset": 0, "limit": 50 }`

export default {
	type: "function",
	function: {
		name: "task_output",
		description: TASK_OUTPUT_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				taskId: {
					type: "string",
					description: "The ID of the task to read output from",
				},
				offset: {
					type: "number",
					description: "Zero-based index offset",
				},
				limit: {
					type: "number",
					description: "Maximum number of output items to return",
				},
			},
			required: ["taskId"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
