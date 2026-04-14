import { describe, expect, it } from "vitest"
import { assertSafeOutboundUrl } from "../networkGuard"

describe("assertSafeOutboundUrl", () => {
	it("allows public https URLs", async () => {
		await expect(assertSafeOutboundUrl("https://example.com")).resolves.toBeInstanceOf(URL)
	})

	it("blocks localhost", async () => {
		await expect(assertSafeOutboundUrl("http://localhost:3000")).rejects.toThrow(/Blocked local hostname/i)
	})

	it("blocks private IPv4", async () => {
		await expect(assertSafeOutboundUrl("http://192.168.1.10/api")).rejects.toThrow(/Blocked private/i)
	})
})
