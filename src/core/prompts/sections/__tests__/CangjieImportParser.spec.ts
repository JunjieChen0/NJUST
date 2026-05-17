import { describe, expect, it } from "vitest"

import { extractImports, isNonTrivialImportMapping, mapImportsToDocPaths } from "../CangjieImportParser"

describe("CangjieImportParser", () => {
	it("extracts Cangjie import package prefixes", () => {
		const imports = extractImports(`
			package demo
			import std.collection.*
			import std.fs.*
			import demo.model.*
		`)

		expect(imports).toContain("std.collection")
		expect(imports).toContain("std.fs")
		expect(imports).toContain("demo.model")
	})

	it("maps non-trivial std imports to docs", () => {
		const mappings = mapImportsToDocPaths(["std.collection", "std.core", "std.fs"])

		expect(mappings.some((mapping) => mapping.prefix.startsWith("std.collection"))).toBe(true)
		expect(mappings.every((mapping) => isNonTrivialImportMapping(mapping.prefix))).toBe(true)
	})
})
