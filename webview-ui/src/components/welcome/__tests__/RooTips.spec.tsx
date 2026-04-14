import React from "react"
import { render, screen } from "@/utils/test-utils"

import RooTips from "../RooTips"

vi.mock("react-i18next", () => ({
	initReactI18next: {
		type: "3rdParty",
		init: () => {},
	},
	useTranslation: () => ({
		t: (key: string) => key, // Simple mock that returns the key
	}),
	Trans: ({
		children,
		components,
	}: {
		children?: React.ReactNode
		components?: Record<string, React.ReactElement>
	}) => {
		// Simple mock that renders children or the first component if no children
		return children || (components && Object.values(components)[0]) || null
	},
}))

vi.mock("@src/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		language: "en",
	}),
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

describe("RooTips Component", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.runOnlyPendingTimers()
		vi.useRealTimers()
	})

	describe("when cycle is false (default)", () => {
		beforeEach(() => {
			render(<RooTips />)
		})

		test("renders all configured tip rows", () => {
			expect(screen.getByText("chat:rooTips.cangjieToolchain.title: chat:rooTips.cangjieToolchain.description")).toBeInTheDocument()
			expect(screen.getByText("chat:rooTips.smartDiagnostics.title: chat:rooTips.smartDiagnostics.description")).toBeInTheDocument()
			expect(screen.getByText("chat:rooTips.syntaxAndSnippets.title: chat:rooTips.syntaxAndSnippets.description")).toBeInTheDocument()
			expect(screen.getByText("chat:rooTips.docsIntegration.title: chat:rooTips.docsIntegration.description")).toBeInTheDocument()
		})
	})
})
