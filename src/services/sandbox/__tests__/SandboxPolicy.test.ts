import { describe, it, expect } from "vitest"
import { evaluatePolicy, resolveBackendForSource } from "../SandboxPolicy"
import { PolicyDeniedError } from "../SandboxErrors"
import type { PolicyConfig } from "../SandboxPolicy"

describe("SandboxPolicy", () => {
	// ─── evaluatePolicy ─────────────────────────────────────────────────

	describe("evaluatePolicy", () => {
		it("approves guarded-host backend always", () => {
			const config: PolicyConfig = { backend: "guarded-host", dockerStatus: "not-installed" }
			const decision = evaluatePolicy(config, "local")
			expect(decision.approved).toBe(true)
			expect(decision.backend).toBe("guarded-host")
		})

		it("approves docker backend when Docker is available", () => {
			const config: PolicyConfig = { backend: "docker", dockerStatus: "available" }
			const decision = evaluatePolicy(config, "local")
			expect(decision.approved).toBe(true)
			expect(decision.backend).toBe("docker")
		})

		it("denies docker backend when Docker daemon is not running (fail closed)", () => {
			const config: PolicyConfig = { backend: "docker", dockerStatus: "daemon-not-running" }
			expect(() => evaluatePolicy(config, "local")).toThrow(PolicyDeniedError)
		})

		it("denies docker backend when Docker is not installed (fail closed)", () => {
			const config: PolicyConfig = { backend: "docker", dockerStatus: "not-installed" }
			expect(() => evaluatePolicy(config, "local")).toThrow(PolicyDeniedError)
		})

		it("denies docker backend when Docker status is checking (fail closed)", () => {
			const config: PolicyConfig = { backend: "docker", dockerStatus: "checking" }
			expect(() => evaluatePolicy(config, "mcp")).toThrow(PolicyDeniedError)
		})

		it("includes reason in PolicyDeniedError", () => {
			const config: PolicyConfig = { backend: "docker", dockerStatus: "not-installed" }
			try {
				evaluatePolicy(config, "cloud-agent")
				expect.unreachable("Should have thrown")
			} catch (e) {
				expect(e).toBeInstanceOf(PolicyDeniedError)
				expect((e as PolicyDeniedError).message).toContain("not-installed")
			}
		})
	})

	// ─── resolveBackendForSource ──────────────────────────────────────────

	describe("resolveBackendForSource", () => {
		it("always returns guarded-host for internal source", () => {
			expect(resolveBackendForSource("docker", "internal")).toBe("guarded-host")
			expect(resolveBackendForSource("guarded-host", "internal")).toBe("guarded-host")
		})

		it("returns configured backend for local source", () => {
			expect(resolveBackendForSource("docker", "local")).toBe("docker")
			expect(resolveBackendForSource("guarded-host", "local")).toBe("guarded-host")
		})

		it("returns configured backend for cloud-agent source", () => {
			expect(resolveBackendForSource("docker", "cloud-agent")).toBe("docker")
		})

		it("returns configured backend for mcp source", () => {
			expect(resolveBackendForSource("docker", "mcp")).toBe("docker")
		})

		it("returns configured backend for user source", () => {
			expect(resolveBackendForSource("docker", "user")).toBe("docker")
		})
	})
})
