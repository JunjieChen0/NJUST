import { describe, expect, it } from "vitest"
import { clearMcpInstructionsDelta, computeMcpInstructionsDelta } from "../mcp-instructions-delta"

describe("mcp-instructions-delta", () => {
	it("returns full on first snapshot and empty when unchanged", () => {
		const id = "t-1"
		clearMcpInstructionsDelta(id)
		expect(computeMcpInstructionsDelta(id, "A")).toBe("A")
		expect(computeMcpInstructionsDelta(id, "A")).toBe("")
	})

	it("returns suffix for append-only update", () => {
		const id = "t-2"
		clearMcpInstructionsDelta(id)
		computeMcpInstructionsDelta(id, "ABC")
		expect(computeMcpInstructionsDelta(id, "ABCDE")).toBe("DE")
	})
})
