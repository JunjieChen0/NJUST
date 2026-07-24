import { z } from "zod"

import { Task } from "../task/Task"
import { ignoreAbortError } from "../../utils/errorHandling"
import { formatResponse } from "../prompts/responses"
import { BaseTool, ToolCallbacks } from "./BaseTool"
import type { ToolUse } from "../../shared/tools"
import { SubAgentType, AGENT_TYPE_TOOLS } from "../task/SubTaskOptions"
import { getBuiltInAgent } from "../agent/builtInAgents"
import { resolveAgentTools } from "../agent/types"

/** Maximum number of concurrently active sub-agents. */
const MAX_CONCURRENT_AGENTS = 3
const REQUIRED_SUB_AGENT_TOOLS = ["attempt_completion"] as const

const AGENT_TYPES = [
	"explore",
	"implement",
	"verify",
	"CangjieExplore",
	"CangjieImplement",
	"CangjieVerify",
	"CangjieRepair",
	"custom",
] as const satisfies readonly SubAgentType[]

const LEGACY_AGENT_DEFINITIONS: Partial<Record<SubAgentType, string>> = {
	explore: "Explore",
	implement: "Implement",
	verify: "Verify",
	custom: "Custom",
}

export function resolveSubAgentTools(agentType: SubAgentType): string[] {
	const definitionType = LEGACY_AGENT_DEFINITIONS[agentType] ?? agentType
	const definition = getBuiltInAgent(definitionType)
	if (definition) {
		const tools = resolveAgentTools(definition)
		return tools.includes("*") ? [] : [...new Set([...tools, ...REQUIRED_SUB_AGENT_TOOLS])]
	}
	return [...new Set([...AGENT_TYPE_TOOLS[agentType], ...REQUIRED_SUB_AGENT_TOOLS])]
}

function resolveSubAgentInstructions(agentType: SubAgentType, taskDescription: string, mode: string): string | null {
	const definitionType = LEGACY_AGENT_DEFINITIONS[agentType] ?? agentType
	const definition = getBuiltInAgent(definitionType)
	if (!definition) return null
	return typeof definition.systemPrompt === "function"
		? definition.systemPrompt({ taskDescription, mode })
		: definition.systemPrompt
}

interface AgentToolParams {
	task: string
	agentType?: SubAgentType
	maxTurns?: number
}

export class AgentTool extends BaseTool<"agent"> {
	readonly name = "agent" as const

	override userFacingName(): string {
		return "Agent"
	}

	override get searchHint(): string {
		return "agent sub-agent spawn delegate fork"
	}

	protected override get inputSchema() {
		return z.object({
			task: z.string().min(1, "task is required"),
			agentType: z.enum(AGENT_TYPES).optional(),
			maxTurns: z.number().int().positive().optional(),
		})
	}

	async execute(params: AgentToolParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { task: taskDescription, agentType = "custom", maxTurns } = params
		const { askApproval, handleError, pushToolResult } = callbacks

		try {
			const host = task.providerRef.deref()

			if (!host) {
				pushToolResult(formatResponse.toolError("Provider reference lost"))
				return
			}

			// Concurrency limit: count active children in the task stack
			const taskStackSize = host.getTaskStackSize()
			// The stack includes the current task, so active children = stackSize - 1
			// (each delegation pushes a child). We check against MAX_CONCURRENT_AGENTS.
			if (taskStackSize > MAX_CONCURRENT_AGENTS) {
				pushToolResult(
					formatResponse.toolError(
						`Cannot create sub-agent: concurrent agent limit reached (${MAX_CONCURRENT_AGENTS}). ` +
							`Wait for an existing sub-agent to complete before spawning a new one.`,
					),
				)
				return
			}

			task.consecutiveMistakeCount = 0

			// Build the agent message with context about its type and constraints
			const allowedTools = resolveSubAgentTools(agentType)
			const toolSetDescription = agentType !== "custom" ? allowedTools.join(", ") : "inherited from parent"
			const modeSlug = await task.getTaskMode()
			const agentInstructions = resolveSubAgentInstructions(agentType, taskDescription, modeSlug)
			const maxTurnsNote = maxTurns
				? `\n\nIMPORTANT: You have a maximum of ${maxTurns} conversation turns to complete this task. Be efficient and focused.`
				: ""

			const agentMessage = [
				`[Sub-Agent Type: ${agentType}]`,
				`[Available Tools: ${toolSetDescription}]`,
				agentInstructions ? `[Agent Instructions]\n${agentInstructions}\n[End Agent Instructions]` : "",
				``,
				taskDescription,
				maxTurnsNote,
			].join("\n")

			// Build approval message
			const toolMessage = JSON.stringify({
				tool: "agent",
				agentType,
				content: taskDescription,
				maxTurns: maxTurns ?? null,
			})

			const isBuiltInCangjieDelegation = modeSlug === "cangjie" && agentType.startsWith("Cangjie")
			const didApprove = isBuiltInCangjieDelegation || (await askApproval("tool", toolMessage))

			if (!didApprove) {
				return
			}

			// Pause before publishing the result. Publishing can wake the stream
			// finalizer immediately, so setting this later leaves a race where the
			// parent starts another request while the child is being created.
			task.isPaused = true

			// Record a valid result before delegation flushes the parent's API history.
			// The child completion path replaces this placeholder in place.
			pushToolResult(`Delegated to sub-agent (${agentType}); awaiting completion.`)

			// Delegate using forked isolation level for independent context
			await host.delegateParentAndOpenChild({
				parentTaskId: task.taskId,
				message: agentMessage,
				initialTodos: [],
				mode: modeSlug,
				isolationLevel: "forked",
				allowedTools: agentType === "custom" ? undefined : allowedTools,
				agentType,
			})

			// Focusing the child prevents the normal presenter from advancing the
			// parent's streaming index. Wake the parent finalizer so it can observe
			// isPaused and stop without timing out into a second parent request.
			task.userMessageContentReady = true
			return
		} catch (error) {
			task.isPaused = false
			await handleError("creating sub-agent", error instanceof Error ? error : new Error(String(error)))
			return
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"agent">): Promise<void> {
		const taskDesc: string | undefined = block.params.task
		// agentType is not in ToolParamName, read from nativeArgs
		const nativeArgs = block.nativeArgs as AgentToolParams | undefined
		const agentType: string | undefined = nativeArgs?.agentType

		const partialMessage = JSON.stringify({
			tool: "agent",
			agentType: agentType ?? "custom",
			content: taskDesc ?? "",
		})

		await task.ask("tool", partialMessage, block.partial).catch(ignoreAbortError)
	}
}

export const agentTool = new AgentTool()
