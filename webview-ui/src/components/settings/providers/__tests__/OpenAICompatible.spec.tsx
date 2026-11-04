import React from "react"
import { render, screen, fireEvent, act, cleanup } from "@/utils/test-utils"
import { webcrypto } from "node:crypto"
import { OpenAICompatible } from "../OpenAICompatible"
import { ProviderSettings } from "@njust-ai/types"
import * as selectedModelHook from "@src/components/ui/hooks/useSelectedModel"

// Mock the vscrui Checkbox component
vi.mock("vscrui", () => ({
	Checkbox: ({ children, checked, onChange }: any) => (
		<label data-testid={`checkbox-${children?.toString().replace(/\s+/g, "-").toLowerCase()}`}>
			<input
				type="checkbox"
				checked={checked}
				onChange={() => onChange(!checked)} // Toggle the checked state
				data-testid={`checkbox-input-${children?.toString().replace(/\s+/g, "-").toLowerCase()}`}
			/>
			{children}
		</label>
	),
}))

// Mock the VSCodeTextField and VSCodeButton components
vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeTextField: ({
		children,
		value,
		onInput,
		placeholder,
		className,
		style,
		"data-testid": dataTestId,
		...rest
	}: any) => {
		return (
			<div
				data-testid={dataTestId ? `${dataTestId}-text-field` : "vscode-text-field"}
				className={className}
				style={style}>
				{children}
				<input
					type="text"
					value={value}
					onChange={(e) => onInput && onInput(e)}
					placeholder={placeholder}
					data-testid={dataTestId}
					{...rest}
				/>
			</div>
		)
	},
	VSCodeButton: ({ children, onClick, appearance, title }: any) => (
		<button onClick={onClick} title={title} data-testid={`vscode-button-${appearance}`}>
			{children}
		</button>
	),
}))

// Mock the translation hook
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock the UI components
vi.mock("@src/components/ui", () => ({
	Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
	StandardTooltip: ({ children, content }: any) => <div title={content}>{children}</div>,
}))

// Mock other components
vi.mock("../../ModelPicker", () => ({
	ModelPicker: () => <div data-testid="model-picker">Model Picker</div>,
}))

vi.mock("../../R1FormatSetting", () => ({
	R1FormatSetting: () => <div data-testid="r1-format-setting">R1 Format Setting</div>,
}))

vi.mock("../../ThinkingBudget", () => ({
	ThinkingBudget: () => <div data-testid="thinking-budget">Thinking Budget</div>,
}))

// Mock react-use
vi.mock("react-use", () => ({
	useEvent: vi.fn(),
}))

describe("OpenAI-compatible model reset", () => {
	afterEach(() => vi.restoreAllMocks())
	it("clears overrides and restores catalog limits while keeping the selected connection and ID", () => {
		const catalog = { contextWindow: 128000, maxTokens: 8192, supportsPromptCache: false }
		vi.spyOn(selectedModelHook, "useSelectedModel").mockImplementation((configuration) => ({
			provider: "openai",
			id: configuration?.openAiModelId ?? "fixture",
			info: configuration?.openAiCustomModelInfo ?? catalog,
			isLoading: false,
			isError: false,
		}))
		const setField = vi.fn()
		const initial: ProviderSettings = {
			apiProvider: "openai",
			openAiModelId: "chosen-model",
			openAiBaseUrl: "https://fixture.invalid/v1",
			openAiApiKey: "fixture",
			openAiCustomModelInfo: { ...catalog, maxTokens: 6000 },
		}
		function Harness() {
			const [configuration, setConfiguration] = React.useState(initial)
			return (
				<OpenAICompatible
					apiConfiguration={configuration}
					organizationAllowList={{ allowAll: true, providers: {} }}
					setApiConfigurationField={(field, value) => {
						setField(field, value)
						setConfiguration((previous) => ({ ...previous, [field]: value }))
					}}
				/>
			)
		}
		render(<Harness />)
		expect(screen.getByDisplayValue("6000")).toBeInTheDocument()
		fireEvent.click(screen.getByText("settings:providers.customModel.resetDefaults"))
		expect(setField).toHaveBeenCalledWith("openAiCustomModelInfo", undefined)
		expect(screen.getByDisplayValue("8192")).toBeInTheDocument()
		expect(screen.getByDisplayValue("https://fixture.invalid/v1")).toBeInTheDocument()
		expect(screen.getByDisplayValue("fixture")).toBeInTheDocument()
	})
})

