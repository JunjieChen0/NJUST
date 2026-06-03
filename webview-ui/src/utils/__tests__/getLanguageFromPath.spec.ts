import { describe, it, expect } from "vitest"
import { getLanguageFromPath } from "../getLanguageFromPath"

describe("getLanguageFromPath", () => {
	it("returns correct language for common extensions", () => {
		expect(getLanguageFromPath("index.html")).toBe("html")
		expect(getLanguageFromPath("styles.css")).toBe("css")
		expect(getLanguageFromPath("main.js")).toBe("javascript")
		expect(getLanguageFromPath("App.tsx")).toBe("tsx")
		expect(getLanguageFromPath("script.py")).toBe("python")
		expect(getLanguageFromPath("Cargo.toml")).toBe("toml")
		expect(getLanguageFromPath("document.md")).toBe("markdown")
		expect(getLanguageFromPath("database.sql")).toBe("sql")
	})

	it("is case-insensitive for extensions", () => {
		expect(getLanguageFromPath("index.HTML")).toBe("html")
		expect(getLanguageFromPath("main.JS")).toBe("javascript")
		expect(getLanguageFromPath("App.Tsx")).toBe("tsx")
	})

	it("returns correct language for absolute or relative paths with folders", () => {
		expect(getLanguageFromPath("/path/to/file.ts")).toBe("typescript")
		expect(getLanguageFromPath(".github/workflows/ci.yml")).toBe("yaml")
	})

	it("returns undefined for paths without extensions", () => {
		expect(getLanguageFromPath("LICENSE")).toBeUndefined()
		expect(getLanguageFromPath("Makefile")).toBeUndefined()
	})

	it("returns undefined for unknown extensions", () => {
		expect(getLanguageFromPath("file.unknown_extension")).toBeUndefined()
	})

	it("handles paths with multiple dots", () => {
		expect(getLanguageFromPath("webpack.config.js")).toBe("javascript")
		expect(getLanguageFromPath("some.complex.file.name.xml")).toBe("xml")
	})

	it("handles trailing dot or empty input gracefully", () => {
		expect(getLanguageFromPath("file.")).toBeUndefined()
		expect(getLanguageFromPath("")).toBeUndefined()
	})
})
