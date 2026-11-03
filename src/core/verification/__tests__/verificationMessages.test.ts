import { describe, it, expect, vi } from "vitest"
import type { ClineMessage, VerificationSummary } from "@njust-ai/types"
import { refreshVerificationMessage } from "../verificationMessages"

const summary: VerificationSummary = {
	overall: "verified",
	acceptance: "pending",
	claimId: "claim",
	build: { state: "passed" },
	test: { state: "passed", executed: 1 },
}
describe("verification card updates", () => {
	it("replaces an unverifiable cached success with an unavailable-evidence card", async () => {
		const message: ClineMessage = { id: "m", ts: 1, type: "say", say: "completion_result", verification: summary }
		const unknown: VerificationSummary = {
			overall: "no_record",
			acceptance: "no_delivery",
			build: { state: "not_run" },
			test: { state: "not_run" },
			note: "record unavailable",
		}
		await refreshVerificationMessage({
			clineMessages: [message],
			currentSummary: async () => unknown,
			update: vi.fn(),
			save: vi.fn(),
		})
		expect(message.verification?.overall).toBe("no_record")
		expect(message.verification?.acceptance).toBe("no_delivery")
	})
	it("updates and persists the latest delivery after code changes", async () => {
		const first: ClineMessage = { id: "1", ts: 1, type: "say", say: "completion_result", verification: summary }
		const latest: ClineMessage = { ...first, id: "2", ts: 2 }
		const updated: VerificationSummary = {
			...summary,
			overall: "incomplete",
			build: { state: "stale", staleReason: "code_changed" },
		}
		const host = {
			clineMessages: [first, latest],
			currentSummary: vi.fn().mockResolvedValue(updated),
			update: vi.fn(),
			save: vi.fn(),
		}
		await refreshVerificationMessage(host)
		expect(first.verification).toBe(summary)
		expect(latest.verification?.build.state).toBe("stale")
		expect(host.update).toHaveBeenCalledWith(latest)
		expect(host.save).toHaveBeenCalledOnce()
	})
	it.each([undefined, { ...summary, claimId: "newer" }])(
		"does not overwrite an old delivery with a different or missing result",
		async (current) => {
			const host = {
				clineMessages: [
					{ id: "1", ts: 1, type: "say", say: "completion_result", verification: summary },
				] as ClineMessage[],
				currentSummary: vi.fn().mockResolvedValue(current),
				update: vi.fn(),
				save: vi.fn(),
			}
			await refreshVerificationMessage(host)
			expect(host.update).not.toHaveBeenCalled()
		},
	)
})
