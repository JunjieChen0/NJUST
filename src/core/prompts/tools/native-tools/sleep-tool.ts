import type OpenAI from "openai"

const SLEEP_TOOL_DESCRIPTION = `Wait for a specified number of seconds before proceeding. Use when you need to introduce a delay, such as waiting for a process to complete, rate limiting, or polling with intervals.

Parameters:
- seconds: (required) Number of seconds to wait. Must be a non-negative number. Maximum: 300 seconds (5 minutes).

Example: Wait for 5 seconds
{ "seconds": 5 }

Example: Wait for 30 seconds before polling
{ "seconds": 30 }`

const SECONDS_PARAMETER_DESCRIPTION = `Number of seconds to wait (0-300). Values above 300 will be clamped to 300.`

export default {
	type: "function",
	function: {
		name: "sleep",
		description: SLEEP_TOOL_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				seconds: {
					type: "number",
					description: SECONDS_PARAMETER_DESCRIPTION,
				},
			},
			required: ["seconds"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
