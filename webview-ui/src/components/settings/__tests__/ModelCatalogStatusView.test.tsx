import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ModelCatalogStatusView } from "../ModelCatalogStatusView"

vi.mock("@src/i18n/TranslationContext", () => ({ useAppTranslation: () => ({ t: (key: string) => key }) }))

describe("model catalog status", () => {
	it("shows refresh failure and the retained catalog timestamp", () => {
		render(
			<ModelCatalogStatusView
				catalog={{
					configFingerprint: "fixture",
					source: "stale-disk-cache",
					stale: true,
					fetchedAt: 1234,
					refreshError: "unauthorized",
				}}
				loading={false}
				failed={false}
				onRefresh={vi.fn()}
			/>,
		)
		expect(screen.getByText("settings:modelCatalog.failed")).toBeInTheDocument()
		expect(screen.getByText("settings:modelCatalog.fetchedAt")).toBeInTheDocument()
		expect(screen.getByText("settings:modelCatalog.errors.unauthorized")).toBeInTheDocument()
		expect(screen.queryByText("settings:modelCatalog.fresh")).not.toBeInTheDocument()
	})
	it("reports unsupported listing and lets the user retry", () => {
		const refresh = vi.fn()
		render(
			<ModelCatalogStatusView
				catalog={{
					configFingerprint: "fixture",
					source: "hardcoded-fallback",
					stale: true,
					refreshError: "unsupported",
				}}
				loading={false}
				failed={false}
				onRefresh={refresh}
			/>,
		)
		expect(screen.getByText("settings:modelCatalog.unsupported")).toBeInTheDocument()
		fireEvent.click(screen.getByRole("button"))
		expect(refresh).toHaveBeenCalledTimes(1)
	})
	it("disables repeated refresh while loading", () => {
		render(<ModelCatalogStatusView loading={true} failed={false} onRefresh={vi.fn()} />)
		expect(screen.getByRole("button")).toBeDisabled()
		expect(screen.getByText("settings:modelCatalog.loading")).toBeInTheDocument()
	})
})
