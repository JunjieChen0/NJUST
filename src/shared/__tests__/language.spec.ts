// npx vitest run src/shared/__tests__/language.spec.ts

import { formatLanguage } from "../language"

describe("formatLanguage", () => {
	it("should uppercase region code in locale string", () => {
		expect(formatLanguage("zh-cn")).toBe("zh-CN")
		expect(formatLanguage("zh-tw")).toBe("zh-TW")
	})

	it("should return original string if no region code present", () => {
		expect(formatLanguage("en")).toBe("en")
	})

	it("should fall back to English for unsupported UI locales", () => {
		expect(formatLanguage("de")).toBe("en")
		expect(formatLanguage("fr")).toBe("en")
	})

	it("should handle empty or undefined input", () => {
		expect(formatLanguage("")).toBe("en")
		expect(formatLanguage(undefined as unknown as string)).toBe("en")
	})
})
