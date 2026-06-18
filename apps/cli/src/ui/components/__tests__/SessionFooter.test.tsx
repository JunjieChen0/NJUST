import { describe, it, expect } from "vitest"
import { render } from "ink-testing-library"

import SessionFooter from "../SessionFooter.js"

describe("SessionFooter", () => {
	it("renders the workspace path on the left", () => {
		const { lastFrame } = render(<SessionFooter workspacePath="/tmp/myproject" />)
		expect(lastFrame() ?? "").toContain("/tmp/myproject")
	})

	it("hides LSP/MCP/Permissions chips when their counts are zero", () => {
		const { lastFrame } = render(<SessionFooter workspacePath="/tmp" />)
		const frame = lastFrame() ?? ""
		expect(frame).not.toContain("LSP")
		expect(frame).not.toContain("MCP")
		expect(frame).not.toContain("Permission")
	})

	it("renders permission count when > 0", () => {
		const { lastFrame } = render(<SessionFooter workspacePath="/tmp" permissionCount={3} />)
		expect(lastFrame() ?? "").toContain("3 Permissions")
	})

	it("uses singular form for one permission", () => {
		const { lastFrame } = render(<SessionFooter workspacePath="/tmp" permissionCount={1} />)
		const frame = lastFrame() ?? ""
		expect(frame).toContain("1 Permission")
		expect(frame).not.toContain("Permissions")
	})

	it("renders LSP count when > 0", () => {
		const { lastFrame } = render(<SessionFooter workspacePath="/tmp" lspCount={2} />)
		expect(lastFrame() ?? "").toContain("2 LSP")
	})

	it("renders MCP count when > 0", () => {
		const { lastFrame } = render(<SessionFooter workspacePath="/tmp" mcpCount={1} />)
		expect(lastFrame() ?? "").toContain("1 MCP")
	})

	it("shows /status hint by default and can be hidden", () => {
		const { lastFrame: a } = render(<SessionFooter workspacePath="/tmp" />)
		expect(a() ?? "").toContain("/status")
		const { lastFrame: b } = render(<SessionFooter workspacePath="/tmp" showStatusHint={false} />)
		expect(b() ?? "").not.toContain("/status")
	})
})
