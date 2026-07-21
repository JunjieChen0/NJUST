import { describe, expect, it } from "vitest"

import { BoundedOutput, MAX_CAPTURED_OUTPUT_BYTES } from "../BoundedOutput"

describe("BoundedOutput", () => {
	it("captures output up to the configured UTF-8 byte limit", () => {
		const output = new BoundedOutput(5)

		output.append("abc")
		output.append("def")

		expect(output.value).toBe("abcde")
		expect(output.capturedBytes).toBe(5)
		expect(output.totalBytes).toBe(6)
		expect(output.truncated).toBe(true)
	})

	it("does not split multi-byte characters at the limit", () => {
		const output = new BoundedOutput(5)

		output.append("你a好")
		output.append("b")

		expect(output.value).toBe("你a")
		expect(Buffer.byteLength(output.value, "utf8")).toBe(4)
		expect(output.value).not.toContain("\uFFFD")
		expect(output.totalBytes).toBe(8)
		expect(output.truncated).toBe(true)
	})

	it("keeps a complete character that ends exactly at the limit", () => {
		const output = new BoundedOutput(7)

		output.append("你a好")

		expect(output.value).toBe("你a好")
		expect(output.capturedBytes).toBe(7)
		expect(output.truncated).toBe(false)
	})

	it("uses the shared 100000-byte default", () => {
		const output = new BoundedOutput()

		output.append("x".repeat(MAX_CAPTURED_OUTPUT_BYTES + 1))

		expect(Buffer.byteLength(output.value, "utf8")).toBe(MAX_CAPTURED_OUTPUT_BYTES)
		expect(output.totalBytes).toBe(MAX_CAPTURED_OUTPUT_BYTES + 1)
		expect(output.truncated).toBe(true)
	})

	it("rejects invalid byte limits", () => {
		expect(() => new BoundedOutput(-1)).toThrow(RangeError)
		expect(() => new BoundedOutput(1.5)).toThrow(RangeError)
	})
})
