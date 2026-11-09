import { describe, expect, it } from "vitest"

import { safeConnectOrigin } from "../safeCspOrigin"

const DEFAULT = "https://openrouter.ai"

describe("safeConnectOrigin", () => {
	it("returns the default origin for missing/undefined input", () => {
		expect(safeConnectOrigin(undefined)).toBe(DEFAULT)
		expect(safeConnectOrigin("")).toBe(DEFAULT)
	})

	it("normalizes a valid OpenRouter URL to its origin", () => {
		expect(safeConnectOrigin("https://openrouter.ai/api/v1")).toBe(DEFAULT)
		expect(safeConnectOrigin("https://openrouter.ai:443/some/path?x=1")).toBe(DEFAULT)
	})

	it("allows localhost/127.0.0.1 origins", () => {
		expect(safeConnectOrigin("http://localhost:4000/v1", true)).toBe("http://localhost:4000")
		expect(safeConnectOrigin("http://127.0.0.1:4000", true)).toBe("http://127.0.0.1:4000")
		expect(safeConnectOrigin("https://localhost:4000")).toBe("https://localhost:4000")
	})

	it("allows a custom HTTPS OpenRouter-compatible gateway", () => {
		expect(safeConnectOrigin("https://router.internal.example.com/api/v1")).toBe(
			"https://router.internal.example.com",
		)
	})

	it("rejects CSP directive injection payloads and unsafe schemes", () => {
		expect(safeConnectOrigin("https://evil.com; script-src 'unsafe-inline'")).toBe(DEFAULT)
		expect(safeConnectOrigin("javascript:alert(1)")).toBe(DEFAULT)
		expect(safeConnectOrigin("not a url")).toBe(DEFAULT)
	})

	it("rejects plain http for non-local hosts", () => {
		expect(safeConnectOrigin("http://openrouter.ai", true)).toBe(DEFAULT)
	})

	it("rejects http localhost unless explicitly allowed", () => {
		expect(safeConnectOrigin("http://localhost:4000")).toBe(DEFAULT)
	})

	it("never returns a value containing CSP metacharacters", () => {
		const candidates = [
			"https://evil.com; default-src *",
			"https://openrouter.ai' 'unsafe-inline",
			"https://user:pass@openrouter.ai",
		]
		for (const c of candidates) {
			const origin = safeConnectOrigin(c)
			expect(origin).not.toMatch(/[;'\s]/)
			expect(origin.startsWith("https://")).toBe(true)
		}
	})
})
