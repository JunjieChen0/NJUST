import { render } from "@/utils/test-utils"

import TranslationProvider, { useAppTranslation } from "../TranslationContext"

vi.mock("@/context/ExtensionStateContext", () => ({
	useExtensionState: () => ({
		language: "en",
	}),
}))

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		i18n: {
			t: (key: string, options?: Record<string, any>) => {
				// Mock specific translations used in tests
				if (key === "settings.autoApprove.title") return "Auto-Approve"
				if (key === "notifications.error") {
					return options?.message ? `Operation failed: ${options.message}` : "Operation failed"
				}
				if (key === "settings.richText.description") return "Manage settings. <0>Learn more</0>"
				return key
			},
			changeLanguage: vi.fn(),
		},
	}),
}))

vi.mock("../setup", () => ({
	default: {
		t: (key: string, options?: Record<string, any>) => {
			// Mock specific translations used in tests
			if (key === "settings.autoApprove.title") return "Auto-Approve"
			if (key === "notifications.error") {
				return options?.message ? `Operation failed: ${options.message}` : "Operation failed"
			}
			if (key === "settings.richText.description") return "Manage settings. <0>Learn more</0>"
			return key
		},
		changeLanguage: vi.fn(),
	},
	loadTranslations: vi.fn(),
}))

const TestComponent = () => {
	const { t } = useAppTranslation()
	return (
		<div>
			<h1 data-testid="translation-test">{t("settings.autoApprove.title")}</h1>
			<p data-testid="translation-interpolation">{t("notifications.error", { message: "Test error" })}</p>
		</div>
	)
}

const RichTextTestComponent = () => {
	const { t } = useAppTranslation()
	return <p data-testid="rich-text-translation">{t("settings.richText.description")}</p>
}

describe("TranslationContext", () => {
	it("should provide translations via context", () => {
		const { getByTestId } = render(
			<TranslationProvider>
				<TestComponent />
			</TranslationProvider>,
		)

		// Check if translation is provided correctly
		expect(getByTestId("translation-test")).toHaveTextContent("Auto-Approve")
	})

	it("should handle interpolation correctly", () => {
		const { getByTestId } = render(
			<TranslationProvider>
				<TestComponent />
			</TranslationProvider>,
		)

		// Check if interpolation works
		expect(getByTestId("translation-interpolation")).toHaveTextContent("Operation failed: Test error")
	})

	it("warns when rich-text translations are requested via t", () => {
		const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		try {
			render(
				<TranslationProvider>
					<RichTextTestComponent />
				</TranslationProvider>,
			)

			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Translation key "settings.richText.description" contains rich-text tags'),
			)
		} finally {
			consoleWarnSpy.mockRestore()
		}
	})
})
