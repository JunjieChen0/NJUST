import { describe, expect, it, vi } from "vitest"
import { AskDispatcher } from "../ask-dispatcher.js"
import type { AskDispatcherOptions } from "../ask-dispatcher.js"
import { asMock } from "../../../../../src/__tests__/helpers/asMock.js"

describe("API retry confirmation", () => {
	it("declines manual retries in non-interactive mode instead of claiming a retry", async () => {
		const output = vi.fn()
		const sendMessage = vi.fn()
		const dispatcher = new AskDispatcher(
			asMock<AskDispatcherOptions>({
				outputManager: { output, markDisplayed: vi.fn() },
				promptManager: {},
				sendMessage,
				nonInteractive: true,
				exitOnError: false,
			}),
		)
		const result = await dispatcher.handleAsk({
			id: "failure",
			ts: 1,
			type: "ask",
			ask: "api_req_failed",
			text: "Unauthorized",
			partial: false,
		})
		expect(result.response).toBe("noButtonClicked")
		expect(sendMessage).toHaveBeenCalledWith({ type: "askResponse", askResponse: "noButtonClicked" })
		expect(output.mock.calls.flat().join(" ")).not.toContain("[retrying api request]")
	})
})
