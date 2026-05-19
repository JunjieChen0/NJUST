import { fireEvent, render, screen } from "@/utils/test-utils"

const { getContextMenuOptionsMock, postMessageMock } = vi.hoisted(() => ({
	getContextMenuOptionsMock: vi.fn(),
	postMessageMock: vi.fn(),
}))

vi.mock("i18next", () => ({
	t: (key: string) => key,
}))

vi.mock("vscode-material-icons", () => ({
	getIconForFilePath: vi.fn(() => "typescript"),
	getIconForDirectoryPath: vi.fn(() => "folder-src"),
	getIconUrlByName: vi.fn((name: string, baseUri: string) => `${baseUri}/${name}.svg`),
}))

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: postMessageMock,
	},
}))

vi.mock("@src/utils/context-mentions", async () => {
	const actual = await vi.importActual<typeof import("@src/utils/context-mentions")>("@src/utils/context-mentions")
	return {
		...actual,
		getContextMenuOptions: getContextMenuOptionsMock,
	}
})

import ContextMenu from "../ContextMenu"
import { ContextMenuOptionType, type ContextMenuQueryItem } from "@src/utils/context-mentions"

describe("ContextMenu", () => {
	const baseProps = {
		onSelect: vi.fn(),
		searchQuery: "@",
		inputValue: "@",
		onMouseDown: vi.fn(),
		selectedIndex: 2,
		setSelectedIndex: vi.fn(),
		selectedType: null,
		queryItems: [],
	}

	beforeEach(() => {
		vi.clearAllMocks()
		;(window as any).MATERIAL_ICONS_BASE_URI = "vscode-resource://icons"
		getContextMenuOptionsMock.mockReturnValue([
			{ type: ContextMenuOptionType.SectionHeader, label: "Files" },
			{
				type: ContextMenuOptionType.Mode,
				value: "code",
				slashCommand: "/code",
				description: "Code mode",
			},
			{
				type: ContextMenuOptionType.Command,
				value: "setup",
				slashCommand: "/setup",
				argumentHint: "<name>",
				description: "Setup project",
			},
			{ type: ContextMenuOptionType.File, value: "/src/app.ts" },
			{ type: ContextMenuOptionType.Folder, label: "Add folder" },
			{ type: ContextMenuOptionType.Git },
			{ type: ContextMenuOptionType.Git, label: "abc1234", value: "abc1234", description: "Initial commit" },
			{ type: ContextMenuOptionType.Problems, value: "problems" },
			{ type: ContextMenuOptionType.URL, value: "url" },
			{ type: ContextMenuOptionType.NoResults },
		] satisfies ContextMenuQueryItem[])
	})

	it("renders slash command header and sends settings navigation", () => {
		render(<ContextMenu {...baseProps} searchQuery="/" inputValue="/" />)

		expect(screen.getByText("Slash Commands")).toBeInTheDocument()
		expect(screen.getByText("settings:slashCommands.description")).toBeInTheDocument()

		fireEvent.mouseDown(screen.getByTitle("chat:slashCommands.manageCommands"))
		fireEvent.click(screen.getByTitle("chat:slashCommands.manageCommands"))

		expect(postMessageMock).toHaveBeenCalledWith({
			type: "switchTab",
			tab: "settings",
			values: { section: "slashCommands" },
		})
	})

	it("renders option variants and selects only selectable options", () => {
		const onSelect = vi.fn()
		const setSelectedIndex = vi.fn()
		render(<ContextMenu {...baseProps} onSelect={onSelect} setSelectedIndex={setSelectedIndex} />)

		expect(screen.getByText("/code")).toBeInTheDocument()
		expect(screen.getByText("Code mode")).toBeInTheDocument()
		expect(screen.getByText("/setup")).toBeInTheDocument()
		expect(screen.getByText("<name>")).toBeInTheDocument()
		expect(screen.getByText("app.ts")).toBeInTheDocument()
		expect(screen.getByText("src")).toBeInTheDocument()
		expect(screen.getByText("Git Commits")).toBeInTheDocument()
		expect(screen.getByText("abc1234")).toBeInTheDocument()
		expect(screen.getByText("chat:contextMenu.problems")).toBeInTheDocument()
		expect(screen.getByText("chat:contextMenu.url")).toBeInTheDocument()
		expect(screen.getByText("chat:contextMenu.noResults")).toBeInTheDocument()

		fireEvent.mouseEnter(screen.getByText("app.ts"))
		expect(setSelectedIndex).toHaveBeenCalledWith(3)

		fireEvent.click(screen.getByText("/setup"))
		fireEvent.click(screen.getByText("chat:contextMenu.url"))
		fireEvent.click(screen.getByText("chat:contextMenu.noResults"))
		fireEvent.click(screen.getByText("Files"))

		expect(onSelect).toHaveBeenCalledTimes(1)
		expect(onSelect).toHaveBeenCalledWith(ContextMenuOptionType.Command, "setup")
	})

	it("renders empty state when no options are available", () => {
		getContextMenuOptionsMock.mockReturnValue([])

		render(<ContextMenu {...baseProps} />)

		expect(screen.getByText("chat:contextMenu.noResults")).toBeInTheDocument()
	})
})
