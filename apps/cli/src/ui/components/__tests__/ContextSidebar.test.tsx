import { describe, it, expect } from "vitest"
import { render } from "ink-testing-library"

import ContextSidebar from "../ContextSidebar.js"

describe("ContextSidebar", () => {
	it("renders nothing meaningful when all props are empty", () => {
		const { lastFrame } = render(<ContextSidebar />)
		const frame = lastFrame() ?? ""
		// The ctrl+o commands hint is always rendered at the bottom.
		expect(frame).toContain("ctrl+o")
		expect(frame).toContain("commands")
	})

	it("renders context percentage when contextFraction is provided", () => {
		const { lastFrame } = render(<ContextSidebar contextFraction={0.62} />)
		expect(lastFrame() ?? "").toContain("ctx 62%")
	})

	it("renders 0% for zero context fraction", () => {
		const { lastFrame } = render(<ContextSidebar contextFraction={0} />)
		expect(lastFrame() ?? "").toContain("ctx 0%")
	})

	it("hides context row when contextFraction is undefined", () => {
		const { lastFrame } = render(<ContextSidebar />)
		expect(lastFrame() ?? "").not.toContain("ctx")
	})

	it("renders mcp count when > 0", () => {
		const { lastFrame } = render(<ContextSidebar mcpCount={3} />)
		expect(lastFrame() ?? "").toContain("mcp 3")
	})

	it("hides mcp row when count is 0", () => {
		const { lastFrame } = render(<ContextSidebar mcpCount={0} />)
		expect(lastFrame() ?? "").not.toContain("mcp")
	})

	it("renders lsp count when > 0", () => {
		const { lastFrame } = render(<ContextSidebar lspCount={2} />)
		expect(lastFrame() ?? "").toContain("lsp 2")
	})

	it("hides lsp row when count is 0", () => {
		const { lastFrame } = render(<ContextSidebar lspCount={0} />)
		expect(lastFrame() ?? "").not.toContain("lsp")
	})
})
