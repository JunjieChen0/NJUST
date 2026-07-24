import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createMockRequest, createMockCookies } from "./helpers/mock-factory"

vi.mock("next/headers", () => ({
	headers: vi.fn(),
	cookies: vi.fn(),
}))

vi.mock("next/server", () => ({
	NextResponse: {
		json: (body: unknown, init?: { status?: number }) => {
			return { status: init?.status ?? 200, body }
		},
	},
}))

const { requireAdminForAction, requireAdminForRequest, validateBasicAuthHeader, ADMIN_ACTOR } = await import(
	"../admin-auth"
)

describe("admin-auth", () => {
	beforeEach(() => {
		// Reset modules between tests
	})

	afterEach(() => {
		vi.restoreAllMocks()
		delete process.env.EVALS_ADMIN_SECRET
	})

	const validSecret = "a".repeat(32) // exactly 32 chars, meets minimum

	describe("requireAdminForAction", () => {
		it("rejects when no secret configured (fail-closed)", async () => {
			const { headers } = await import("next/headers")
			vi.mocked(headers).mockResolvedValue(new Headers() as never)

			await expect(requireAdminForAction()).rejects.toThrow("Security configuration missing")
		})

		it("rejects when secret is empty string (fail-closed)", async () => {
			process.env.EVALS_ADMIN_SECRET = ""
			const { headers } = await import("next/headers")
			vi.mocked(headers).mockResolvedValue(new Headers() as never)

			await expect(requireAdminForAction()).rejects.toThrow("Security configuration missing")
		})

		it("rejects when secret is a default/forbidden value", async () => {
			process.env.EVALS_ADMIN_SECRET = "changeme" // gitleaks:allow
			const { headers } = await import("next/headers")
			vi.mocked(headers).mockResolvedValue(new Headers() as never)

			await expect(requireAdminForAction()).rejects.toThrow("Security configuration invalid")
		})

		it("rejects when secret is too short (< 32 chars)", async () => {
			process.env.EVALS_ADMIN_SECRET = "short-secret" // gitleaks:allow
			const { headers } = await import("next/headers")
			vi.mocked(headers).mockResolvedValue(new Headers() as never)

			await expect(requireAdminForAction()).rejects.toThrow("Security configuration invalid")
		})

		it("rejects when no credential provided", async () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const { headers } = await import("next/headers")
			vi.mocked(headers).mockResolvedValue(new Headers() as never)

			await expect(requireAdminForAction()).rejects.toThrow("Unauthorized")
		})

		it("rejects wrong Basic auth credential", async () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const basicAuth = Buffer.from(`admin:wrong-secret`).toString("base64")
			const { headers } = await import("next/headers")
			vi.mocked(headers).mockResolvedValue(new Headers({ authorization: `Basic ${basicAuth}` }) as never)

			await expect(requireAdminForAction()).rejects.toThrow("Unauthorized")
		})

		it("accepts correct Basic auth credential", async () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const basicAuth = Buffer.from(`admin:${validSecret}`).toString("base64")
			const { headers } = await import("next/headers")
			vi.mocked(headers).mockResolvedValue(new Headers({ authorization: `Basic ${basicAuth}` }) as never)

			await expect(requireAdminForAction()).resolves.toBeUndefined()
		})

		it("rejects credential exceeding max length", async () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const longCredential = "x".repeat(300)
			const basicAuth = Buffer.from(`admin:${longCredential}`).toString("base64")
			const { headers } = await import("next/headers")
			vi.mocked(headers).mockResolvedValue(new Headers({ authorization: `Basic ${basicAuth}` }) as never)

			await expect(requireAdminForAction()).rejects.toThrow("Unauthorized")
		})

		it("does NOT accept x-evals-admin-secret header (removed)", async () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const { headers } = await import("next/headers")
			vi.mocked(headers).mockResolvedValue(new Headers({ "x-evals-admin-secret": validSecret }) as never)

			await expect(requireAdminForAction()).rejects.toThrow("Unauthorized")
		})

		it("does NOT accept cookie auth (removed)", async () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const { headers, cookies } = await import("next/headers")
			vi.mocked(headers).mockResolvedValue(new Headers() as never)
			vi.mocked(cookies).mockResolvedValue(createMockCookies({ evals_admin_token: validSecret }) as never)

			await expect(requireAdminForAction()).rejects.toThrow("Unauthorized")
		})
	})

	describe("requireAdminForRequest", () => {
		it("returns 503 when no secret configured", async () => {
			const request = createMockRequest("GET", "http://localhost/api/test")
			const response = await requireAdminForRequest(request)

			expect(response).not.toBeNull()
			expect(response!.status).toBe(503)
		})

		it("returns 401 when no credential provided", async () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const request = createMockRequest("GET", "http://localhost/api/test")
			const response = await requireAdminForRequest(request)

			expect(response).not.toBeNull()
			expect(response!.status).toBe(401)
		})

		it("returns null when correct Basic auth", async () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const basicAuth = Buffer.from(`admin:${validSecret}`).toString("base64")
			const request = createMockRequest("GET", "http://localhost/api/test", {
				authorization: `Basic ${basicAuth}`,
			})
			const response = await requireAdminForRequest(request)

			expect(response).toBeNull()
		})

		it("returns 401 for wrong Basic auth password", async () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const basicAuth = Buffer.from("admin:wrong-password").toString("base64")
			const request = createMockRequest("GET", "http://localhost/api/test", {
				authorization: `Basic ${basicAuth}`,
			})
			const response = await requireAdminForRequest(request)

			expect(response).not.toBeNull()
			expect(response!.status).toBe(401)
		})

		it("returns 401 for empty credential string", async () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const request = createMockRequest("GET", "http://localhost/api/test")
			const response = await requireAdminForRequest(request)

			expect(response).not.toBeNull()
			expect(response!.status).toBe(401)
		})
	})

	describe("validateBasicAuthHeader", () => {
		it("returns false when secret not configured", () => {
			expect(validateBasicAuthHeader(null)).toBe(false)
		})

		it("returns false for null header", () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			expect(validateBasicAuthHeader(null)).toBe(false)
		})

		it("returns false for non-Basic header", () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			expect(validateBasicAuthHeader("Bearer token123")).toBe(false)
		})

		it("returns true for correct Basic auth", () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const basicAuth = Buffer.from(`admin:${validSecret}`).toString("base64")
			expect(validateBasicAuthHeader(`Basic ${basicAuth}`)).toBe(true)
		})

		it("returns false for wrong password", () => {
			process.env.EVALS_ADMIN_SECRET = validSecret
			const basicAuth = Buffer.from("admin:wrong").toString("base64")
			expect(validateBasicAuthHeader(`Basic ${basicAuth}`)).toBe(false)
		})
	})

	describe("ADMIN_ACTOR", () => {
		it("is a stable identifier, not a secret", () => {
			expect(ADMIN_ACTOR).toBe("admin:evals")
			expect(ADMIN_ACTOR).not.toContain("secret")
			expect(ADMIN_ACTOR).not.toContain("password")
			expect(ADMIN_ACTOR).not.toContain("token")
		})
	})
})
