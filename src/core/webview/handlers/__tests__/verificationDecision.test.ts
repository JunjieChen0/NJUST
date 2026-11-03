import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { MessageRouter } from "../MessageRouter"
import { registerTaskHandlers } from "../taskMessageHandler"

describe("verification decisions", () => {
	let task: any
	let context: any
	let router: MessageRouter
	beforeEach(() => {
		task = {
			clineMessages: [
				{
					id: "m",
					ts: 1,
					type: "say",
					say: "completion_result",
					verification: { claimId: "claim", acceptance: "pending" },
				},
			],
			cangjieVerification: { recordAcceptance: vi.fn().mockResolvedValue("recorded") },
			refreshVerificationSummary: vi.fn(),
			persistMemrlEpisode: vi.fn(),
		}
		context = { provider: { getCurrentTask: () => task } }
		router = new MessageRouter()
		registerTaskHandlers(router)
	})
	it("records an explicit decision and refreshes the delivery card", async () => {
		await router.route(context, {
			type: "verificationDecision",
			verificationDecision: { ts: 1, decision: "accepted" },
		})
		expect(task.cangjieVerification.recordAcceptance).toHaveBeenCalledWith("accepted", "claim")
		expect(task.refreshVerificationSummary).toHaveBeenCalledOnce()
		expect(task.persistMemrlEpisode).toHaveBeenCalledWith("decision")
	})
	it("warns when a delivery was superseded and still refreshes the card", async () => {
		const warn = vi.spyOn(vscode.window, "showWarningMessage").mockResolvedValue(undefined)
		task.cangjieVerification.recordAcceptance.mockResolvedValue("superseded")
		await router.route(context, {
			type: "verificationDecision",
			verificationDecision: { ts: 1, decision: "accepted" },
		})
		expect(warn).toHaveBeenCalled()
		expect(task.refreshVerificationSummary).toHaveBeenCalledOnce()
	})
	it("ignores old deliveries and malformed decisions", async () => {
		task.clineMessages.push({ ...task.clineMessages[0], ts: 2, verification: { claimId: "new" } })
		await router.route(context, {
			type: "verificationDecision",
			verificationDecision: { ts: 1, decision: "accepted" },
		})
		await router.route(context, {
			type: "verificationDecision",
			verificationDecision: { ts: 2, decision: "invalid" } as any,
		})
		expect(task.cangjieVerification.recordAcceptance).not.toHaveBeenCalled()
	})
	it("ignores an old card when a newer delivery has no verification card", async () => {
		task.clineMessages.push({ id: "new", ts: 2, type: "say", say: "completion_result", text: "new completion" })
		await router.route(context, {
			type: "verificationDecision",
			verificationDecision: { ts: 1, decision: "accepted", claimId: "claim" },
		})
		expect(task.cangjieVerification.recordAcceptance).not.toHaveBeenCalled()
	})
	it("rejects a different claim even if two messages have the same timestamp", async () => {
		await router.route(context, {
			type: "verificationDecision",
			verificationDecision: { ts: 1, decision: "accepted", claimId: "old-claim" },
		})
		expect(task.cangjieVerification.recordAcceptance).not.toHaveBeenCalled()
	})
})
