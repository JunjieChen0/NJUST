import React from "react"
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import type { VerificationSummary } from "@njust-ai/types"
import { VerificationCard } from "../VerificationCard"
import { vscode } from "@src/utils/vscode"

vi.mock("@src/utils/vscode", () => ({ vscode: { postMessage: vi.fn() } }))
vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) => `${key}${values ? JSON.stringify(values) : ""}`,
	}),
}))
const base: VerificationSummary = {
	overall: "verified",
	build: { state: "passed" },
	test: { state: "passed", executed: 2, passed: 2 },
	acceptance: "pending",
	claimId: "claim",
}

describe("VerificationCard", () => {
	it.each(["verified", "failed", "incomplete", "no_record"] as const)("renders %s from system facts", (overall) => {
		render(<VerificationCard ts={1} isLatest summary={{ ...base, overall }} />)
		expect(screen.getByText(`chat:verification.overall.${overall}`)).toBeInTheDocument()
	})
	it.each(["accepted", "changes_requested", "superseded", "no_delivery"] as const)(
		"hides decision buttons for %s",
		(acceptance) => {
			render(<VerificationCard ts={1} isLatest summary={{ ...base, acceptance }} />)
			expect(screen.queryByRole("button", { name: "chat:verification.accept" })).toBeNull()
		},
	)
	it("hides decisions on old and terminal cards", () => {
		const { rerender } = render(<VerificationCard ts={1} isLatest={false} summary={base} />)
		expect(screen.queryByRole("button", { name: "chat:verification.accept" })).toBeNull()
		rerender(<VerificationCard ts={1} isLatest summary={{ ...base, terminal: "cancelled" }} />)
		expect(screen.queryByRole("button", { name: "chat:verification.accept" })).toBeNull()
	})
	it("sends explicit decisions and identifies unverified deliveries", () => {
		render(<VerificationCard ts={42} isLatest summary={{ ...base, overall: "incomplete" }} />)
		fireEvent.click(screen.getByRole("button", { name: "chat:verification.accept" }))
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "verificationDecision",
			verificationDecision: { ts: 42, decision: "accepted", claimId: "claim" },
		})
		fireEvent.click(screen.getByRole("button", { name: "chat:verification.requestChanges" }))
		expect(vscode.postMessage).toHaveBeenCalledWith({
			type: "verificationDecision",
			verificationDecision: { ts: 42, decision: "changes_requested", claimId: "claim" },
		})
		expect(screen.getByText("chat:verification.unverified")).toBeInTheDocument()
	})
	it.each(["build", "test"] as const)("hides decisions when %s verification is stale", (kind) => {
		render(<VerificationCard ts={1} isLatest summary={{ ...base, [kind]: { state: "stale" } }} />)
		expect(screen.queryByRole("button", { name: "chat:verification.accept" })).toBeNull()
		expect(screen.queryByRole("button", { name: "chat:verification.requestChanges" })).toBeNull()
		expect(screen.getByText("chat:verification.reverifyRequired")).toBeInTheDocument()
	})
	it("shows stale reasons and outside edits and opens recorded logs", () => {
		render(
			<VerificationCard
				ts={1}
				isLatest
				summary={{
					...base,
					overall: "incomplete",
					build: { state: "stale", staleReason: "environment_changed", logPath: "/task/logs/build.log" },
					test: { state: "zero_tests", executed: 0 },
					changes: { taskTool: 0, other: 1, files: ["a.cj"], otherFiles: ["a.cj"] },
				}}
			/>,
		)
		expect(screen.getByText(/verification.environmentChanged/)).toBeInTheDocument()
		expect(screen.getByText(/verification.otherChanges/)).toBeInTheDocument()
		expect(screen.getByText(/verification.states.zero_tests/)).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "chat:verification.buildLog" }))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "openFile", text: "/task/logs/build.log" })
	})
	it("shows delivered files, code identity, command working directory and the saved diff", () => {
		render(
			<VerificationCard
				ts={1}
				isLatest
				summary={{
					...base,
					build: { state: "passed", executable: "/sdk/cjpm", args: ["build"], cwd: "/project" },
					currentFingerprint: "current-hash",
					delivery: {
						projectRoot: "/project",
						fingerprint: "delivered-hash",
						baselineFingerprint: "baseline",
						capturedAt: 1,
						files: [{ path: "src/main.cj", change: "modified", source: "task_tool" }],
						filesTruncated: false,
						diffPath: "/task/claim.patch",
						diffOmittedPaths: [],
					},
				}}
			/>,
		)
		expect(screen.getByText(/src\/main.cj/)).toBeInTheDocument()
		expect(screen.getByText("/sdk/cjpm build")).toBeInTheDocument()
		expect(screen.getByText("current-hash")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button", { name: "delivery:viewDiff" }))
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "openFile", text: "/task/claim.patch" })
	})
	it("expires an unverified delivery when its code changes, even when no check ever ran", () => {
		render(
			<VerificationCard
				ts={1}
				isLatest
				summary={{
					...base,
					overall: "no_record",
					build: { state: "not_run" },
					test: { state: "not_run" },
					currentFingerprint: "new",
					delivery: {
						projectRoot: "/project",
						fingerprint: "old",
						capturedAt: 1,
						files: [],
						filesTruncated: false,
						diffOmittedPaths: [],
					},
				}}
			/>,
		)
		expect(screen.queryByRole("button", { name: "chat:verification.accept" })).toBeNull()
		expect(screen.getByText("chat:verification.reverifyRequired")).toBeInTheDocument()
	})
	it("shows related suite commands, working directories and separate counts", () => {
		render(
			<VerificationCard
				ts={1}
				isLatest
				summary={{
					...base,
					relatedTests: [
						{
							state: "passed",
							cwd: "/orders/libs/pricing",
							executable: "cjpm",
							args: ["test"],
							executed: 1,
							passed: 1,
						},
					],
				}}
			/>,
		)
		expect(screen.getByText("delivery:relatedTests")).toBeInTheDocument()
		expect(screen.getByText("cjpm test")).toBeInTheDocument()
		expect(screen.getByText(/\/orders\/libs\/pricing/)).toBeInTheDocument()
	})
})
