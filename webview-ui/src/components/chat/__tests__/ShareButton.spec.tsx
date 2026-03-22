import { render, screen } from "@/utils/test-utils"
import { ShareButton } from "../ShareButton"

describe("ShareButton", () => {
	const mockItem = {
		id: "test-task-id",
		number: 1,
		ts: Date.now(),
		task: "Test Task",
		tokensIn: 100,
		tokensOut: 50,
		totalCost: 0.01,
	}

	test("renders nothing (cloud stripped)", () => {
		render(<ShareButton item={mockItem} />)
		expect(screen.queryByTestId("share-button")).not.toBeInTheDocument()
	})

	test("renders nothing when item is undefined", () => {
		render(<ShareButton />)
		expect(screen.queryByTestId("share-button")).not.toBeInTheDocument()
	})
})
