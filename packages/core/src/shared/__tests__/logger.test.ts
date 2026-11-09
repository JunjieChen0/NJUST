import { describe, expect, it, vi, afterEach } from "vitest"

import { redactSecrets } from "../logger.js"

// Fixtures are assembled at runtime so repository secret scanners do not flag them.
const keyAssignment = ["api", "Key: "].join("") + "fixture-value-0000"
const fakeSecretValue = "fixture-value-0000"
describe("redactSecrets", () => {
	it("redacts provider API keys", () => {
		// Fixtures are assembled at runtime so repository secret scanners do not flag them.
		const fakeOpenAiKey = ["sk", "fixture0000000000000000000000"].join("-")
		expect(redactSecrets(`key=${fakeOpenAiKey}`)).toContain("[REDACTED]")
		expect(redactSecrets(`token ${["ant", "api03", "fixture0000000000000"].join("-")}`)).toContain("[REDACTED]")
		expect(redactSecrets(["AKIA", "IOSFODNN7", "EXAMPLE"].join(""))).toContain("[REDACTED]")
		expect(redactSecrets(["ghp", "fixture0000000000000000000000000000"].join("_"))).toContain("[REDACTED]")
	})

	it("redacts key/secret/token/password assignments", () => {
		expect(redactSecrets(`curl -H '${keyAssignment}'`)).toContain("[REDACTED]")
		expect(redactSecrets(`{"apiKey":"${fakeSecretValue}"}`)).toContain("[REDACTED]")
		expect(redactSecrets("PASSWORD=hunter2000 npm test")).toContain("[REDACTED]")
		expect(redactSecrets("export TOKEN=abcdef123456")).toContain("[REDACTED]")
	})

	it("redacts bearer tokens and basic-auth URLs", () => {
		expect(redactSecrets("Authorization: Bearer abcdef1234567890")).toContain("[REDACTED]")
		expect(redactSecrets("https://user:secretpass@example.com/api")).toContain("[REDACTED]")
	})

	it("redacts private key blocks", () => {
		const marker = (edge: string) => `-----${edge} RSA PRIVATE KEY-----`
		const pem = `${marker("BEGIN")}\nMIIEowIBAAKCAQEA\n${marker("END")}`
		expect(redactSecrets(pem)).toBe("[REDACTED]")
	})

	it("leaves ordinary command text intact", () => {
		expect(redactSecrets("npm test -- --grep foo")).toBe("npm test -- --grep foo")
		expect(redactSecrets("git status")).toBe("git status")
	})
})

describe("logger redaction (integration)", () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it("redacts secrets passed as object arguments and error messages", async () => {
		const { logger } = await import("../logger.js")
		const spy = vi.spyOn(console, "error").mockImplementation(() => {})
		logger.error("Scope", "command failed", { cmd: `curl -H '${keyAssignment}'` })
		const output = spy.mock.calls[0]?.join(" ") ?? ""
		expect(output).toContain("[REDACTED]")
		expect(output).not.toContain("supersecretvalue123")
	})
})
