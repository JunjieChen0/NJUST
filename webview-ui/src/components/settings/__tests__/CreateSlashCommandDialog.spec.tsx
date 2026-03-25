import { render, screen, waitFor } from "@/utils/test-utils"
import userEvent from "@testing-library/user-event"

import { CreateSlashCommandDialog } from "../CreateSlashCommandDialog"

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

const hasRefWarning = (calls: unknown[][]) =>
	calls.some((call) =>
		call.some((arg) => typeof arg === "string" && arg.includes("Function components cannot be given refs")),
	)

describe("CreateSlashCommandDialog", () => {
	it("renders the create slash command dialog", () => {
		render(
			<CreateSlashCommandDialog
				open={true}
				onOpenChange={vi.fn()}
				onCommandCreated={vi.fn()}
				hasWorkspace={true}
			/>,
		)

		expect(screen.getByText("settings:slashCommands.createDialog.title")).toBeInTheDocument()
		expect(screen.getByLabelText("settings:slashCommands.createDialog.nameLabel")).toBeInTheDocument()
		expect(screen.getByRole("combobox")).toBeInTheDocument()
	})

	it("does not emit React ref warnings when opening the source select", async () => {
		const user = userEvent.setup()
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

		try {
			render(
				<CreateSlashCommandDialog
					open={true}
					onOpenChange={vi.fn()}
					onCommandCreated={vi.fn()}
					hasWorkspace={true}
				/>,
			)

			await user.click(screen.getByRole("combobox"))

			await waitFor(() => {
				expect(screen.getByRole("option", { name: "settings:slashCommands.source.global" })).toBeInTheDocument()
				expect(screen.getByRole("option", { name: "settings:slashCommands.source.project" })).toBeInTheDocument()
			})

			expect(hasRefWarning(consoleErrorSpy.mock.calls)).toBe(false)
			expect(hasRefWarning(consoleWarnSpy.mock.calls)).toBe(false)
		} finally {
			consoleErrorSpy.mockRestore()
			consoleWarnSpy.mockRestore()
		}
	})
})
