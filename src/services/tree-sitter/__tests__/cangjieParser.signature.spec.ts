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

describe("computeCangjieSignature string safety", () => {
	it("ignores brace inside string literal when finding opening brace", () => {
		const src = `package demo
func foo(x: String = "{not-a-brace}"): Unit {
    return
}
`
		const lines = src.split("\n")
		const defs = parseCangjieDefinitions(src)
		const fn = defs.find((d) => d.kind === "func" && d.name === "foo")
		expect(fn).toBeDefined()
		const sig = computeCangjieSignature(lines, fn!)
		// Signature includes the string literal with its braces — that's correct
		expect(sig).toContain('"{not-a-brace}"')
		expect(sig).toContain("): Unit")
		// But must NOT include the return statement (body correctly excluded)
		expect(sig).not.toContain("return")
	})

	it("handles brace inside char literal", () => {
		const src = `package demo
func bar(x: Rune = '{'): Bool {
    return false
}
`
		const lines = src.split("\n")
		const defs = parseCangjieDefinitions(src)
		const fn = defs.find((d) => d.kind === "func" && d.name === "bar")
		expect(fn).toBeDefined()
		const sig = computeCangjieSignature(lines, fn!)
		expect(sig).toContain("'{'")
		expect(sig).toContain("): Bool")
		// Body correctly excluded — should not contain "false"
		expect(sig).not.toContain("false")
	})
})

describe("parseCangjieDefinitions comment handling", () => {
	it("does not detect definitions inside multi-line block comments", () => {
		const src = `package demo
/*
class FakeClass {
    func fakeMethod() {}
}
*/
func realFunc(): Unit {
    return
}
`
		const defs = parseCangjieDefinitions(src)
		// Should NOT find FakeClass or fakeMethod
		const fakeClass = defs.find((d) => d.kind === "class" && d.name === "FakeClass")
		expect(fakeClass).toBeUndefined()
		const fakeMethod = defs.find((d) => d.kind === "func" && d.name === "fakeMethod")
		expect(fakeMethod).toBeUndefined()
		// Should find realFunc
		const realFunc = defs.find((d) => d.kind === "func" && d.name === "realFunc")
		expect(realFunc).toBeDefined()
	})

	it("does not detect definitions inside block comment that starts/ends mid-file", () => {
		const src = `package demo
func a(): Unit { return }
/* class CommentedClass { func inner() {} } */
func b(): Unit { return }
`
		const defs = parseCangjieDefinitions(src)
		const commented = defs.find((d) => d.name === "CommentedClass")
		expect(commented).toBeUndefined()
		expect(defs.find((d) => d.name === "a")).toBeDefined()
		expect(defs.find((d) => d.name === "b")).toBeDefined()
	})

	it("ignores keywords after // on the same line as real declarations", () => {
		const src = `package demo
func foo(): Unit { // class Bar
    return
}
`
		const defs = parseCangjieDefinitions(src)
		const bar = defs.find((d) => d.kind === "class" && d.name === "Bar")
		expect(bar).toBeUndefined()
		const foo = defs.find((d) => d.kind === "func" && d.name === "foo")
		expect(foo).toBeDefined()
	})

	it("handles multiple block comments in sequence", () => {
		const src = `package demo
/* first block */
/* second block
   class Ghost {}
*/
func visible(): Unit { return }
`
		const defs = parseCangjieDefinitions(src)
		const ghost = defs.find((d) => d.name === "Ghost")
		expect(ghost).toBeUndefined()
		expect(defs.find((d) => d.name === "visible")).toBeDefined()
	})
})
