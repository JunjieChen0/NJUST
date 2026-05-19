import { fireEvent, render, screen, waitFor } from "@/utils/test-utils"

vi.mock("../../common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown?: string }) => markdown ?? null,
}))

vi.mock("@/components/common/MarkdownBlock", () => ({
	default: ({ markdown }: { markdown?: string }) => markdown ?? null,
}))

import UpdateTodoListToolBlock from "../UpdateTodoListToolBlock"

describe("UpdateTodoListToolBlock", () => {
	const todos = [
		{ id: "todo-1", content: "Write tests", status: "" },
		{ id: "todo-2", content: "Run coverage", status: "in_progress" },
	]

	it("renders user-edited state without todo controls", () => {
		render(<UpdateTodoListToolBlock todos={todos} onChange={vi.fn()} userEdited />)

		expect(screen.getByText("User Edit")).toBeInTheDocument()
		expect(screen.getByText("User Edits")).toBeInTheDocument()
		expect(screen.queryByText("Edit")).not.toBeInTheDocument()
	})

	it("edits todo content and status while in edit mode", () => {
		const onChange = vi.fn()
		render(<UpdateTodoListToolBlock todos={todos} onChange={onChange} />)

		fireEvent.click(screen.getByText("Edit"))
		fireEvent.change(screen.getByDisplayValue("Write tests"), { target: { value: "Write better tests" } })
		fireEvent.change(screen.getByDisplayValue("In Progress"), { target: { value: "completed" } })

		expect(onChange).toHaveBeenNthCalledWith(
			1,
			expect.arrayContaining([expect.objectContaining({ id: "todo-1", content: "Write better tests" })]),
		)
		expect(onChange).toHaveBeenNthCalledWith(
			2,
			expect.arrayContaining([expect.objectContaining({ id: "todo-2", status: "completed" })]),
		)
	})

	it("adds trimmed todos from the inline add form and cancels with Escape", async () => {
		const onChange = vi.fn()
		render(<UpdateTodoListToolBlock todos={todos} onChange={onChange} />)

		fireEvent.click(screen.getByText("Edit"))
		fireEvent.click(screen.getByText("+ Add Todo"))
		const input = screen.getByPlaceholderText("Enter todo item, press Enter to add")
		fireEvent.change(input, { target: { value: "  Review diff  " } })
		fireEvent.keyDown(input, { key: "Enter" })

		expect(onChange).toHaveBeenCalledWith(
			expect.arrayContaining([expect.objectContaining({ content: "Review diff", status: "" })]),
		)
		await waitFor(() => expect(screen.queryByPlaceholderText("Enter todo item, press Enter to add")).toBeNull())

		fireEvent.click(screen.getByText("+ Add Todo"))
		const secondInput = screen.getByPlaceholderText("Enter todo item, press Enter to add")
		fireEvent.change(secondInput, { target: { value: "Discard me" } })
		fireEvent.keyDown(secondInput, { key: "Escape" })

		expect(screen.queryByPlaceholderText("Enter todo item, press Enter to add")).toBeNull()
		expect(onChange).toHaveBeenCalledTimes(1)
	})

	it("confirms and cancels todo deletion", () => {
		const onChange = vi.fn()
		render(<UpdateTodoListToolBlock todos={todos} onChange={onChange} />)

		fireEvent.click(screen.getByText("Edit"))
		fireEvent.click(screen.getAllByTitle("Remove")[0]!)
		expect(screen.getByText("Are you sure you want to delete this todo item?")).toBeInTheDocument()

		fireEvent.click(screen.getByText("Cancel"))
		expect(screen.queryByText("Are you sure you want to delete this todo item?")).not.toBeInTheDocument()
		expect(onChange).not.toHaveBeenCalled()

		fireEvent.click(screen.getAllByTitle("Remove")[0]!)
		fireEvent.click(screen.getByText("Delete"))
		expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ id: "todo-2" })])
	})

	it("hides edit controls when editing is disabled or turned off externally", () => {
		const { rerender } = render(<UpdateTodoListToolBlock todos={todos} onChange={vi.fn()} />)

		fireEvent.click(screen.getByText("Edit"))
		expect(screen.getByText("Done")).toBeInTheDocument()

		rerender(<UpdateTodoListToolBlock todos={todos} onChange={vi.fn()} editable={false} />)

		expect(screen.queryByText("Done")).not.toBeInTheDocument()
		expect(screen.queryByText("Edit")).not.toBeInTheDocument()
		expect(screen.queryByText("+ Add Todo")).not.toBeInTheDocument()
	})
})
