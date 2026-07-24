import { describe, it, expect } from "vitest"
import {
	OperationalError,
	isOperationalError,
	toOperationalError,
	type OperationalErrorCode,
} from "../operational-error"

describe("OperationalError", () => {
	it("extends NamedError with correct name", () => {
		const err = new OperationalError("unauthorized", "Token missing")
		expect(err.name).toBe("OperationalError")
		expect(err instanceof Error).toBe(true)
		expect(err.message).toBe("Token missing")
	})

	it("stores code and safeMessage", () => {
		const err = new OperationalError("forbidden", "No access to resource X")
		expect(err.code).toBe("forbidden")
		expect(err.safeMessage).toBe("Access denied.")
	})

	it("toSafeSummary returns safe message", () => {
		const err = new OperationalError("resource_limit", "File too large: 50MB")
		const summary = err.toSafeSummary()
		expect(summary).toBe("[resource_limit] Resource limit exceeded.")
		expect(summary).not.toContain("50MB")
	})

	it("preserves cause via options", () => {
		const cause = new Error("network down")
		const err = new OperationalError("external_service", "Failed to fetch", { cause })
		expect(err.cause).toBe(cause)
	})

	it("supports all defined error codes", () => {
		const codes: OperationalErrorCode[] = [
			"unauthorized",
			"forbidden",
			"invalid_input",
			"resource_limit",
			"outside_workspace",
			"user_rejected",
			"timeout",
			"external_service",
			"internal",
		]
		for (const code of codes) {
			const err = new OperationalError(code, "test")
			expect(err.code).toBe(code)
			expect(err.safeMessage.length).toBeGreaterThan(0)
		}
	})
})

describe("isOperationalError", () => {
	it("returns true for OperationalError instances", () => {
		const err = new OperationalError("timeout", "timed out")
		expect(isOperationalError(err)).toBe(true)
	})

	it("returns false for generic errors", () => {
		expect(isOperationalError(new Error("generic"))).toBe(false)
		expect(isOperationalError("string")).toBe(false)
		expect(isOperationalError(null)).toBe(false)
		expect(isOperationalError(undefined)).toBe(false)
	})
})

describe("toOperationalError", () => {
	it("returns the same instance if already OperationalError", () => {
		const original = new OperationalError("forbidden", "denied")
		const result = toOperationalError(original)
		expect(result).toBe(original)
	})

	it("wraps generic errors as internal", () => {
		const result = toOperationalError(new Error("something broke"))
		expect(isOperationalError(result)).toBe(true)
		expect(result.code).toBe("internal")
		expect(result.message).toBe("something broke")
	})

	it("wraps non-error values", () => {
		const result = toOperationalError("string error")
		expect(isOperationalError(result)).toBe(true)
		expect(result.code).toBe("internal")
		expect(result.message).toBe("string error")
	})
})
