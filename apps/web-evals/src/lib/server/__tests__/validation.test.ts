import { describe, it, expect } from "vitest"
import {
	validateRunId,
	validateDescription,
	MAX_DESCRIPTION_LENGTH,
	MAX_RUN_ID,
} from "../validation"

describe("validateRunId", () => {
	it("accepts valid positive integers", () => {
		expect(validateRunId(1)).toBe(1)
		expect(validateRunId(42)).toBe(42)
		expect(validateRunId(1000)).toBe(1000)
	})

	it("accepts string numbers", () => {
		expect(validateRunId("42")).toBe(42)
	})

	it("rejects zero", () => {
		expect(() => validateRunId(0)).toThrow("Invalid run ID")
	})

	it("rejects negative numbers", () => {
		expect(() => validateRunId(-1)).toThrow("Invalid run ID")
	})

	it("rejects floats", () => {
		expect(() => validateRunId(1.5)).toThrow("Invalid run ID")
	})

	it("rejects NaN", () => {
		expect(() => validateRunId(NaN)).toThrow("Invalid run ID")
	})

	it("rejects non-numeric strings", () => {
		expect(() => validateRunId("abc")).toThrow("Invalid run ID")
	})

	it("rejects numbers exceeding MAX_RUN_ID", () => {
		expect(() => validateRunId(MAX_RUN_ID + 1)).toThrow("Invalid run ID")
	})

	it("rejects null", () => {
		expect(() => validateRunId(null)).toThrow("Invalid run ID")
	})

	it("rejects undefined", () => {
		expect(() => validateRunId(undefined)).toThrow("Invalid run ID")
	})

	it("rejects objects", () => {
		expect(() => validateRunId({})).toThrow("Invalid run ID")
	})
})

describe("validateDescription", () => {
	it("returns null for null input", () => {
		expect(validateDescription(null)).toBeNull()
	})

	it("returns null for undefined input", () => {
		expect(validateDescription(undefined)).toBeNull()
	})

	it("returns the string for valid input", () => {
		expect(validateDescription("test description")).toBe("test description")
	})

	it("returns empty string for empty string input", () => {
		expect(validateDescription("")).toBe("")
	})

	it("accepts exactly at max length", () => {
		const desc = "a".repeat(MAX_DESCRIPTION_LENGTH)
		expect(validateDescription(desc)).toBe(desc)
	})

	it("rejects strings exceeding max length", () => {
		const desc = "a".repeat(MAX_DESCRIPTION_LENGTH + 1)
		expect(() => validateDescription(desc)).toThrow("exceeds maximum length")
	})

	it("rejects numbers", () => {
		expect(() => validateDescription(123)).toThrow("must be a string or null")
	})

	it("rejects objects", () => {
		expect(() => validateDescription({})).toThrow("must be a string or null")
	})

	it("rejects arrays", () => {
		expect(() => validateDescription([])).toThrow("must be a string or null")
	})
})
