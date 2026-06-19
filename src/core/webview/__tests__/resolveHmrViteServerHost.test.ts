import { describe, expect, it } from "vitest"

import { resolveHmrViteServerHost } from "../resolveHmrViteServerHost"

describe("resolveHmrViteServerHost", () => {
	it("accepts a normal port", () => {
		const r = resolveHmrViteServerHost({ rawPort: "5174" })
		expect(r.ok).toBe(true)
		expect(r.host).toBe("localhost")
		expect(r.port).toBe(5174)
	})

	it("falls back to default when port file is missing", () => {
		const r = resolveHmrViteServerHost({ rawPort: undefined })
		expect(r.ok).toBe(false)
		expect(r.host).toBe("localhost")
		expect(r.port).toBe(5173)
	})

	it("falls back when raw port is null", () => {
		const r = resolveHmrViteServerHost({ rawPort: null })
		expect(r.ok).toBe(false)
		expect(r.port).toBe(5173)
	})

	it("falls back when port is empty after trim", () => {
		const r = resolveHmrViteServerHost({ rawPort: "   " })
		expect(r.ok).toBe(false)
		expect(r.reason).toMatch(/empty/)
	})

	it("rejects non-numeric port", () => {
		const r = resolveHmrViteServerHost({ rawPort: "0.0.0.0" })
		expect(r.ok).toBe(false)
		expect(r.host).toBe("localhost")
		expect(r.port).toBe(5173)
	})

	it("rejects negative port", () => {
		const r = resolveHmrViteServerHost({ rawPort: "-1" })
		expect(r.ok).toBe(false)
	})

	it("rejects port out of range", () => {
		const r = resolveHmrViteServerHost({ rawPort: "70000" })
		expect(r.ok).toBe(false)
	})

	it("rejects port with surrounding garbage that parseInt would accept", () => {
		// parseInt("5173abc") === 5173, but String(5173) !== "5173abc".
		const r = resolveHmrViteServerHost({ rawPort: "5173abc" })
		expect(r.ok).toBe(false)
	})

	it("rejects scientific notation that parseInt would accept", () => {
		const r = resolveHmrViteServerHost({ rawPort: "5.173e3" })
		expect(r.ok).toBe(false)
	})

	it("only ever returns loopback host", () => {
		// Even on success — paranoia check. Prevents future regressions where
		// someone wires an interface name through the helper.
		for (const candidate of ["1024", "5173", "65535"]) {
			const r = resolveHmrViteServerHost({ rawPort: candidate })
			expect(r.host).toBe("localhost")
		}
	})
})
