import { ApiMessage } from "../task-persistence/apiMessages"
import { applyToolResultBudget } from "./toolResultBudget"

export type MicrocompactOptions = {
	enabled?: boolean
}

/**
 * Zero-cost lightweight compaction executed every round before API call.
 * Current phase-A implementation focuses on large historical tool_result payloads.
 */
export function microcompactMessages(messages: ApiMessage[], opts?: MicrocompactOptions): ApiMessage[] {
	if (opts?.enabled === false || messages.length === 0) return messages
	return applyToolResultBudget(messages)
}
