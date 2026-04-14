import React from "react"
import { render, screen, fireEvent } from "@/utils/test-utils"

import SessionMetricsSummary from "../SessionMetricsSummary"

let mockExtensionState: any = {
	taskMetricsHistory: [],
	currentTaskItem: { id: "task-a" },
}

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => mockExtensionState,
}))

describe("SessionMetricsSummary", () => {
	it("renders task scope metrics by default", () => {
		mockExtensionState = {
			taskMetricsHistory: [
				{ taskId: "task-a", cacheHitRate: 0.5, estimatedSavingsPercent: 10, latencyMs: 100, inputTokens: 100, outputTokens: 20 },
				{ taskId: "task-b", cacheHitRate: 1.0, estimatedSavingsPercent: 30, latencyMs: 300, inputTokens: 200, outputTokens: 40 },
				{ taskId: "task-a", cacheHitRate: 0.7, estimatedSavingsPercent: 20, latencyMs: 200, inputTokens: 300, outputTokens: 60 },
			],
			currentTaskItem: { id: "task-a" },
		}

		render(<SessionMetricsSummary />)

		expect(screen.getByText("Samples 2")).toBeInTheDocument()
		expect(screen.getByText("AvgCache 60%")).toBeInTheDocument()
		expect(screen.getByText("AvgSaved 15.0%")).toBeInTheDocument()
		expect(screen.getByText("AvgLatency 150ms")).toBeInTheDocument()
	})

	it("switches to session scope metrics when clicking Session", () => {
		mockExtensionState = {
			taskMetricsHistory: [
				{
					taskId: "task-a",
					cacheHitRate: 0.5,
					estimatedSavingsPercent: 10,
					latencyMs: 100,
					inputTokens: 100,
					outputTokens: 20,
					cacheBreaksTotal: 2,
					cacheBreaksBySource: { tools_list_changed: 1, mcp_tools_changed: 1 },
				},
				{
					taskId: "task-b",
					cacheHitRate: 1.0,
					estimatedSavingsPercent: 30,
					latencyMs: 300,
					inputTokens: 200,
					outputTokens: 40,
					cacheBreaksTotal: 4,
					cacheBreaksBySource: { environment_info_changed: 3, mcp_tools_changed: 1 },
				},
				{
					taskId: "task-a",
					cacheHitRate: 0.7,
					estimatedSavingsPercent: 20,
					latencyMs: 200,
					inputTokens: 300,
					outputTokens: 60,
					cacheBreaksTotal: 5,
					cacheBreaksBySource: { environment_info_changed: 4, mcp_tools_changed: 1 },
				},
			],
			currentTaskItem: { id: "task-a" },
		}

		render(<SessionMetricsSummary />)
		fireEvent.click(screen.getByRole("button", { name: "Session" }))

		expect(screen.getByText("Samples 3")).toBeInTheDocument()
		expect(screen.getByText("AvgCache 73%")).toBeInTheDocument()
		expect(screen.getByText("AvgSaved 20.0%")).toBeInTheDocument()
		expect(screen.getByText("AvgLatency 200ms")).toBeInTheDocument()
		expect(screen.getByText("Breaks 5")).toBeInTheDocument()
		expect(screen.getByText("TopBreak environment_info_changed (4)")).toBeInTheDocument()
		expect(screen.getByText("TopBreak environment_info_changed (4)")).toHaveAttribute(
			"title",
			expect.stringContaining("environment_info_changed: 4"),
		)
	})
})
