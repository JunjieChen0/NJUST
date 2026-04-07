import { describe, expect, it } from "vitest"

import { computeCangjieSignature, parseCangjieDefinitions } from "../cangjieParser"

describe("computeCangjieSignature", () => {
	it("joins multi-line func signature up to opening brace", () => {
		const src = `package demo
func longName(
    a: Int64,
    b: String
): Unit {
    return
}
`
		const lines = src.split("\n")
		const defs = parseCangjieDefinitions(src)
		const fn = defs.find((d) => d.kind === "func" && d.name === "longName")
		expect(fn).toBeDefined()
		const sig = computeCangjieSignature(lines, fn!)
		expect(sig).toContain("longName")
		expect(sig).toContain("a: Int64")
		expect(sig).toContain("b: String")
		expect(sig).toContain("): Unit")
		expect(sig).not.toContain("{")
	})

	it("uses single line for var", () => {
		const src = `package demo
var x: Int64 = 0
`
		const lines = src.split("\n")
		const defs = parseCangjieDefinitions(src)
		const v = defs.find((d) => d.kind === "var")
		expect(v).toBeDefined()
		const sig = computeCangjieSignature(lines, v!)
		expect(sig).toBe("var x: Int64 = 0")
	})
})
