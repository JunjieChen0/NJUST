import { describe, expect, it } from "vitest"

import { extensionSettingSchemas, parseExtensionSetting } from "../extension-settings.js"

describe("generated extension settings schema", () => {
	it("covers the contributed settings and provides a default for every key", () => {
		const keys = Object.keys(extensionSettingSchemas)
		expect(keys.length).toBeGreaterThan(70)
		for (const key of keys) {
			const schema = extensionSettingSchemas[key as keyof typeof extensionSettingSchemas]
			expect(schema.safeParse(undefined).success, `${key} should handle an unset value`).toBe(true)
		}
	})

	it("preserves valid values instead of replacing them with defaults", () => {
		expect(parseExtensionSetting("cloudAgent.confirmDeferredReadTools", false)).toBe(false)
		expect(parseExtensionSetting("cloudAgent.compileLoop.maxRetries", 5)).toBe(5)
		expect(parseExtensionSetting("allowedCommands", ["git status"])).toEqual(["git status"])
	})

	it("falls back to manifest defaults for malformed values", () => {
		expect(parseExtensionSetting("cloudAgent.confirmDeferredReadTools", "yes")).toBe(true)
		expect(parseExtensionSetting("cloudAgent.compileLoop.maxRetries", 999)).toBe(3)
		expect(parseExtensionSetting("latex.engine", "unknown")).toBe("latexmk")
		expect(parseExtensionSetting("deniedCommands", "rm -rf /")).toEqual([])
	})
})
