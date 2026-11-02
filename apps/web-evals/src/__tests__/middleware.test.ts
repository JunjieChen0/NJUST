import { NextRequest } from "next/server"

vi.mock("@/lib/server/admin-auth", () => ({
	validateBasicAuthHeader: vi.fn().mockReturnValue(true),
}))

import { middleware } from "../middleware"

describe("middleware CSP", () => {
	it("forwards the CSP with the same nonce to the render request", () => {
		const response = middleware(new NextRequest("http://localhost:3446/runs"))

		const responseCsp = response.headers.get("content-security-policy")
		const nonce = responseCsp?.match(/'nonce-([^']+)'/)?.[1]
		expect(nonce).toBeTruthy()

		// Next applies request-header overrides from these internal headers;
		// its renderer reads the nonce from the request CSP.
		const overridden = response.headers.get("x-middleware-override-headers")?.split(",") ?? []
		expect(overridden).toContain("content-security-policy")
		expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(responseCsp)
		expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce)
	})
})
