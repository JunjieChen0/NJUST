import { render, screen } from "@testing-library/react"
import React from "react"
import { describe, it, expect, vi } from "vitest"
import { CangjieProgressRow } from "../CangjieProgressRow"

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe("Cangjie progress", () => {
	it("exposes the current stage, approval wait and the resolved project to assistive technology", () => {
		render(
			<CangjieProgressRow
				progress={{
					stage: "build",
					status: "waiting",
					at: 1,
					projectRoot: "/orders",
					sdkVersion: "1.0.5",
					detail: "Approval required",
				}}
			/>,
		)
		expect(screen.getByRole("status")).toHaveTextContent("delivery:stages.build")
		expect(screen.getByRole("status")).toHaveTextContent("delivery:progressStates.waiting")
		expect(screen.getByRole("status")).toHaveTextContent("/orders")
		expect(screen.getByRole("status")).toHaveTextContent("Approval required")
	})
})
