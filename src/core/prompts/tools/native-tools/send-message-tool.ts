import type OpenAI from "openai"

const SEND_MESSAGE_TOOL_DESCRIPTION = `Send a message to another active agent/task in the task hierarchy.

Use this tool to communicate with parent, child, or sibling tasks. Messages are delivered asynchronously via the target task's message queue and will be processed when the target task handles its next turn.

Constraints:
- Can only send messages to tasks that are active (not completed or aborted)
- Can only send messages to related tasks (parent, child, or sibling in the task hierarchy)
- Cannot send messages to yourself

Use cases:
- Report progress or results back to a parent task
- Send instructions or data to a child sub-agent
- Coordinate with sibling tasks working on related subtasks`

const TARGET_TASK_ID_DESCRIPTION = `The task ID of the target agent/task to send the message to. This must be an active task in the current task stack. You can find task IDs from the agent tool's response when creating sub-agents, or from your own parentTaskId context.`

const MESSAGE_DESCRIPTION = `The message content to send to the target task. Be clear and include all necessary context since the target task may have a different conversation history (especially for forked agents).`

export default {
	type: "function",
	function: {
		name: "send_message",
		description: SEND_MESSAGE_TOOL_DESCRIPTION,
		strict: true,
		parameters: {
			type: "object",
			properties: {
				targetTaskId: {
					type: "string",
					description: TARGET_TASK_ID_DESCRIPTION,
				},
				message: {
					type: "string",
					description: MESSAGE_DESCRIPTION,
				},
			},
			required: ["targetTaskId", "message"],
			additionalProperties: false,
		},
	},
} satisfies OpenAI.Chat.ChatCompletionTool
