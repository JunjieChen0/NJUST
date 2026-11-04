import { describe, it, expect, vi } from "vitest"
import { Task } from "../Task"

describe("terminal verification summaries", () => {
	it.each(["abandoned", "taskCompleted"])("does not recheck or append cancellation facts when %s", async (flag) => {
		const host: any = {
			[flag]: true,
			cangjieVerification: { cancelAndWait: vi.fn(), currentSummary: vi.fn() },
			addToClineMessages: vi.fn(),
		}
		await Task.prototype.publishVerificationSummary.call(host, "cancelled")
		expect(host.cangjieVerification.cancelAndWait).not.toHaveBeenCalled()
		expect(host.cangjieVerification.currentSummary).not.toHaveBeenCalled()
		expect(host.addToClineMessages).not.toHaveBeenCalled()
	})
	it.each(["cancelled", "error"] as const)(
		"persists %s facts directly after checks settle, even after abort",
		async (terminal) => {
			const verification = {
				overall: "incomplete",
				build: { state: "cancelled" },
				test: { state: "not_run" },
				acceptance: "no_delivery",
			}
			const host: any = {
				abort: true,
				cangjieVerification: {
					cancelAndWait: vi.fn(),
					currentSummary: vi.fn().mockResolvedValue(verification),
				},
				addToClineMessages: vi.fn(),
			}
			await Task.prototype.publishVerificationSummary.call(host, terminal)
			expect(host.addToClineMessages).toHaveBeenCalledWith(
				expect.objectContaining({ say: "verification_summary", verification: { ...verification, terminal } }),
			)
			expect(host.cangjieVerification.cancelAndWait.mock.invocationCallOrder[0]).toBeLessThan(
				host.cangjieVerification.currentSummary.mock.invocationCallOrder[0],
			)
			await Task.prototype.publishVerificationSummary.call(host, terminal)
			expect(host.addToClineMessages).toHaveBeenCalledOnce()
		},
	)
	it("does not create a cancellation card without verification records", async () => {
		const host: any = {
			cangjieVerification: { cancelAndWait: vi.fn(), currentSummary: vi.fn().mockResolvedValue(undefined) },
			addToClineMessages: vi.fn(),
		}
		await Task.prototype.publishVerificationSummary.call(host, "cancelled")
		expect(host.addToClineMessages).not.toHaveBeenCalled()
	})

	it("makes a concurrent cancellation wait until the first summary is persisted", async () => {
		let release!: () => void
		const persisted = new Promise<void>((resolve) => {
			release = resolve
		})
		const host = {
			cangjieVerification: {
				cancelAndWait: vi.fn(),
				currentSummary: vi.fn().mockResolvedValue({ overall: "incomplete" }),
			},
			addToClineMessages: vi.fn().mockReturnValue(persisted),
		}
		const publish = () => Task.prototype.publishVerificationSummary.call(host, "cancelled")
		const first = publish()
		await vi.waitFor(() => expect(host.addToClineMessages).toHaveBeenCalledOnce())
		let secondFinished = false
		const second = publish().then(() => {
			secondFinished = true
		})
		try {
			await Promise.resolve()
			await Promise.resolve()
			expect(secondFinished).toBe(false)
			expect(host.addToClineMessages).toHaveBeenCalledOnce()
		} finally {
			release()
			await Promise.all([first, second])
		}
	})

	it("shares verification settlement between concurrent terminal summaries", async () => {
		let release!: () => void
		const settled = new Promise<void>((resolve) => {
			release = resolve
		})
		const host = {
			cangjieVerification: {
				cancelAndWait: vi.fn().mockReturnValue(settled),
				currentSummary: vi.fn().mockResolvedValue({ overall: "incomplete" }),
			},
			addToClineMessages: vi.fn(),
		}
		const publish = () => Task.prototype.publishVerificationSummary.call(host, "cancelled")
		const first = publish()
		const second = publish()
		try {
			expect(host.cangjieVerification.cancelAndWait).toHaveBeenCalledOnce()
		} finally {
			release()
			await Promise.all([first, second])
		}
		expect(host.addToClineMessages).toHaveBeenCalledOnce()
	})

	it("can publish later when an earlier check had no verification records", async () => {
		const host = {
			cangjieVerification: {
				cancelAndWait: vi.fn(),
				currentSummary: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue({ overall: "incomplete" }),
			},
			addToClineMessages: vi.fn(),
		}
		const publish = () => Task.prototype.publishVerificationSummary.call(host, "cancelled")
		await publish()
		expect(host.addToClineMessages).not.toHaveBeenCalled()
		await publish()
		expect(host.addToClineMessages).toHaveBeenCalledOnce()
	})
})
