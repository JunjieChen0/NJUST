import { describe, expect, it } from "vitest"
import { extractTypeMemberSummaries } from "../cangjieParser"

describe("extractTypeMemberSummaries", () => {
	it("collects var/let/func/prop-like lines inside class body", () => {
		const src = `
package demo

class Foo {
    let x: Int64 = 0
    var y: Int64 = 1

    public func bar(): Int64 {
        return x
    }

    prop p: Int64 {
        get() { x }
    }
}
`
		const lines = src.split("\n")
		const declStart = lines.findIndex((l) => l.includes("class Foo"))
		const declEnd = lines.length - 1
		const { members, totalMatchingLines } = extractTypeMemberSummaries(lines, declStart, declEnd, 20)
		expect(members.some((m) => m.includes("let x"))).toBe(true)
		expect(members.some((m) => m.includes("var y"))).toBe(true)
		expect(members.some((m) => m.includes("func bar"))).toBe(true)
		expect(members.some((m) => m.includes("prop p"))).toBe(true)
		expect(totalMatchingLines).toBeGreaterThanOrEqual(4)
	})

	it("returns empty when no opening brace in search window", () => {
		const lines = ["struct X"]
		const r = extractTypeMemberSummaries(lines, 0, 0, 5)
		expect(r.members).toEqual([])
		expect(r.methods).toEqual([])
		expect(r.totalMatchingLines).toBe(0)
	})
})
