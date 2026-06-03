import { vi, describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TodoChangeDisplay } from "../TodoChangeDisplay"

vi.mock("i18next", () => ({
	t: (key: string) => key,
}))

describe("TodoChangeDisplay", () => {
	it("returns null when no todos to display", () => {
		const { container } = render(<TodoChangeDisplay previousTodos={[]} newTodos={[]} />)
		expect(container.firstChild).toBeNull()
	})

	it("renders all new todos when previousTodos is empty (initial state)", () => {
		const newTodos = [
			{ id: "1", content: "Todo 1", status: "completed" },
			{ id: "2", content: "Todo 2", status: "in_progress" },
			{ id: "3", content: "Todo 3", status: "pending" },
		]

		render(<TodoChangeDisplay previousTodos={[]} newTodos={newTodos} />)

		expect(screen.getByText("chat:todo.updated")).toBeInTheDocument()
		expect(screen.getByText("Todo 1")).toBeInTheDocument()
		expect(screen.getByText("Todo 2")).toBeInTheDocument()
		expect(screen.getByText("Todo 3")).toBeInTheDocument()
	})

	it("only renders completed or in_progress changes on updates", () => {
		const prevTodos = [
			{ id: "1", content: "Todo 1", status: "pending" },
			{ id: "2", content: "Todo 2", status: "pending" },
			{ id: "3", content: "Todo 3", status: "completed" },
		]

		const newTodos = [
			{ id: "1", content: "Todo 1", status: "completed" }, // status changed to completed -> should show
			{ id: "2", content: "Todo 2", status: "in_progress" }, // status changed to in_progress -> should show
			{ id: "3", content: "Todo 3", status: "completed" }, // status unchanged -> should not show
			{ id: "4", content: "Todo 4", status: "pending" }, // new pending -> should not show
		]

		render(<TodoChangeDisplay previousTodos={prevTodos} newTodos={newTodos} />)

		expect(screen.getByText("Todo 1")).toBeInTheDocument()
		expect(screen.getByText("Todo 2")).toBeInTheDocument()
		expect(screen.queryByText("Todo 3")).not.toBeInTheDocument()
		expect(screen.queryByText("Todo 4")).not.toBeInTheDocument()
	})

	it("returns null when new todos change to pending (not completed/in_progress)", () => {
		const prevTodos = [{ id: "1", content: "Todo 1", status: "in_progress" }]
		const newTodos = [{ id: "1", content: "Todo 1", status: "pending" }]

		const { container } = render(<TodoChangeDisplay previousTodos={prevTodos} newTodos={newTodos} />)
		expect(container.firstChild).toBeNull()
	})
})
