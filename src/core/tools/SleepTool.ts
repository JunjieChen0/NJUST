import { Task } from "../task/Task"
import { formatResponse } from "../prompts/responses"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface SleepParams {
	seconds: number
}

const MAX_SLEEP_SECONDS = 300

export class SleepTool extends BaseTool<"sleep"> {
	readonly name = "sleep" as const

	override isReadOnly(): boolean {
		return true
	}

	override isConcurrencySafe(): boolean {
		return true
	}

	override get shouldDefer(): boolean {
		return true
	}

	override userFacingName(): string {
		return "Sleep"
	}

	override get searchHint(): string {
		return "sleep wait delay pause timer"
	}

	async execute(params: SleepParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { pushToolResult, handleError } = callbacks

		try {
			const { seconds } = params

			if (seconds === undefined || seconds === null) {
				task.consecutiveMistakeCount++
				task.recordToolError("sleep")
				task.didToolFailInCurrentTurn = true
				pushToolResult(await task.sayAndCreateMissingParamError("sleep", "seconds"))
				return
			}

			if (typeof seconds !== "number" || isNaN(seconds) || seconds < 0) {
				pushToolResult(
					formatResponse.toolError("The 'seconds' parameter must be a non-negative number."),
				)
				return
			}

			const clampedSeconds = Math.min(seconds, MAX_SLEEP_SECONDS)

			await new Promise((resolve) => setTimeout(resolve, clampedSeconds * 1000))

			task.consecutiveMistakeCount = 0
			pushToolResult(`Waited for ${clampedSeconds} seconds.`)
		} catch (error) {
			await handleError("sleeping", error as Error)
		}
	}
}

export const sleepTool = new SleepTool()
