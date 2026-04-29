import { describe, expect, it } from "vitest"

import { parseCangjieDefinitions } from "../cangjieParser"

describe("parseCangjieDefinitions edge cases", () => {
	it("returns empty array for empty file", () => {
		expect(parseCangjieDefinitions("")).toEqual([])
	})

	it("returns empty array for whitespace-only file", () => {
		expect(parseCangjieDefinitions("   \n\n  \t\n")).toEqual([])
	})

	it("returns empty array for comment-only file", () => {
		const src = `// This is a comment
// Another comment
/*
Block comment
*/
`
		expect(parseCangjieDefinitions(src)).toEqual([])
	})

	it("does not detect class inside block comment spanning entire content", () => {
		const src = `/*
package demo
class Foo { func bar(): Unit { return } }
*/`
		const defs = parseCangjieDefinitions(src)
		// None of these should be detected
		expect(defs.find((d) => d.kind === "class")).toBeUndefined()
		expect(defs.find((d) => d.kind === "func")).toBeUndefined()
		expect(defs.find((d) => d.kind === "package")).toBeUndefined()
	})

	it("handles block comment mixed with code on same line", () => {
		const src = `package demo
func a(): Unit { return } /* dead code: func b(): Unit {} */
func c(): Unit { return }
`
		const defs = parseCangjieDefinitions(src)
		const b = defs.find((d) => d.name === "b")
		expect(b).toBeUndefined()
		expect(defs.find((d) => d.name === "a")).toBeDefined()
		expect(defs.find((d) => d.name === "c")).toBeDefined()
	})

	it("detects real definitions after block comment ends", () => {
		const src = `/*
    class Dead {}
    func dead() {}
*/
package demo

func alive(): Unit { return }
`
		const defs = parseCangjieDefinitions(src)
		expect(defs.find((d) => d.name === "Dead")).toBeUndefined()
		expect(defs.find((d) => d.name === "dead")).toBeUndefined()
		expect(defs.find((d) => d.name === "alive")).toBeDefined()
	})

	it("detects nested definitions correctly", () => {
		const src = `package demo
class Outer {
    func innerFunc(): Unit { return }
    class InnerClass {
        prop innerProp: Int64 {
            get() { 0 }
        }
    }
}
`
		const defs = parseCangjieDefinitions(src)
		expect(defs.find((d) => d.kind === "class" && d.name === "Outer")).toBeDefined()
		expect(defs.find((d) => d.kind === "class" && d.name === "InnerClass")).toBeDefined()
		expect(defs.find((d) => d.kind === "func" && d.name === "innerFunc")).toBeDefined()
		expect(defs.find((d) => d.kind === "prop" && d.name === "innerProp")).toBeDefined()
	})

	it("handles keywords inside string literals without false positives", () => {
		const src = `package demo
let msg = "class Foo { func bar() {} }"
func realWorld(): Unit { return }
`
		const defs = parseCangjieDefinitions(src)
		// "class Foo" inside string should NOT be treated as a definition
		const fakeClass = defs.find((d) => d.kind === "class" && d.name === "Foo")
		expect(fakeClass).toBeUndefined()
		// But real definitions outside strings should still be found
		expect(defs.find((d) => d.kind === "func" && d.name === "realWorld")).toBeDefined()
	})

	it("parses main declaration", () => {
		const src = `package demo
main(): Int64 {
    return 0
}
`
		const defs = parseCangjieDefinitions(src)
		const m = defs.find((d) => d.kind === "main")
		expect(m).toBeDefined()
	})

	it("parses enum with variants", () => {
		const src = `package demo
enum Color {
    | Red
    | Green
    | Blue
}
`
		const defs = parseCangjieDefinitions(src)
		const e = defs.find((d) => d.kind === "enum" && d.name === "Color")
		expect(e).toBeDefined()
	})

	it("parses operator func declarations", () => {
		const src = `package demo
class Vec2 {
    operator func +(rhs: Vec2): Vec2 {
        return this
    }
}
`
		const defs = parseCangjieDefinitions(src)
		const op = defs.find((d) => d.kind === "operator")
		expect(op).toBeDefined()
	})

	it("parses type alias declarations", () => {
		const src = `package demo
type MyInt = Int64
`
		const defs = parseCangjieDefinitions(src)
		const t = defs.find((d) => d.kind === "type_alias" && d.name === "MyInt")
		expect(t).toBeDefined()
	})
})
