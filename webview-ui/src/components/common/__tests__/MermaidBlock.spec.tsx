import React from "react"
import { vi, describe, it, expect, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import MermaidBlock from "../MermaidBlock"
import mermaid from "mermaid"
import { vscode } from "@src/utils/vscode"

// Mock mermaid library
vi.mock("mermaid", () => ({
	default: {
		initialize: vi.fn(),
		parse: vi.fn().mockResolvedValue(true),
		render: vi
			.fn()
			.mockResolvedValue({ svg: "<svg id='mermaid-test-id' clientWidth='300' clientHeight='150'><g></g></svg>" }),
	},
}))

// Mock translations
vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

// Mock clipboard
vi.mock("@src/utils/clipboard", () => ({
	useCopyToClipboard: () => ({
		showCopyFeedback: false,
		copyWithFeedback: vi.fn().mockResolvedValue(undefined),
	}),
}))

// Mock vscode
vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

// Mock useDebounceEffect to run synchronously
vi.mock("@src/utils/useDebounceEffect", () => ({
	useDebounceEffect: (fn: () => void, _delay: number, deps: any[]) => {
		React.useEffect(fn, deps)
	},
}))

// Mock sub-components
vi.mock("../Modal", () => ({
	Modal: ({ isOpen, onClose, children }: any) =>
		isOpen ? (
			<div data-testid="modal">
				<button onClick={onClose}>CloseModal</button>
				{children}
			</div>
		) : null,
}))

vi.mock("../TabButton", () => ({
	TabButton: ({ label, isActive, onClick }: any) => (
		<button data-testid={`tab-${label}`} data-active={isActive ? "true" : "false"} onClick={onClick}>
			{label}
		</button>
	),
}))

vi.mock("../IconButton", () => ({
	IconButton: ({ icon, onClick }: any) => (
		<button data-testid={`icon-${icon}`} onClick={onClick}>
			{icon}
		</button>
	),
}))

vi.mock("../ZoomControls", () => ({
	ZoomControls: ({ zoomLevel, adjustZoom }: any) => (
		<div data-testid="zoom-controls">
			<button onClick={() => adjustZoom(0.2)}>ZoomIn</button>
			<button onClick={() => adjustZoom(-0.2)}>ZoomOut</button>
			<span>{zoomLevel}</span>
		</div>
	),
}))

vi.mock("../MermaidActionButtons", () => ({
	MermaidActionButtons: ({ onZoom, onCopy, onSave, onViewCode }: any) => (
		<div data-testid="action-buttons">
			<button onClick={onZoom}>ZoomBtn</button>
			<button onClick={onCopy}>CopyBtn</button>
			<button onClick={onSave}>SaveBtn</button>
			<button onClick={onViewCode}>ViewCodeBtn</button>
		</div>
	),
}))

vi.mock("@/components/ui", () => ({
	StandardTooltip: ({ children }: any) => <>{children}</>,
}))

vi.mock("../CodeBlock", () => ({
	default: ({ source }: any) => <pre data-testid="codeblock">{source}</pre>,
}))

describe("MermaidBlock", () => {
	const mockCode = "graph TD\nA-->B"

	beforeEach(() => {
		vi.clearAllMocks()
		vi.mocked(mermaid.parse).mockResolvedValue(true as any)
		vi.mocked(mermaid.render).mockResolvedValue({
			svg: "<svg id='mermaid-test-id' clientWidth='300' clientHeight='150'><g></g></svg>",
			diagramType: "flowchart",
		} as any)
	})

	it("renders loading state initially and then shows the rendered svg", async () => {
		render(<MermaidBlock code={mockCode} />)

		// Wait for rendering to complete
		await waitFor(() => {
			expect(screen.queryByText("common:mermaid.loading")).toBeNull()
		})

		const svgContainer = document.querySelector("#mermaid-test-id")
		expect(svgContainer).toBeDefined()
	})

	it("displays error details when parsing fails", async () => {
		vi.mocked(mermaid.parse).mockRejectedValueOnce(new Error("Syntax Error in Line 1"))

		render(<MermaidBlock code={mockCode} />)

		await waitFor(() => {
			expect(screen.getByText("common:mermaid.render_error")).toBeInTheDocument()
		})

		// Toggle error expand
		const header = screen.getByText("common:mermaid.render_error")
		fireEvent.click(header)

		expect(screen.getByText("Syntax Error in Line 1")).toBeInTheDocument()
		expect(screen.getByTestId("codeblock")).toBeInTheDocument()
	})

	it("handles hover, zoom, copy, and code view operations in the toolbar", async () => {
		const { container } = render(<MermaidBlock code={mockCode} />)

		await waitFor(() => {
			expect(container.querySelector("#mermaid-test-id")).toBeDefined()
		})

		// Hover over container
		const relativeContainer = container.querySelector(".relative")!
		fireEvent.mouseEnter(relativeContainer)

		// Verification toolbar buttons are visible
		expect(screen.getByTestId("action-buttons")).toBeInTheDocument()

		// Click zoom
		fireEvent.click(screen.getByText("ZoomBtn"))
		expect(screen.getByTestId("modal")).toBeInTheDocument()

		// Modal should have active diagram tab
		expect(screen.getByTestId("tab-common:mermaid.tabs.diagram")).toHaveAttribute("data-active", "true")

		// Click code tab
		fireEvent.click(screen.getByTestId("tab-common:mermaid.tabs.code"))
		expect(screen.getByTestId("tab-common:mermaid.tabs.code")).toHaveAttribute("data-active", "true")
		expect(screen.getByRole("textbox")).toBeInTheDocument()

		// Click close modal
		fireEvent.click(screen.getByText("CloseModal"))
		expect(screen.queryByTestId("modal")).toBeNull()

		// Click view code directly
		fireEvent.mouseEnter(relativeContainer)
		fireEvent.click(screen.getByText("ViewCodeBtn"))
		expect(screen.getByTestId("modal")).toBeInTheDocument()
		expect(screen.getByTestId("tab-common:mermaid.tabs.code")).toHaveAttribute("data-active", "true")
	})

	it("supports zoom adjustments in diagram modal", async () => {
		const { container } = render(<MermaidBlock code={mockCode} />)

		await waitFor(() => {
			expect(container.querySelector("#mermaid-test-id")).toBeDefined()
		})

		const relativeContainer = container.querySelector(".relative")!
		fireEvent.mouseEnter(relativeContainer)
		fireEvent.click(screen.getByText("ZoomBtn"))

		expect(screen.getByText("100%")).toBeInTheDocument()

		// Click zoom in
		fireEvent.click(screen.getByText("ZoomIn"))
		expect(screen.getByText("120%")).toBeInTheDocument()

		// Click zoom out
		fireEvent.click(screen.getByText("ZoomOut"))
		expect(screen.getByText("100%")).toBeInTheDocument()
	})

	it("supports mouse wheel zooming and dragging in diagram modal", async () => {
		const { container } = render(<MermaidBlock code={mockCode} />)

		await waitFor(() => {
			expect(container.querySelector("#mermaid-test-id")).toBeDefined()
		})

		const relativeContainer = container.querySelector(".relative")!
		fireEvent.mouseEnter(relativeContainer)
		fireEvent.click(screen.getByText("ZoomBtn"))

		const flexContainer = screen.getByText("CloseModal").parentElement!.querySelector(".flex-1")!

		// Mouse wheel scroll up to zoom in
		fireEvent.wheel(flexContainer, { deltaY: -100 })
		expect(screen.getByText("120%")).toBeInTheDocument()

		// Mouse drag to translate
		const grabbable = flexContainer.firstChild!
		fireEvent.mouseDown(grabbable)
		fireEvent.mouseMove(grabbable, { movementX: 10, movementY: 5 })
		fireEvent.mouseUp(grabbable)
	})

	it("sends openImage/saveImage posts to vscode when clicked or saved", async () => {
		const originalGetContext = HTMLCanvasElement.prototype.getContext
		HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
			fillRect: vi.fn(),
			drawImage: vi.fn(),
		} as any)

		const originalToDataURL = HTMLCanvasElement.prototype.toDataURL
		HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue("data:image/png;base64,123")

		const originalImage = globalThis.Image
		globalThis.Image = class {
			onload: (() => void) | null = null
			onerror: (() => void) | null = null
			src = ""
			constructor() {
				setTimeout(() => {
					if (this.onload) this.onload()
				}, 0)
			}
		} as any

		const { container } = render(<MermaidBlock code={mockCode} />)

		await waitFor(() => {
			expect(container.querySelector("#mermaid-test-id")).toBeDefined()
		})

		// Set mock client size on the rendered svg element so svgToPng doesn't fail
		const svg = container.querySelector("svg")!
		Object.defineProperty(svg, "clientWidth", { value: 100 })
		Object.defineProperty(svg, "clientHeight", { value: 50 })

		// Click SVG directly to trigger handleClick/openImage
		fireEvent.click(svg)

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "openImage",
				text: "data:image/png;base64,123",
			})
		})

		// Hover and save image via toolbar
		const relativeContainer = container.querySelector(".relative")!
		fireEvent.mouseEnter(relativeContainer)
		fireEvent.click(screen.getByText("SaveBtn"))

		await waitFor(() => {
			expect(vscode.postMessage).toHaveBeenCalledWith({
				type: "saveImage",
				dataUri: "data:image/png;base64,123",
			})
		})

		HTMLCanvasElement.prototype.getContext = originalGetContext
		HTMLCanvasElement.prototype.toDataURL = originalToDataURL
		globalThis.Image = originalImage
	})
})
