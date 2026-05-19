import React from "react"
import { fireEvent, render, screen } from "@/utils/test-utils"
import { vscode } from "@src/utils/vscode"

import { PlanView } from "../PlanView"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

const baseSteps = [
	{
		id: "step-1",
		index: 0,
		description: "Inspect project coverage",
		mode: "code",
		dependencies: [],
		status: "completed" as const,
		result: "coverage report generated",
	},
	{
		id: "step-2",
		index: 1,
		description: "Add missing tests",
		mode: "architect",
		dependencies: ["step-1", "external-step"],
		status: "failed" as const,
		error: "missing assertion",
	},
]

type Plan = NonNullable<React.ComponentProps<typeof PlanView>["plan"]>

const makePlan = (status: Plan["status"] = "draft") => ({
	id: "plan-1",
	title: "Coverage plan",
	description: "Raise coverage thresholds",
	steps: baseSteps,
	status,
	completedSteps: 1,
	totalSteps: 2,
})

describe("PlanView", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("shows empty state when no plan is active", () => {
		render(<PlanView plan={null} />)

		expect(screen.getByText("No active plan. Use /plan command to create one.")).toBeInTheDocument()
	})

	it("renders plan summary, steps, expanded details, and close action", () => {
		const onClose = vi.fn()
		render(<PlanView plan={makePlan()} onClose={onClose} />)

		expect(screen.getByText("Coverage plan")).toBeInTheDocument()
		expect(screen.getByText("Raise coverage thresholds")).toBeInTheDocument()
		expect(screen.getByText("1/2 steps")).toBeInTheDocument()
		expect(screen.getByText("DRAFT")).toBeInTheDocument()
		expect(screen.getByText("Inspect project coverage")).toBeInTheDocument()

		fireEvent.click(screen.getByText("Step 2"))
		expect(screen.getByText("Dependencies:")).toBeInTheDocument()
		expect(screen.getByText("Step 1, external-step")).toBeInTheDocument()
		expect(screen.getByText("Error:")).toBeInTheDocument()
		expect(screen.getByText("missing assertion")).toBeInTheDocument()

		fireEvent.click(screen.getByText("Step 1"))
		expect(screen.getByText("Result:")).toBeInTheDocument()
		expect(screen.getByText("coverage report generated")).toBeInTheDocument()

		fireEvent.click(screen.getByText("×"))
		expect(onClose).toHaveBeenCalledTimes(1)
	})

	it("sends approve and discard actions for draft plans", () => {
		render(<PlanView plan={makePlan("draft")} />)

		fireEvent.click(screen.getByText("Approve Plan"))
		fireEvent.click(screen.getByText("Discard"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "planAction",
			action: "approve",
			planId: "plan-1",
		})
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "planAction",
			action: "cancel",
			planId: "plan-1",
		})
	})

	it("edits draft step descriptions and supports cancelling edit mode", () => {
		render(<PlanView plan={makePlan("draft")} />)

		fireEvent.doubleClick(screen.getByText("Add missing tests"))
		const textarea = screen.getByDisplayValue("Add missing tests")
		fireEvent.change(textarea, { target: { value: "Add focused tests" } })
		fireEvent.click(screen.getByText("Save"))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "planAction",
			action: "updateStep",
			planId: "plan-1",
			stepId: "step-2",
			description: "Add focused tests",
		})

		fireEvent.doubleClick(screen.getByText("Inspect project coverage"))
		fireEvent.click(screen.getByText("Cancel"))
		expect(screen.queryByDisplayValue("Inspect project coverage")).not.toBeInTheDocument()
	})

	it.each([
		["approved", "Execute Plan", "execute"],
		["executing", "Pause Execution", "pause"],
		["paused", "Resume Execution", "execute"],
		["paused", "Cancel Plan", "cancel"],
	] as const)("sends %s action from %s controls", (status, label, action) => {
		render(<PlanView plan={makePlan(status)} />)

		fireEvent.click(screen.getByText(label))

		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "planAction",
			action,
			planId: "plan-1",
		})
	})

	it("does not show action buttons for terminal plan states", () => {
		render(<PlanView plan={makePlan("completed")} />)

		expect(screen.queryByText("Approve Plan")).not.toBeInTheDocument()
		expect(screen.queryByText("Execute Plan")).not.toBeInTheDocument()
		expect(screen.queryByText("Pause Execution")).not.toBeInTheDocument()
	})
})
