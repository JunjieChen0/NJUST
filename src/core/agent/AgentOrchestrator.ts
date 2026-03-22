import { v7 as uuidv7 } from "uuid"
import * as vscode from "vscode"
import EventEmitter from "events"

import type { ClineProvider } from "../webview/ClineProvider"
import type { Task } from "../task/Task"
import type { SharedContext, AgentInfo } from "./types"

interface ParallelTaskSpec {
	mode: string
	message: string
	dependencies?: string[]
}

interface ParallelTaskResult {
	agentId: string
	taskId: string
	mode: string
	status: "completed" | "failed"
	result?: string
	error?: string
}

type OrchestratorEvents = {
	agentStarted: [agent: AgentInfo]
	agentCompleted: [agent: AgentInfo, result: string]
	agentFailed: [agent: AgentInfo, error: string]
	allCompleted: [results: ParallelTaskResult[]]
}

/**
 * AgentOrchestrator manages parallel task execution, enabling multiple
 * Agent instances to run concurrently while sharing context.
 *
 * It extends the existing single-task ClineProvider model by maintaining
 * a separate pool of background tasks that don't interfere with the
 * main task stack.
 */
export class AgentOrchestrator extends EventEmitter<OrchestratorEvents> {
	private agents: Map<string, AgentInfo> = new Map()
	private sharedContext: SharedContext
	private activeTasks: Map<string, Task> = new Map()

	constructor(
		private readonly provider: ClineProvider,
		private readonly outputChannel: vscode.OutputChannel,
	) {
		super()
		this.sharedContext = {
			id: uuidv7(),
			modifiedFiles: new Set(),
			results: new Map(),
			metadata: new Map(),
		}
	}

	/**
	 * Run multiple tasks in parallel, each in its own mode.
	 * Returns when all tasks have completed (or failed).
	 */
	async runParallel(specs: ParallelTaskSpec[]): Promise<ParallelTaskResult[]> {
		this.outputChannel.appendLine(
			`[AgentOrchestrator] Starting ${specs.length} parallel tasks`,
		)

		const independentSpecs = specs.filter((s) => !s.dependencies?.length)
		const dependentSpecs = specs.filter((s) => s.dependencies?.length)

		const independentResults = await this.runBatch(independentSpecs)

		const allResults = [...independentResults]

		if (dependentSpecs.length > 0) {
			const completedIds = new Set(
				independentResults.filter((r) => r.status === "completed").map((r) => r.agentId),
			)

			const readyDependents = dependentSpecs.filter((s) =>
				s.dependencies!.every((dep) => completedIds.has(dep)),
			)

			if (readyDependents.length > 0) {
				const depResults = await this.runBatch(readyDependents)
				allResults.push(...depResults)
			}
		}

		this.emit("allCompleted", allResults)
		this.outputChannel.appendLine(
			`[AgentOrchestrator] All parallel tasks completed. ` +
				`Success: ${allResults.filter((r) => r.status === "completed").length}, ` +
				`Failed: ${allResults.filter((r) => r.status === "failed").length}`,
		)

		return allResults
	}

	private async runBatch(specs: ParallelTaskSpec[]): Promise<ParallelTaskResult[]> {
		const promises = specs.map((spec) => this.runSingleAgent(spec))
		const settled = await Promise.allSettled(promises)

		return settled.map((result, i) => {
			if (result.status === "fulfilled") {
				return result.value
			}
			return {
				agentId: `failed-${i}`,
				taskId: "",
				mode: specs[i].mode,
				status: "failed" as const,
				error: result.reason instanceof Error ? result.reason.message : String(result.reason),
			}
		})
	}

