import { vi, describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TodoListDisplay } from "../TodoListDisplay"

vi.mock("i18next", () => ({
	t: (key: string) => key,
}))

describe("TodoListDisplay", () => {
	it("returns null for empty todos", () => {
		const { container } = render(<TodoListDisplay todos={[]} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders collapsed todo list with most important todo when in_progress", () => {
		const todos = [
			{ id: "1", content: "Todo 1", status: "completed" },
			{ id: "2", content: "Todo 2", status: "in_progress" },
			{ id: "3", content: "Todo 3", status: "pending" },
		]

		render(<TodoListDisplay todos={todos} />)

		// It should display the in_progress todo content
		expect(screen.getByText("Todo 2")).toBeInTheDocument()
		expect(screen.getByText("1/3")).toBeInTheDocument()
	})

	it("renders collapsed todo list with pending when no in_progress", () => {
		const todos = [
			{ id: "1", content: "Todo 1", status: "completed" },
			{ id: "2", content: "Todo 2", status: "pending" },
		]

		render(<TodoListDisplay todos={todos} />)

		expect(screen.getByText("Todo 2")).toBeInTheDocument()
	})

	it("renders complete text when all completed", () => {
		const todos = [
			{ id: "1", content: "Todo 1", status: "completed" },
			{ id: "2", content: "Todo 2", status: "completed" },
		]

		render(<TodoListDisplay todos={todos} />)

		expect(screen.getByText("chat:todo.complete")).toBeInTheDocument()
	})

	it("toggles collapse/expanded state on click", () => {
		const todos = [
			{ id: "1", content: "Todo 1", status: "completed" },
			{ id: "2", content: "Todo 2", status: "in_progress" },
			{ id: "3", content: "Todo 3", status: "pending" },
		]

		const { container } = render(<TodoListDisplay todos={todos} />)

		// Click the header to expand
		const header = container.querySelector(".cursor-pointer")!
		fireEvent.click(header)

		expect(screen.getByText("chat:todo.partial")).toBeInTheDocument()
		expect(screen.getByText("Todo 1")).toBeInTheDocument()
		expect(screen.getByText("Todo 2")).toBeInTheDocument()
		expect(screen.getByText("Todo 3")).toBeInTheDocument()

		// Click again to collapse
		fireEvent.click(header)
		expect(screen.queryByText("Todo 1")).not.toBeInTheDocument()
	})
})
