import { render, waitFor } from "@testing-library/react"

import { vscode } from "@/utils/vscode"

import { MarketplaceView } from "../MarketplaceView"
import { MarketplaceViewStateManager } from "../MarketplaceViewStateManager"

vi.mock("@/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		renderContext: "sidebar",
	}),
}))

describe("MarketplaceView", () => {
	let stateManager: MarketplaceViewStateManager

	beforeEach(() => {
		vi.clearAllMocks()
		stateManager = new MarketplaceViewStateManager()

		// Initialize state manager with some test data
		stateManager.transition({
			type: "FETCH_COMPLETE",
			payload: {
				items: [
					{
						id: "test-mcp",
						name: "Test MCP",
						type: "mcp" as const,
						description: "Test MCP server",
						tags: ["test"],
						content: "Test content",
						url: "https://test.com",
						author: "Test Author",
					},
				],
			},
		})
	})

	it("should trigger fetchMarketplaceData on initial mount when data is empty", async () => {
		// Use a fresh state manager with no initial items to mimic first open.
		const emptyStateManager = new MarketplaceViewStateManager()

		render(<MarketplaceView stateManager={emptyStateManager} />)

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "fetchMarketplaceData",
			})
		})
	})

	it("should not trigger fetchMarketplaceData when initial state already has items", async () => {
		render(<MarketplaceView stateManager={stateManager} />)

		await waitFor(() => {
			expect(vscode.postMessage).not.toHaveBeenCalledWith({
				type: "fetchMarketplaceData",
			})
		})
	})
})