describe("OpenAICompatible Component - includeMaxTokens checkbox", () => {
	const mockSetApiConfigurationField = vi.fn()
	const mockOrganizationAllowList = {
		allowAll: true,
		providers: {},
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Checkbox Rendering", () => {
		it("should render the includeMaxTokens checkbox", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Check that the checkbox is rendered
			const checkbox = screen.getByTestId("checkbox-settings:includemaxoutputtokens")
			expect(checkbox).toBeInTheDocument()

			// Check that the description text is rendered
			expect(screen.getByText("settings:includeMaxOutputTokensDescription")).toBeInTheDocument()
		})

		it("should render the checkbox with correct translation keys", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Check that the correct translation key is used for the label
			expect(screen.getByText("settings:includeMaxOutputTokens")).toBeInTheDocument()

			// Check that the correct translation key is used for the description
			expect(screen.getByText("settings:includeMaxOutputTokensDescription")).toBeInTheDocument()
		})
	})

	describe("Initial State", () => {
		it("should show checkbox as checked when includeMaxTokens is true", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).toBeChecked()
		})

		it("should show checkbox as unchecked when includeMaxTokens is false", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: false,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).not.toBeChecked()
		})

		it("should default to checked when includeMaxTokens is undefined", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				// includeMaxTokens is not defined
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).toBeChecked()
		})

		it("should default to checked when includeMaxTokens is null", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: null as any,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).toBeChecked()
		})
	})

	describe("User Interaction", () => {
		it("should call handleInputChange with correct parameters when checkbox is clicked from checked to unchecked", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			fireEvent.click(checkboxInput)

			// Verify setApiConfigurationField was called with correct parameters
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("includeMaxTokens", false)
		})

		it("should call handleInputChange with correct parameters when checkbox is clicked from unchecked to checked", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: false,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			const checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			fireEvent.click(checkboxInput)

			// Verify setApiConfigurationField was called with correct parameters
			expect(mockSetApiConfigurationField).toHaveBeenCalledWith("includeMaxTokens", true)
		})
	})

	describe("Component Updates", () => {
		it("should update checkbox state when apiConfiguration changes", () => {
			const apiConfigurationInitial: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			const { rerender } = render(
				<OpenAICompatible
					apiConfiguration={apiConfigurationInitial as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Verify initial state
			let checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).toBeChecked()

			// Update with new configuration
			const apiConfigurationUpdated: Partial<ProviderSettings> = {
				includeMaxTokens: false,
			}

			rerender(
				<OpenAICompatible
					apiConfiguration={apiConfigurationUpdated as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Verify updated state
			checkboxInput = screen.getByTestId("checkbox-input-settings:includemaxoutputtokens")
			expect(checkboxInput).not.toBeChecked()
		})
	})

	describe("UI Structure", () => {
		it("should render the checkbox with description in correct structure", () => {
			const apiConfiguration: Partial<ProviderSettings> = {
				includeMaxTokens: true,
			}

			render(
				<OpenAICompatible
					apiConfiguration={apiConfiguration as ProviderSettings}
					setApiConfigurationField={mockSetApiConfigurationField}
					organizationAllowList={mockOrganizationAllowList}
				/>,
			)

			// Check that the checkbox and description are in a div container
			const checkbox = screen.getByTestId("checkbox-settings:includemaxoutputtokens")
			const parentDiv = checkbox.closest("div")
			expect(parentDiv).toBeInTheDocument()

			// Check that the description has the correct styling classes
			const description = screen.getByText("settings:includeMaxOutputTokensDescription")
			expect(description).toHaveClass("text-sm", "text-vscode-descriptionForeground", "ml-6")
		})
	})
})

describe("OpenAI-compatible header drafts", () => {
	const organizationAllowList = { allowAll: true, providers: {} }
	beforeEach(() => {
		vi.useFakeTimers()
		vi.stubGlobal("crypto", webcrypto)
	})
	afterEach(() => {
		cleanup()
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})
	it("switches header drafts without writing a pending old value to the new profile", async () => {
		const setField = vi.fn()
		const first: ProviderSettings = { apiProvider: "openai", openAiHeaders: { "x-tenant": "first" } }
		const next: ProviderSettings = { apiProvider: "openai", openAiHeaders: { "x-tenant": "next" } }
		const { rerender } = render(
			<OpenAICompatible
				apiConfiguration={first}
				setApiConfigurationField={setField}
				organizationAllowList={organizationAllowList}
			/>,
		)
		fireEvent.change(screen.getByDisplayValue("first"), { target: { value: "pending" } })
		rerender(
			<OpenAICompatible
				apiConfiguration={next}
				setApiConfigurationField={setField}
				organizationAllowList={organizationAllowList}
			/>,
		)
		expect(screen.getByDisplayValue("next")).toBeInTheDocument()
		expect(screen.queryByDisplayValue("pending")).not.toBeInTheDocument()
		await act(async () => {
			await vi.advanceTimersByTimeAsync(350)
		})
		expect(setField).not.toHaveBeenCalledWith("openAiHeaders", { "x-tenant": "pending" }, false)
		expect(setField).not.toHaveBeenCalledWith("openAiHeaders", { "x-tenant": "first" }, false)
	})
	it("does not rewrite unchanged headers when the component mounts", async () => {
		const setField = vi.fn()
		render(
			<OpenAICompatible
				apiConfiguration={{ apiProvider: "openai", openAiHeaders: { "x-tenant": "same" } }}
				setApiConfigurationField={setField}
				organizationAllowList={organizationAllowList}
			/>,
		)
		await act(async () => {
			await vi.advanceTimersByTimeAsync(350)
		})
		expect(setField).not.toHaveBeenCalledWith("openAiHeaders", expect.anything(), false)
	})
	it("keeps an empty row editable when saved headers are echoed back", async () => {
		const setField = vi.fn()
		const configuration: ProviderSettings = { apiProvider: "openai", openAiHeaders: { "x-tenant": "same" } }
		const { rerender } = render(
			<OpenAICompatible
				apiConfiguration={configuration}
				setApiConfigurationField={setField}
				organizationAllowList={organizationAllowList}
			/>,
		)
		fireEvent.click(screen.getByTitle("settings:common.add").querySelector("button")!)
		rerender(
			<OpenAICompatible
				apiConfiguration={{ ...configuration, openAiHeaders: { "x-tenant": "same" } }}
				setApiConfigurationField={setField}
				organizationAllowList={organizationAllowList}
			/>,
		)
		const names = screen.getAllByPlaceholderText("settings:providers.headerName")
		expect(names).toHaveLength(2)
		fireEvent.change(names[1]!, { target: { value: "x-extra" } })
		await act(async () => {
			await vi.advanceTimersByTimeAsync(350)
		})
		expect(setField).toHaveBeenCalledWith("openAiHeaders", { "x-tenant": "same", "x-extra": "" }, false)
	})
})
