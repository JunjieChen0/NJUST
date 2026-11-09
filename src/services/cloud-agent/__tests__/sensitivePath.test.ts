import { describe, expect, it } from "vitest"

import { findSensitivePathReason } from "../sensitivePath"

describe("findSensitivePathReason", () => {
	it.each([
		".env",
		".env.local",
		".env.production",
		"config/.env",
		"config\\.env.local",
		"./.env",
		".npmrc",
		".pypirc",
		".netrc",
		"id_rsa",
		"keys/id_ed25519",
		"server.pem",
		"certs/client.p12",
		"certs/identity.key",
		".ssh/config",
		".aws/credentials",
		".gnupg/secring.gpg",
		".kube/config",
		".docker/config.json",
		"deploy/credentials.json",
		"deploy/secrets.yaml",
	])("rejects sensitive path %s", (p) => {
		expect(findSensitivePathReason(p)).toBeDefined()
	})

	it.each([
		".env.example",
		".env.sample",
		".env.template",
		"src/main.ts",
		"README.md",
		"package.json",
		"src/credentialStore.ts",
		"docs/secrets.md",
		".",
		"",
		"src/env.ts",
	])("allows non-secret path %s", (p) => {
		expect(findSensitivePathReason(p)).toBeUndefined()
	})

	it("normalizes Windows separators", () => {
		expect(findSensitivePathReason("config\\.aws\\credentials")).toBeDefined()
	})
})
