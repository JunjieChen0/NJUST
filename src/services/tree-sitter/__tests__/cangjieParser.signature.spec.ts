import { describe, expect, it } from "vitest"

import {
	computeCangjieSignature,
	extractCangjieDeclarationMeta,
	findClosingAngleBracketIndex,
	parseCangjieDefinitions,
} from "../cangjieParser"

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

describe("extractCangjieDeclarationMeta", () => {
	it("extracts nested generics on one line", () => {
		const src = `package demo
class Foo { var m: HashMap<String, Option<Int64>> = HashMap() }
`
		const lines = src.split("\n")
		const defs = parseCangjieDefinitions(src)
		const c = defs.find((d) => d.kind === "class" && d.name === "Foo")
		expect(c).toBeDefined()
		const meta = extractCangjieDeclarationMeta(lines, c!.startLine, "Foo")
		expect(meta.typeParams).toBeUndefined()
	})

	it("ignores angle brackets inside string literals after type params on the same line", () => {
		const src = `package demo
class Foo<T> { var x = "oops<a>b" }
`
		const lines = src.split("\n")
		const defs = parseCangjieDefinitions(src)
		const c = defs.find((d) => d.kind === "class" && d.name === "Foo")
		expect(c).toBeDefined()
		const meta = extractCangjieDeclarationMeta(lines, c!.startLine, "Foo")
		expect(meta.typeParams).toBe("<T>")
	})

	it("joins multi-line type parameter lists after the name", () => {
		const src = `package demo
class Foo<
    T,
    U
> {
}
`
		const lines = src.split("\n")
		const defs = parseCangjieDefinitions(src)
		const c = defs.find((d) => d.kind === "class" && d.name === "Foo")
		expect(c).toBeDefined()
		const meta = extractCangjieDeclarationMeta(lines, c!.startLine, "Foo")
		expect(meta.typeParams?.replace(/\s+/g, " ").trim()).toBe("< T, U >")
	})
})

describe("findClosingAngleBracketIndex", () => {
	it("returns -1 when angle brackets are only inside a string", () => {
		const s = `x = "a<b>c"`
		const open = s.indexOf("<")
		expect(findClosingAngleBracketIndex(s, open)).toBe(-1)
	})
})
