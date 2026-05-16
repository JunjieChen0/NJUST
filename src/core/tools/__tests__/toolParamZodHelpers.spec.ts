import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
	optionalBooleanCoerced,
	optionalNumberOrNumericString,
	optionalPositiveIntCoerced,
} from "../toolParamZodHelpers"

describe("toolParamZodHelpers", () => {
	it.each([
		[true, true],
		[false, false],
		["true", true],
		["false", false],
		[undefined, undefined],
	] as const)("coerces optional booleans from %s", (input, expected) => {
		expect(optionalBooleanCoerced.parse(input)).toBe(expected)
	})

	it("rejects invalid boolean strings", () => {
		expect(() => optionalBooleanCoerced.parse("yes")).toThrow()
	})

	it.each([
		[1, 1],
		["42", 42],
		[" 3.5 ", 3.5],
		["-2", -2],
		["", undefined],
		[null, undefined],
		[undefined, undefined],
	] as const)("coerces optional numbers from %s", (input, expected) => {
		expect(optionalNumberOrNumericString.parse(input)).toBe(expected)
	})

	it.each(["1e3", "abc", Number.POSITIVE_INFINITY])("rejects invalid numeric values %s", (input) => {
		expect(() => optionalNumberOrNumericString.parse(input)).toThrow()
	})

	it.each([
		[1, 1],
		[1.9, 1],
		["14", 14],
		[" 2 ", 2],
		["", undefined],
		[undefined, undefined],
	] as const)("coerces positive ints from %s", (input, expected) => {
		expect(optionalPositiveIntCoerced.parse(input)).toBe(expected)
	})

	it.each([0, -1, "1.2", "abc"])("rejects invalid positive ints %s", (input) => {
		expect(() => optionalPositiveIntCoerced.parse(input)).toThrow()
	})

	it("composes inside object schemas", () => {
		const schema = z.object({
			recursive: optionalBooleanCoerced,
			limit: optionalPositiveIntCoerced,
			timeout: optionalNumberOrNumericString,
		})

		expect(schema.parse({ recursive: "true", limit: "5", timeout: "2.5" })).toEqual({
			recursive: true,
			limit: 5,
			timeout: 2.5,
		})
	})
})
