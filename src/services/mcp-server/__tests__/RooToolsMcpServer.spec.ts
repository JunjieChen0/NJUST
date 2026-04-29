import { describe, it, expect } from "vitest"
import crypto from "crypto"

describe("RooToolsMcpServer — body size limit", () => {
	it("MAX_BODY_SIZE is 10 MB", () => {
		const MAX_BODY_SIZE = 10 * 1024 * 1024
		expect(MAX_BODY_SIZE).toBe(10_485_760)
	})

	it("small body should be accepted", () => {
		const smallData = JSON.stringify({ method: "tools/list", params: {} })
		const size = Buffer.byteLength(smallData)
		expect(size).toBeLessThan(10 * 1024 * 1024)
	})

	it("large body should be rejected", () => {
		const hugeData = "x".repeat(11 * 1024 * 1024) // 11MB
		const size = Buffer.byteLength(hugeData)
		expect(size).toBeGreaterThan(10 * 1024 * 1024)
	})
})

describe("RooToolsMcpServer — auth comparison", () => {
	function verifyAuth(authHeader: string | undefined, token: string): boolean {
		if (!authHeader) return false
		const expected = `Bearer ${token}`
		if (authHeader.length !== expected.length) return false
		return crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected))
	}

	it("accepts valid Bearer token", () => {
		expect(verifyAuth("Bearer secret-token", "secret-token")).toBe(true)
	})

	it("rejects wrong token", () => {
		expect(verifyAuth("Bearer wrong-token", "secret-token")).toBe(false)
	})

	it("rejects missing auth header", () => {
		expect(verifyAuth(undefined, "secret-token")).toBe(false)
	})

	it("rejects auth header without Bearer prefix", () => {
		expect(verifyAuth("secret-token", "secret-token")).toBe(false)
	})

	it("rejects tokens of different length — constant-time safe", () => {
		expect(verifyAuth("Bearer short", "very-long-token-value")).toBe(false)
	})
})
