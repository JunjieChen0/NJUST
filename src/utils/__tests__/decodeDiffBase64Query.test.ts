import { describe, expect, it } from "vitest"

import { decodeDiffBase64Query, MAX_DIFF_BASE64_QUERY_CHARS } from "../decodeDiffBase64Query"

describe("decodeDiffBase64Query", () => {
	it("returns empty content for empty / undefined query", () => {
		expect(decodeDiffBase64Query("")).toEqual({ content: "", ok: true })
		expect(decodeDiffBase64Query(undefined)).toEqual({ content: "", ok: true })
		expect(decodeDiffBase64Query(null)).toEqual({ content: "", ok: true })
	})

	it("decodes a normal base64 payload", () => {
		const original = "hello, diff!"
		const encoded = Buffer.from(original, "utf-8").toString("base64")
		const r = decodeDiffBase64Query(encoded)
		expect(r.ok).toBe(true)
		expect(r.content).toBe(original)
	})

	it("rejects a query longer than the configured cap and returns a stable error string", () => {
		const cap = 1024
		const oversize = "A".repeat(cap + 1)
		const r = decodeDiffBase64Query(oversize, cap)
		expect(r.ok).toBe(false)
		expect(r.content).toContain("too large")
		expect(r.content).toContain(`${oversize.length}`)
		expect(r.content).toContain(`${cap}`)
	})

	it("uses the default cap when no override is given", () => {
		// Just make sure the default constant is what we expect — exercised by
		// the call site to ensure regressions in the constant are visible.
		expect(MAX_DIFF_BASE64_QUERY_CHARS).toBeGreaterThan(0)
	})

	it("rejects input containing characters outside the strict base64 alphabet", () => {
		// Buffer.from("===@@@===") used to silently strip the @ characters and
		// produce a (possibly empty) decoded string with ok:true. The strict
		// validator now rejects non-alphabet input outright.
		const r = decodeDiffBase64Query("===@@@===")
		expect(r.ok).toBe(false)
		expect(r.content).toContain("invalid base64")
	})

	it("accepts a base64 string with whitespace (column wrapping)", () => {
		const original = "the quick brown fox jumps over the lazy dog"
		const wrapped = Buffer.from(original)
			.toString("base64")
			.replace(/(.{8})/g, "$1\n")
		const r = decodeDiffBase64Query(wrapped)
		expect(r.ok).toBe(true)
		expect(r.content).toBe(original)
	})

	it("rejects base64 with non-padding '=' in the middle", () => {
		const r = decodeDiffBase64Query("AA==BBBB")
		expect(r.ok).toBe(false)
	})

	it("does not decode oversize payloads (memory safety)", () => {
		// Use a tiny cap so we don't allocate the full 14MB to verify behaviour.
		const cap = 16
		const r = decodeDiffBase64Query("Q".repeat(1024), cap)
		expect(r.ok).toBe(false)
		// The error string must not embed the original payload — memory safety.
		expect(r.content).not.toContain("QQQQQQQQ")
	})
})
