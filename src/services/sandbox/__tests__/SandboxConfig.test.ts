import { describe, it, expect } from "vitest"
import { DEFAULT_SANDBOX_SETTINGS } from "@njust-ai/types"
import {
	validateDockerImage,
	validateMountPath,
	validateNoPrivilegeEscalation,
	buildValidatedSettings,
	DEFAULT_SETTINGS,
} from "../SandboxConfig"
import { ConfigInvalidError } from "../SandboxErrors"

describe("SandboxConfig", () => {
	// ─── Docker Image Validation ────────────────────────────────────────

	describe("validateDockerImage", () => {
		it("accepts simple image names", () => {
			expect(() => validateDockerImage("ubuntu")).not.toThrow()
			expect(() => validateDockerImage("njust-ai/sandbox")).not.toThrow()
			expect(() => validateDockerImage("njust-ai/sandbox:latest")).not.toThrow()
		})

		it("accepts images with tags", () => {
			expect(() => validateDockerImage("node:20-alpine")).not.toThrow()
			expect(() => validateDockerImage("python:3.12-slim")).not.toThrow()
		})

		it("accepts images with digest", () => {
			const digest = "sha256:" + "a".repeat(64)
			expect(() => validateDockerImage(`ubuntu@${digest}`)).not.toThrow()
		})

		it("accepts registry-prefixed images", () => {
			expect(() => validateDockerImage("registry.example.com/my/image:v1")).not.toThrow()
		})

		it("rejects empty image names", () => {
			expect(() => validateDockerImage("")).toThrow(ConfigInvalidError)
			expect(() => validateDockerImage("   ")).toThrow(ConfigInvalidError)
		})

		it("rejects Docker-in-Docker images", () => {
			expect(() => validateDockerImage("docker:dind")).toThrow(ConfigInvalidError)
		})

		it("rejects images with 'privileged' in name", () => {
			expect(() => validateDockerImage("privileged-container")).toThrow(ConfigInvalidError)
		})

		it("rejects images with uppercase letters", () => {
			expect(() => validateDockerImage("MyImage")).toThrow(ConfigInvalidError)
		})
	})

	// ─── Mount Path Validation ──────────────────────────────────────────

	describe("validateMountPath", () => {
		it("accepts normal workspace paths", () => {
			expect(() => validateMountPath("/home/user/project")).not.toThrow()
			expect(() => validateMountPath("C:\\Users\\dev\\project")).not.toThrow()
		})

		it("rejects Docker socket", () => {
			expect(() => validateMountPath("/var/run/docker.sock")).toThrow(ConfigInvalidError)
		})

		it("rejects root path", () => {
			expect(() => validateMountPath("/")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("C:\\")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("D:/")).toThrow(ConfigInvalidError)
		})

		it("rejects relative, UNC, and Windows device paths on every platform", () => {
			expect(() => validateMountPath("../workspace")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("\\\\server\\share\\project")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("\\\\.\\pipe\\docker_engine")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("\\\\?\\C:\\workspace")).toThrow(ConfigInvalidError)
		})

		it("rejects control characters and Docker mount separators", () => {
			expect(() => validateMountPath("/tmp/project\u0000escape")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("/tmp/project,readonly")).toThrow(ConfigInvalidError)
		})

		it("rejects home directory", () => {
			expect(() => validateMountPath("~")).toThrow(ConfigInvalidError)
		})

		it("rejects /etc", () => {
			expect(() => validateMountPath("/etc")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("/etc/project")).toThrow(ConfigInvalidError)
		})

		it("rejects /proc and /sys", () => {
			expect(() => validateMountPath("/proc")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("/sys")).toThrow(ConfigInvalidError)
		})

		it("rejects Docker-related paths", () => {
			expect(() => validateMountPath("/var/run/docker/")).toThrow(ConfigInvalidError)
		})
	})

	// ─── Privilege Escalation Prevention ────────────────────────────────

	describe("validateNoPrivilegeEscalation", () => {
		it("allows clean options", () => {
			expect(() =>
				validateNoPrivilegeEscalation({
					privileged: false,
					networkMode: "none",
				}),
			).not.toThrow()
		})

		it("rejects privileged mode", () => {
			expect(() => validateNoPrivilegeEscalation({ privileged: true })).toThrow(ConfigInvalidError)
		})

		it("rejects host network mode", () => {
			expect(() => validateNoPrivilegeEscalation({ networkMode: "host" })).toThrow(ConfigInvalidError)
		})

		it("rejects host PID mode", () => {
			expect(() => validateNoPrivilegeEscalation({ pidMode: "host" })).toThrow(ConfigInvalidError)
		})

		it("rejects host IPC mode", () => {
			expect(() => validateNoPrivilegeEscalation({ ipcMode: "host" })).toThrow(ConfigInvalidError)
		})

		it("rejects adding capabilities", () => {
			expect(() => validateNoPrivilegeEscalation({ capAdd: ["NET_ADMIN"] })).toThrow(ConfigInvalidError)
		})

		it("rejects device mounting", () => {
			expect(() => validateNoPrivilegeEscalation({ devices: ["/dev/sda"] })).toThrow(ConfigInvalidError)
		})
	})

	// ─── Settings Validation ────────────────────────────────────────────

	describe("buildValidatedSettings", () => {
		it("uses the shared sandbox defaults", () => {
			expect(DEFAULT_SETTINGS).toEqual({
				...DEFAULT_SANDBOX_SETTINGS,
				allowFallbackToHost: false,
			})
		})

		it("returns defaults for empty input", () => {
			const settings = buildValidatedSettings({})
			expect(settings.backend).toBe("guarded-host")
			expect(settings.dockerImage).toBe(DEFAULT_SETTINGS.dockerImage)
			expect(settings.memoryMb).toBe(512)
			expect(settings.cpuLimit).toBe(1.0)
			expect(settings.pidsLimit).toBe(256)
			expect(settings.timeoutSeconds).toBe(120)
			expect(settings.networkMode).toBe("none")
			expect(settings.workspaceAccess).toBe("read-write")
			expect(settings.taskScopedContainer).toBe(true)
			expect(settings.allowFallbackToHost).toBe(false)
		})

		it("accepts valid backend values", () => {
			expect(() => buildValidatedSettings({ backend: "guarded-host" })).not.toThrow()
			expect(() => buildValidatedSettings({ backend: "docker" })).not.toThrow()
		})

		it("rejects invalid backend", () => {
			expect(() => buildValidatedSettings({ backend: "kubernetes" })).toThrow(ConfigInvalidError)
		})

		it("accepts valid numeric ranges", () => {
			const settings = buildValidatedSettings({
				memoryMb: 256,
				cpuLimit: 2.0,
				pidsLimit: 512,
				timeoutSeconds: 300,
			})
			expect(settings.memoryMb).toBe(256)
			expect(settings.cpuLimit).toBe(2.0)
			expect(settings.pidsLimit).toBe(512)
			expect(settings.timeoutSeconds).toBe(300)
		})

		it("rejects memory below minimum", () => {
			expect(() => buildValidatedSettings({ memoryMb: 32 })).toThrow(ConfigInvalidError)
		})

		it("rejects memory above maximum", () => {
			expect(() => buildValidatedSettings({ memoryMb: 8192 })).toThrow(ConfigInvalidError)
		})

		it("rejects CPU below minimum", () => {
			expect(() => buildValidatedSettings({ cpuLimit: 0.01 })).toThrow(ConfigInvalidError)
		})

		it("rejects CPU above maximum", () => {
			expect(() => buildValidatedSettings({ cpuLimit: 16 })).toThrow(ConfigInvalidError)
		})

		it("rejects PIDs below minimum", () => {
			expect(() => buildValidatedSettings({ pidsLimit: 4 })).toThrow(ConfigInvalidError)
		})

		it("rejects timeout below minimum", () => {
			expect(() => buildValidatedSettings({ timeoutSeconds: 1 })).toThrow(ConfigInvalidError)
		})

		it("rejects timeout above maximum", () => {
			expect(() => buildValidatedSettings({ timeoutSeconds: 7200 })).toThrow(ConfigInvalidError)
		})

		it("rejects invalid network mode", () => {
			expect(() => buildValidatedSettings({ networkMode: "host" })).toThrow(ConfigInvalidError)
		})

		it("rejects invalid workspace access", () => {
			expect(() => buildValidatedSettings({ workspaceAccess: "execute" })).toThrow(ConfigInvalidError)
		})

		it("rejects non-boolean taskScopedContainer", () => {
			expect(() => buildValidatedSettings({ taskScopedContainer: "yes" })).toThrow(ConfigInvalidError)
		})

		it("always sets allowFallbackToHost to false", () => {
			const settings = buildValidatedSettings({})
			expect(settings.allowFallbackToHost).toBe(false)
		})

		it("rejects NaN numeric values", () => {
			expect(() => buildValidatedSettings({ memoryMb: NaN })).toThrow(ConfigInvalidError)
		})

		it("rejects infinite, fractional integer, coerced, and non-string values", () => {
			expect(() => buildValidatedSettings({ cpuLimit: Number.POSITIVE_INFINITY })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ memoryMb: 64.5 })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ pidsLimit: 16.5 })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ timeoutSeconds: 5.5 })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ memoryMb: "512" })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ dockerImage: 123 })).toThrow(ConfigInvalidError)
		})
	})
})
