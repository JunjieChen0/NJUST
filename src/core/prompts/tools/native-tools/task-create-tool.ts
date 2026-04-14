import type OpenAI from "openai"

const TASK_CREATE_DESCRIPTION = `Create a new task on the task board for tracking work items, sub-goals, or dependencies.

Parameters:
- title: (required) Short, descriptive title for the task
- description: (optional) Detailed description of what needs to be done
- priority: (optional) Priority level: "high", "medium", or "low". Defaults to "medium"
- dependsOn: (optional) Array of task IDs that must be completed before this task can start

Example: Create a simple task
{ "title": "Implement login page", "description": "Build the login form with email/password fields", "priority": "high" }

Example: Create a task with dependencies
{ "title": "Write integration tests", "dependsOn": ["abc-123", "def-456"] }`

const TITLE_DESCRIPTION = `Short, descriptive title for the task`
const DESCRIPTION_DESCRIPTION = `Detailed description of what needs to be done`
const PRIORITY_DESCRIPTION = `Priority level: high, medium, or low`
const DEPENDS_ON_DESCRIPTION = `Array of task IDs that must complete before this task can start`

export default {
	type: "function",
	function: {
		name: "task_create",
		description: TASK_CREATE_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				title: {
					type: "string",
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
				dependsOn: {
					type: ["array", "null"],
					items: { type: "string" },
					description: DEPENDS_ON_DESCRIPTION,
				},
			},
			required: ["title"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