	private async runSingleAgent(spec: ParallelTaskSpec): Promise<ParallelTaskResult> {
		const agentId = uuidv7()
		const agent: AgentInfo = {
			id: agentId,
			taskId: "",
			mode: spec.mode,
			status: "running",
			description: spec.message.slice(0, 100),
			startedAt: Date.now(),
		}

		this.agents.set(agentId, agent)
		this.emit("agentStarted", agent)

		try {
			const contextPrefix = this.buildSharedContextPrompt()
			const fullMessage = contextPrefix
				? `${contextPrefix}\n\nTask:\n${spec.message}`
				: spec.message

			await this.provider.handleModeSwitch(spec.mode as any)
			const task = await this.provider.createTask(fullMessage)

			agent.taskId = task.taskId
			this.activeTasks.set(agentId, task)

			const result = await this.waitForCompletion(task)

			agent.status = "completed"
			agent.completedAt = Date.now()
			this.sharedContext.results.set(agentId, result)

			this.emit("agentCompleted", agent, result)

			const taskResult: ParallelTaskResult = {
				agentId,
				taskId: task.taskId,
				mode: spec.mode,
				status: "completed",
				result,
			}

			this.activeTasks.delete(agentId)
			return taskResult
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error)
			agent.status = "failed"
			agent.completedAt = Date.now()

			this.emit("agentFailed", agent, errorMsg)
			this.activeTasks.delete(agentId)

			return {
				agentId,
				taskId: agent.taskId,
				mode: spec.mode,
				status: "failed",
				error: errorMsg,
			}
		}
	}

	private waitForCompletion(task: any): Promise<string> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				reject(new Error("Agent task timed out after 10 minutes"))
			}, 10 * 60 * 1000)

			const poll = setInterval(() => {
				try {
					const messages = task.clineMessages || []
					const lastMsg = messages[messages.length - 1]

					if (lastMsg?.type === "say" && lastMsg.say === "completion_result") {
						clearInterval(poll)
						clearTimeout(timeout)
						resolve(lastMsg.text || "Completed")
					}

					if (task.didFinishAbortingStream || task.abandoned) {
						clearInterval(poll)
						clearTimeout(timeout)

						const errorMsg = messages.find(
							(m: any) => m.type === "say" && m.say === "error",
						)
						if (errorMsg) {
							reject(new Error(errorMsg.text || "Task failed"))
						} else {
							resolve("Completed (no explicit result)")
						}
					}
				} catch (e) {
					clearInterval(poll)
					clearTimeout(timeout)
					reject(e)
				}
			}, 500)
		})
	}

	private buildSharedContextPrompt(): string {
		const parts: string[] = []

		if (this.sharedContext.modifiedFiles.size > 0) {
			parts.push(
				`Files modified by other agents:\n${Array.from(this.sharedContext.modifiedFiles).join("\n")}`,
			)
		}

		if (this.sharedContext.results.size > 0) {
			parts.push("Results from other agents:")
			for (const [id, result] of this.sharedContext.results) {
				const agent = this.agents.get(id)
				const label = agent ? `${agent.mode} agent` : id
				parts.push(`- ${label}: ${result.slice(0, 200)}`)
			}
		}

		return parts.length > 0
			? `[Shared Context]\n${parts.join("\n\n")}\n[End Shared Context]`
			: ""
	}

	// Public API

	getSharedContext(): SharedContext {
		return this.sharedContext
	}

	addModifiedFile(filePath: string): void {
		this.sharedContext.modifiedFiles.add(filePath)
	}

	getActiveAgents(): AgentInfo[] {
		return Array.from(this.agents.values()).filter((a) => a.status === "running")
	}

	getAllAgents(): AgentInfo[] {
		return Array.from(this.agents.values())
	}

	async cancelAgent(agentId: string): Promise<void> {
		const task = this.activeTasks.get(agentId)
		if (task) {
			await (task as any).abortTask?.()
			this.activeTasks.delete(agentId)
		}

		const agent = this.agents.get(agentId)
		if (agent) {
			agent.status = "failed"
			agent.completedAt = Date.now()
		}
	}

	async cancelAll(): Promise<void> {
		for (const [agentId] of this.activeTasks) {
			await this.cancelAgent(agentId)
		}
	}

	resetContext(): void {
		this.sharedContext = {
			id: uuidv7(),
			modifiedFiles: new Set(),
			results: new Map(),
			metadata: new Map(),
		}
		this.agents.clear()
	}
}
