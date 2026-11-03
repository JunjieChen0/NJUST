import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ClineMessage } from "@njust-ai/types"
import { CompletionResultRow } from "../CompletionResultRow"
import { isLatestVerificationMessage } from "../VerificationCard"

vi.mock("../../Markdown", () => ({ Markdown: ({ markdown }: { markdown: string }) => <p>{markdown}</p> }))
vi.mock("../../OpenMarkdownPreviewButton", () => ({ OpenMarkdownPreviewButton: () => null }))

describe("completion result compatibility", () => {
	it.each([false, true])("renders old messages without a verification card (Cloud Agent: %s)", (isCloudAgentUi) => {
		const message: ClineMessage = {
			id: "m",
			ts: 1,
			type: "say",
			say: "completion_result",
			text: "Existing delivery",
		}
		render(
			<CompletionResultRow
				message={message}
				clineMessages={[message]}
				isCloudAgentUi={isCloudAgentUi}
				icon={null}
				title="Done"
			/>,
		)
		expect(screen.getByText("Existing delivery")).toBeInTheDocument()
		expect(screen.queryByLabelText("chat:verification.title")).toBeNull()
	})
	it("does not call an older verified card latest after a new plain delivery", () => {
		const first: ClineMessage = {
			id: "first",
			ts: 1,
			type: "say",
			say: "completion_result",
			verification: {
				overall: "verified",
				build: { state: "passed" },
				test: { state: "passed" },
				acceptance: "pending",
				claimId: "first",
			},
		}
		const second: ClineMessage = { id: "second", ts: 2, type: "say", say: "completion_result", text: "new" }
		expect(isLatestVerificationMessage(first, [first, second])).toBe(false)
	})
})
