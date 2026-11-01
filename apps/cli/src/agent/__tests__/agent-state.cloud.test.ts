/**
 * The Cloud Agent orchestrator does not go through attempt_completion, so it
 * must end its runs with the same terminal asks the CLI looks for.
 * These sequences mirror what CloudAgentOrchestrator emits.
 */
import type { ClineMessage } from "@njust-ai/types"

import { AgentLoopState, detectAgentState } from "../agent-state.js"
import { taskCompleted } from "../events.js"

let ts = 1
const say = (sayType: ClineMessage["say"], text = ""): ClineMessage => ({
	id: `msg-${ts}`,
	ts: ts++,
	type: "say",
	say: sayType,
	text,
})
const ask = (askType: ClineMessage["ask"], text = ""): ClineMessage => ({
	id: `msg-${ts}`,
	ts: ts++,
	type: "ask",
	ask: askType,
	text,
})

/** api_req_started never gets a cost on the cloud path, so the CLI sees "streaming" until a terminal ask. */
const cloudRunBody = (): ClineMessage[] => [
	say("text", "do the thing"),
	say("api_req_started", JSON.stringify({ request: "Cloud Agent task submitted" })),
	say("text", "step 1 done"),
	say("api_req_finished", JSON.stringify({ tokensIn: 1, tokensOut: 2, cost: 0 })),
]

describe("CLI state for Cloud Agent runs", () => {
	it("is still streaming before the run reaches a terminal state", () => {
		const state = detectAgentState(cloudRunBody())
		expect(state.state).toBe(AgentLoopState.STREAMING)
		expect(state.isRunning).toBe(true)
	})

	it("detects completion after a successful cloud run", () => {
		const before = cloudRunBody()
		const after = [...before, say("completion_result", "Cloud Agent task completed."), ask("completion_result")]

		const state = detectAgentState(after)
		expect(state.state).toBe(AgentLoopState.IDLE)
		expect(state.isRunning).toBe(false)
		expect(state.requiredAction).toBe("start_task")
		expect(taskCompleted(detectAgentState(before), state)).toBe(true)
	})

	it("stops (without reporting completion) after a failed cloud run", () => {
		const before = cloudRunBody()
		const after = [
			...before,
			say("error", "Cloud Agent task failed."),
			ask("api_req_failed", "Cloud Agent task failed."),
		]

		const state = detectAgentState(after)
		expect(state.state).toBe(AgentLoopState.IDLE)
		expect(state.isRunning).toBe(false)
		expect(state.requiredAction).toBe("retry_or_new_task")
		expect(taskCompleted(detectAgentState(before), state)).toBe(false)
	})
})
