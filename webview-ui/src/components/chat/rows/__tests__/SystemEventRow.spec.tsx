import React from "react"
import { vi, describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { SystemEventRow } from "../SystemEventRow"

// Mock child components to isolate SystemEventRow tests using correct relative paths from the test file:
vi.mock("../../ErrorRow", () => ({
	default: ({ type, message, title, errorDetails }: any) => (
		<div
			data-testid="error-row"
			data-type={type}
			data-title={title}
			data-message={message}
			data-details={errorDetails}>
			ErrorRow
		</div>
	),
}))

vi.mock("../../WarningRow", () => ({
	default: ({ title, message, actionText, onAction }: any) => (
		<div
			data-testid="warning-row"
			data-title={title}
			data-message={message}
			data-action={actionText}
			onClick={onAction}>
			WarningRow
		</div>
	),
}))

vi.mock("../../ReasoningBlock", () => ({
	ReasoningBlock: ({ content }: any) => (
		<div data-testid="reasoning-block" data-content={content}>
			ReasoningBlock
		</div>
	),
}))

vi.mock("../../checkpoints/CheckpointSaved", () => ({
	CheckpointSaved: ({ commitHash, currentHash }: any) => (
		<div data-testid="checkpoint-saved" data-commit={commitHash} data-current={currentHash}>
			CheckpointSaved
		</div>
	),
}))

vi.mock("../../CommandExecutionError", () => ({
	CommandExecutionError: () => <div data-testid="command-execution-error">CommandExecutionError</div>,
}))

vi.mock("../../UpdateTodoListToolBlock", () => ({
	default: ({ userEdited }: any) => (
		<div data-testid="update-todolist-toolblock" data-useredited={userEdited ? "true" : "false"}>
			UpdateTodoListToolBlock
		</div>
	),
}))

vi.mock("../../../common/ImageBlock", () => ({
	default: ({ imageUri, imagePath }: any) => (
		<div data-testid="image-block" data-uri={imageUri} data-path={imagePath}>
			ImageBlock
		</div>
	),
}))

vi.mock("../../AutoApprovedRequestLimitWarning", () => ({
	AutoApprovedRequestLimitWarning: ({ message }: any) => (
		<div data-testid="auto-approved-warning" data-message={JSON.stringify(message)}>
			AutoApprovedRequestLimitWarning
		</div>
	),
}))

vi.mock("../../context-management", () => ({
	InProgressRow: ({ eventType }: any) => (
		<div data-testid="inprogress-row" data-event={eventType}>
			InProgressRow
		</div>
	),
	CondensationResultRow: ({ data }: any) => (
		<div data-testid="condensation-result" data-data={JSON.stringify(data)}>
			CondensationResultRow
		</div>
	),
	CondensationErrorRow: ({ errorText }: any) => (
		<div data-testid="condensation-error" data-error={errorText}>
			CondensationErrorRow
		</div>
	),
	TruncationResultRow: ({ data }: any) => (
		<div data-testid="truncation-result" data-data={JSON.stringify(data)}>
			TruncationResultRow
		</div>
	),
}))

vi.mock("../../CommandExecution", () => ({
	CommandExecution: ({ executionId, text }: any) => (
		<div data-testid="command-execution" data-id={executionId} data-text={text}>
			CommandExecution
		</div>
	),
}))

vi.mock("../../Markdown", () => ({
	Markdown: ({ markdown, partial }: any) => (
		<div data-testid="markdown" data-markdown={markdown} data-partial={partial ? "true" : "false"}>
			Markdown
		</div>
	),
}))

describe("SystemEventRow", () => {
	const defaultProps = {
		icon: <span>Icon</span>,
		title: <span>Title</span>,
		isExpanded: false,
		onToggleExpand: () => {},
		isStreaming: false,
		isLast: false,
		clineMessages: [],
	}

	it("renders diff_error say message correctly", () => {
		const message: any = {
			id: "1",
			ts: 12345,
			type: "say",
			say: "diff_error",
			text: "diff failed",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("error-row")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-type")).toBe("diff_error")
		expect(row.getAttribute("data-message")).toBe("diff failed")
	})

	it("renders reasoning say message correctly", () => {
		const message: any = {
			id: "2",
			ts: 12345,
			type: "say",
			say: "reasoning",
			text: "thinking hard",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("reasoning-block")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-content")).toBe("thinking hard")
	})

	it("returns null for api_req_finished say message", () => {
		const message: any = {
			id: "3",
			ts: 12345,
			type: "say",
			say: "api_req_finished",
		}
		const { container } = render(<SystemEventRow {...defaultProps} message={message} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders MODEL_NO_TOOLS_USED error say message correctly", () => {
		const message: any = {
			id: "4",
			ts: 12345,
			type: "say",
			say: "error",
			text: "MODEL_NO_TOOLS_USED",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("error-row")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-type")).toBe("error")
		expect(row.getAttribute("data-title")).toBe("chat:modelResponseIncomplete")
	})

	it("renders MODEL_NO_ASSISTANT_MESSAGES error say message correctly", () => {
		const message: any = {
			id: "5",
			ts: 12345,
			type: "say",
			say: "error",
			text: "MODEL_NO_ASSISTANT_MESSAGES",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("error-row")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-type")).toBe("error")
		expect(row.getAttribute("data-title")).toBe("chat:modelResponseIncomplete")
	})

	it("renders generic error say message correctly", () => {
		const message: any = {
			id: "6",
			ts: 12345,
			type: "say",
			say: "error",
			text: "unhandled crash",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("error-row")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-type")).toBe("error")
		expect(row.getAttribute("data-message")).toBe("unhandled crash")
	})

	it("renders shell_integration_warning correctly", () => {
		const message: any = {
			id: "7",
			ts: 12345,
			type: "say",
			say: "shell_integration_warning",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		expect(screen.getByTestId("command-execution-error")).toBeInTheDocument()
	})

	it("renders checkpoint_saved say message correctly", () => {
		const message: any = {
			id: "8",
			ts: 12345,
			type: "say",
			say: "checkpoint_saved",
			text: "commit123",
			checkpoint: "cp1",
		}
		render(<SystemEventRow {...defaultProps} currentCheckpoint="commit123" message={message} />)
		const row = screen.getByTestId("checkpoint-saved")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-commit")).toBe("commit123")
		expect(row.getAttribute("data-current")).toBe("commit123")
	})

	it("renders condense_context say message correctly (partial/complete)", () => {
		const partialMessage: any = {
			id: "9",
			ts: 12345,
			type: "say",
			say: "condense_context",
			partial: true,
		}
		const { rerender } = render(<SystemEventRow {...defaultProps} message={partialMessage} />)
		expect(screen.getByTestId("inprogress-row")).toBeInTheDocument()

		const completeMessage: any = {
			id: "10",
			ts: 12345,
			type: "say",
			say: "condense_context",
			contextCondense: {
				tokensRemoved: 50,
				messagesRemoved: 2,
				statementsRemoved: 10,
				branchesRemoved: 5,
				functionsRemoved: 1,
				linesRemoved: 8,
			},
		}
		rerender(<SystemEventRow {...defaultProps} message={completeMessage} />)
		expect(screen.getByTestId("condensation-result")).toBeInTheDocument()
	})

	it("returns null if condense_context is complete but contextCondense property is missing", () => {
		const message: any = {
			id: "11",
			ts: 12345,
			type: "say",
			say: "condense_context",
		}
		const { container } = render(<SystemEventRow {...defaultProps} message={message} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders condense_context_error correctly", () => {
		const message: any = {
			id: "12",
			ts: 12345,
			type: "say",
			say: "condense_context_error",
			text: "condense error message",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("condensation-error")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-error")).toBe("condense error message")
	})

	it("renders sliding_window_truncation say message correctly (partial/complete)", () => {
		const partialMessage: any = {
			id: "13",
			ts: 12345,
			type: "say",
			say: "sliding_window_truncation",
			partial: true,
		}
		const { rerender } = render(<SystemEventRow {...defaultProps} message={partialMessage} />)
		expect(screen.getByTestId("inprogress-row")).toBeInTheDocument()

		const completeMessage: any = {
			id: "14",
			ts: 12345,
			type: "say",
			say: "sliding_window_truncation",
			contextTruncation: {
				prevContextTokens: 1000,
				newContextTokens: 900,
				truncationId: "trunc1",
				messagesRemoved: 4,
			},
		}
		rerender(<SystemEventRow {...defaultProps} message={completeMessage} />)
		expect(screen.getByTestId("truncation-result")).toBeInTheDocument()
	})

	it("returns null if sliding_window_truncation is complete but contextTruncation property is missing", () => {
		const message: any = {
			id: "15",
			ts: 12345,
			type: "say",
			say: "sliding_window_truncation",
		}
		const { container } = render(<SystemEventRow {...defaultProps} message={message} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders user_edit_todos say message correctly", () => {
		const message: any = {
			id: "16",
			ts: 12345,
			type: "say",
			say: "user_edit_todos",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		expect(screen.getByTestId("update-todolist-toolblock")).toBeInTheDocument()
	})

	it("renders image say message correctly (valid JSON)", () => {
		const message: any = {
			id: "17",
			ts: 12345,
			type: "say",
			say: "image",
			text: JSON.stringify({ imageUri: "data:image/png", imagePath: "/path/image.png" }),
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("image-block")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-uri")).toBe("data:image/png")
		expect(row.getAttribute("data-path")).toBe("/path/image.png")
	})

	it("returns null for image say message if JSON is invalid", () => {
		const message: any = {
			id: "18",
			ts: 12345,
			type: "say",
			say: "image",
			text: "invalid-json",
		}
		const { container } = render(<SystemEventRow {...defaultProps} message={message} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders too_many_tools_warning correctly", () => {
		const message: any = {
			id: "19",
			ts: 12345,
			type: "say",
			say: "too_many_tools_warning",
			text: JSON.stringify({ toolCount: 5, serverCount: 2, threshold: 3 }),
		}
		const originalPostMessage = window.postMessage
		window.postMessage = vi.fn()

		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("warning-row")
		expect(row).toBeInTheDocument()

		row.click()
		expect(window.postMessage).toHaveBeenCalledWith(
			{ type: "action", action: "settingsButtonClicked", values: { section: "mcp" } },
			"*",
		)
		window.postMessage = originalPostMessage
	})

	it("returns null if too_many_tools_warning text is invalid JSON", () => {
		const message: any = {
			id: "20",
			ts: 12345,
			type: "say",
			say: "too_many_tools_warning",
			text: "invalid-json",
		}
		const { container } = render(<SystemEventRow {...defaultProps} message={message} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders markdown in default say message case", () => {
		const message: any = {
			id: "21",
			ts: 12345,
			type: "say",
			say: "text" as any,
			text: "Hello World Markdown",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("markdown")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-markdown")).toBe("Hello World Markdown")
	})

	it("renders mistake_limit_reached ask message correctly", () => {
		const message: any = {
			id: "22",
			ts: 12345,
			type: "ask",
			ask: "mistake_limit_reached",
			text: "consecutive mistake limit hit",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("error-row")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-type")).toBe("mistake_limit")
		expect(row.getAttribute("data-message")).toBe("consecutive mistake limit hit")
	})

	it("renders command ask message correctly", () => {
		const message: any = {
			id: "23",
			ts: 12345,
			type: "ask",
			ask: "command",
			text: "npm run test",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		const row = screen.getByTestId("command-execution")
		expect(row).toBeInTheDocument()
		expect(row.getAttribute("data-id")).toBe("12345")
		expect(row.getAttribute("data-text")).toBe("npm run test")
	})

	it("renders auto_approval_max_req_reached correctly", () => {
		const message: any = {
			id: "24",
			ts: 12345,
			type: "ask",
			ask: "auto_approval_max_req_reached",
		}
		render(<SystemEventRow {...defaultProps} message={message} />)
		expect(screen.getByTestId("auto-approved-warning")).toBeInTheDocument()
	})

	it("returns null for unsupported ask message types", () => {
		const message: any = {
			id: "25",
			ts: 12345,
			type: "ask",
			ask: "unknown_ask" as any,
		}
		const { container } = render(<SystemEventRow {...defaultProps} message={message} />)
		expect(container.firstChild).toBeNull()
	})

	it("returns null for non-say/ask message types", () => {
		const message: any = {
			id: "26",
			ts: 12345,
			type: "unknown" as any,
		}
		const { container } = render(<SystemEventRow {...defaultProps} message={message} />)
		expect(container.firstChild).toBeNull()
	})
})
