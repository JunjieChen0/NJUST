/**
 * P11 Sensitive Info Leak Audit — Attack Path Tests
 *
 * Covers:
 * - filterSensitiveEnv: expanded pattern coverage
 * - isSensitiveEnvKey: credential/token/secret patterns
 * - sanitizeUrlForLog: URL credential redaction
 * - DANGEROUS_ENV_KEYS: library hijacking prevention
 * - mergeSafeEnv: dangerous key blocking
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { filterSensitiveEnv, sanitizeUrlForLog, mergeSafeEnv, DANGEROUS_ENV_KEYS } from "../env"

// ─── filterSensitiveEnv — expanded patterns ──────────────────────────────────

describe("filterSensitiveEnv — credential patterns", () => {
	beforeEach(() => {
		vi.stubEnv("TEST_TOKEN", "secret123")
		vi.stubEnv("TEST_SECRET", "mysecret")
		vi.stubEnv("TEST_PASSWORD", "pass")
		vi.stubEnv("TEST_API_KEY", "key123")
		vi.stubEnv("SONAR_TOKEN", "sonar-secret")
		vi.stubEnv("DATABASE_URL", "postgres://user:pass@db.example.com/mydb")
		vi.stubEnv("REDIS_URL", "redis://:pass@redis.example.com")
		vi.stubEnv("SENTRY_DSN", "https://key@sentry.io/123")
		vi.stubEnv("HF_TOKEN", "hf_xxx")
		vi.stubEnv("NJUST_CLOUD_KEY", "cloud-key-secret")
		vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "eyJ...")
		vi.stubEnv("CODECOV_TOKEN", "codecov-secret")
		vi.stubEnv("SAFE_VAR", "this-is-safe")
		vi.stubEnv("PATH", "/usr/bin")
	})

	it("strips _TOKEN suffix", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("TEST_TOKEN")
	})

	it("strips _SECRET suffix", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("TEST_SECRET")
	})

	it("strips _PASSWORD suffix", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("TEST_PASSWORD")
	})

	it("strips _API_KEY suffix", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("TEST_API_KEY")
	})

	it("strips SONAR_TOKEN", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("SONAR_TOKEN")
	})

	it("strips DATABASE_URL (connection string with creds)", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("DATABASE_URL")
	})

	it("strips REDIS_URL", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("REDIS_URL")
	})

	it("strips SENTRY_DSN", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("SENTRY_DSN")
	})

	it("strips HF_TOKEN", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("HF_TOKEN")
	})

	it("strips NJUST_CLOUD_KEY (project-specific pattern)", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("NJUST_CLOUD_KEY")
	})

	it("strips SUPABASE_SERVICE_ROLE_KEY", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY")
	})

	it("strips CODECOV_TOKEN", () => {
		const result = filterSensitiveEnv()
		expect(result).not.toHaveProperty("CODECOV_TOKEN")
	})

	it("preserves safe variables", () => {
		const result = filterSensitiveEnv()
		expect(result).toHaveProperty("SAFE_VAR", "this-is-safe")
	})

	it("preserves PATH", () => {
		const result = filterSensitiveEnv()
		expect(result).toHaveProperty("PATH")
	})
})

// ─── sanitizeUrlForLog ───────────────────────────────────────────────────────

describe("sanitizeUrlForLog — URL credential redaction", () => {
	it("strips username:password from URL", () => {
		const result = sanitizeUrlForLog("https://user:pass123@api.example.com/v1")
		expect(result).not.toContain("pass123")
		expect(result).toContain("***")
		expect(result).toContain("api.example.com")
	})

	it("strips username only", () => {
		const result = sanitizeUrlForLog("https://user@api.example.com/v1")
		expect(result).not.toContain("user@")
		expect(result).toContain("***")
	})

	it("preserves URL without credentials", () => {
		const result = sanitizeUrlForLog("https://api.example.com/v1/run")
		expect(result).toBe("https://api.example.com/v1/run")
	})

	it("handles http:// with credentials", () => {
		const result = sanitizeUrlForLog("http://admin:secret@internal.example.com:8080")
		expect(result).not.toContain("secret")
		expect(result).not.toContain("admin")
	})

	it("handles invalid URL gracefully", () => {
		const result = sanitizeUrlForLog("not-a-url")
		expect(result).toBe("not-a-url")
	})

	it("handles empty string", () => {
		const result = sanitizeUrlForLog("")
		expect(result).toBe("")
	})

	it("strips token in URL path-like format (fallback regex)", () => {
		// This is a malformed URL that won't parse with URL constructor
		const result = sanitizeUrlForLog("//user:token123@host.example.com")
		expect(result).not.toContain("token123")
	})
})

// ─── DANGEROUS_ENV_KEYS ─────────────────────────────────────────────────────

describe("DANGEROUS_ENV_KEYS — library hijacking prevention", () => {
	it("includes LD_PRELOAD", () => {
		expect(DANGEROUS_ENV_KEYS.has("LD_PRELOAD")).toBe(true)
	})

	it("includes LD_LIBRARY_PATH", () => {
		expect(DANGEROUS_ENV_KEYS.has("LD_LIBRARY_PATH")).toBe(true)
	})

	it("includes NODE_OPTIONS", () => {
		expect(DANGEROUS_ENV_KEYS.has("NODE_OPTIONS")).toBe(true)
	})

	it("includes DYLD_INSERT_LIBRARIES", () => {
		expect(DANGEROUS_ENV_KEYS.has("DYLD_INSERT_LIBRARIES")).toBe(true)
	})

	it("includes BASH_ENV", () => {
		expect(DANGEROUS_ENV_KEYS.has("BASH_ENV")).toBe(true)
	})
})

// ─── mergeSafeEnv — dangerous key blocking ───────────────────────────────────

describe("mergeSafeEnv — blocks dangerous keys", () => {
	it("drops LD_PRELOAD from user env", () => {
		const result = mergeSafeEnv({}, { LD_PRELOAD: "/evil/lib.so" })
		expect(result).not.toHaveProperty("LD_PRELOAD")
	})

	it("drops NODE_OPTIONS from user env", () => {
		const result = mergeSafeEnv({}, { NODE_OPTIONS: "--inspect" })
		expect(result).not.toHaveProperty("NODE_OPTIONS")
	})

	it("preserves safe user env variables", () => {
		const result = mergeSafeEnv({}, { MY_VAR: "safe_value" })
		expect(result).toHaveProperty("MY_VAR", "safe_value")
	})

	it("appends PATH instead of replacing", () => {
		const result = mergeSafeEnv({ PATH: "/usr/bin" }, { PATH: "/custom/bin" })
		expect(result.PATH).toContain("/custom/bin")
		expect(result.PATH).toContain("/usr/bin")
	})
})
