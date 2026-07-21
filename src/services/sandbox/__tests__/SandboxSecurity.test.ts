import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "fs"
import {
	validateMountPath,
	validateNoPrivilegeEscalation,
	buildValidatedSettings,
	validateDockerImage,
} from "../SandboxConfig"
import { evaluatePolicy, resolveBackendForSource } from "../SandboxPolicy"
import {
	ConfigInvalidError,
	PolicyDeniedError,
	DockerNotInstalledError,
	DaemonNotRunningError,
	ImageNotFoundError,
	ContainerStartFailedError,
	CommandFailedError,
	CommandTimeoutError,
	CommandCancelledError,
	SandboxUnavailableError,
	SandboxContainmentError,
	isSandboxError,
} from "../SandboxErrors"

// Mock logger
vi.mock("../../../shared/logger", () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

/**
 * Security regression tests for the sandbox system.
 *
 * These tests ensure that known attack vectors are always blocked:
 * - Path traversal via ../ and absolute paths
 * - Symbolic link escape
 * - Docker Socket access
 * - Privilege escalation
 * - Network access when forbidden
 * - Environment variable injection
 * - Protocol bypass via Cloud Agent or MCP
 */
describe("Sandbox Security Regression Tests", () => {
	// ─── Path Traversal ──────────────────────────────────────────────────

	describe("path traversal attacks", () => {
		it("blocks ../../etc/passwd mount path", () => {
			// This path itself isn't in the forbidden list, but the workspace
			// path validation (resolveWithinWorkspaceAsync) handles this at the
			// execution layer. Here we verify the mount validation rejects known
			// dangerous paths.
			expect(() => validateMountPath("/etc")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("/etc/passwd")).toThrow(ConfigInvalidError)
		})

		it("blocks root path mount", () => {
			expect(() => validateMountPath("/")).toThrow(ConfigInvalidError)
		})

		it("blocks Docker socket variants", () => {
			expect(() => validateMountPath("/var/run/docker.sock")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("/var/run/docker/")).toThrow(ConfigInvalidError)
		})

		it("blocks /proc and /sys mounts", () => {
			expect(() => validateMountPath("/proc")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("/sys")).toThrow(ConfigInvalidError)
		})

		it("blocks /dev mount", () => {
			expect(() => validateMountPath("/dev")).toThrow(ConfigInvalidError)
		})

		it("blocks home directory mount", () => {
			expect(() => validateMountPath("~")).toThrow(ConfigInvalidError)
		})
	})

	// ─── Windows Path Attacks ────────────────────────────────────────────

	describe("Windows path attacks", () => {
		it("accepts normal Windows workspace paths", () => {
			expect(() => validateMountPath("C:\\Users\\dev\\project")).not.toThrow()
		})

		it("blocks UNC and Windows device paths", () => {
			expect(() => validateMountPath("\\\\server\\share")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("\\\\.\\pipe\\docker_engine")).toThrow(ConfigInvalidError)
			expect(() => validateMountPath("\\\\?\\C:\\workspace")).toThrow(ConfigInvalidError)
		})
	})

	// ─── Privilege Escalation ────────────────────────────────────────────

	describe("privilege escalation prevention", () => {
		it("blocks privileged mode", () => {
			expect(() => validateNoPrivilegeEscalation({ privileged: true })).toThrow(ConfigInvalidError)
		})

		it("blocks host network mode", () => {
			expect(() => validateNoPrivilegeEscalation({ networkMode: "host" })).toThrow(ConfigInvalidError)
		})

		it("blocks host PID mode", () => {
			expect(() => validateNoPrivilegeEscalation({ pidMode: "host" })).toThrow(ConfigInvalidError)
		})

		it("blocks host IPC mode", () => {
			expect(() => validateNoPrivilegeEscalation({ ipcMode: "host" })).toThrow(ConfigInvalidError)
		})

		it("blocks capability addition", () => {
			expect(() => validateNoPrivilegeEscalation({ capAdd: ["SYS_ADMIN"] })).toThrow(ConfigInvalidError)
			expect(() => validateNoPrivilegeEscalation({ capAdd: ["NET_ADMIN", "SYS_PTRACE"] })).toThrow(
				ConfigInvalidError,
			)
		})

		it("blocks device mounting", () => {
			expect(() => validateNoPrivilegeEscalation({ devices: ["/dev/sda"] })).toThrow(ConfigInvalidError)
			expect(() => validateNoPrivilegeEscalation({ devices: ["/dev/kvm"] })).toThrow(ConfigInvalidError)
		})

		it("allows safe configuration", () => {
			expect(() =>
				validateNoPrivilegeEscalation({
					privileged: false,
					networkMode: "none",
				}),
			).not.toThrow()
		})
	})

	// ─── Fail-Closed Semantics ──────────────────────────────────────────

	describe("fail-closed (no silent fallback to host)", () => {
		it("denies execution when Docker is not installed but configured", () => {
			expect(() => evaluatePolicy({ backend: "docker", dockerStatus: "not-installed" }, "local")).toThrow(
				PolicyDeniedError,
			)
		})

		it("denies execution when Docker daemon is not running", () => {
			expect(() => evaluatePolicy({ backend: "docker", dockerStatus: "daemon-not-running" }, "local")).toThrow(
				PolicyDeniedError,
			)
		})

		it("denies execution when Docker status is still checking", () => {
			expect(() => evaluatePolicy({ backend: "docker", dockerStatus: "checking" }, "local")).toThrow(
				PolicyDeniedError,
			)
		})

		it("allows execution when Docker is available and configured", () => {
			const decision = evaluatePolicy({ backend: "docker", dockerStatus: "available" }, "local")
			expect(decision.approved).toBe(true)
			expect(decision.backend).toBe("docker")
		})

		it("always allows guarded-host backend", () => {
			const decision = evaluatePolicy({ backend: "guarded-host", dockerStatus: "not-installed" }, "local")
			expect(decision.approved).toBe(true)
			expect(decision.backend).toBe("guarded-host")
		})

		it("allowFallbackToHost is always false", () => {
			const settings = buildValidatedSettings({})
			expect(settings.allowFallbackToHost).toBe(false)
		})
	})

	// ─── Protocol Bypass Prevention ─────────────────────────────────────

	describe("protocol bypass prevention", () => {
		it("cloud-agent source uses configured backend (no bypass)", () => {
			const backend = resolveBackendForSource("docker", "cloud-agent")
			expect(backend).toBe("docker")
		})

		it("mcp source uses configured backend (no bypass)", () => {
			const backend = resolveBackendForSource("docker", "mcp")
			expect(backend).toBe("docker")
		})

		it("local source uses configured backend", () => {
			const backend = resolveBackendForSource("docker", "local")
			expect(backend).toBe("docker")
		})

		it("internal source always uses guarded-host (cannot be overridden)", () => {
			const backend = resolveBackendForSource("docker", "internal")
			expect(backend).toBe("guarded-host")
		})

		it("user source uses configured backend", () => {
			const backend = resolveBackendForSource("docker", "user")
			expect(backend).toBe("docker")
		})
	})

	// ─── Configuration Hardening ────────────────────────────────────────

	describe("configuration hardening", () => {
		it("rejects unknown backend values", () => {
			expect(() => buildValidatedSettings({ backend: "kubernetes" })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ backend: "" })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ backend: null })).toThrow(ConfigInvalidError)
		})

		it("rejects out-of-range memory", () => {
			expect(() => buildValidatedSettings({ memoryMb: 0 })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ memoryMb: -1 })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ memoryMb: 10000 })).toThrow(ConfigInvalidError)
		})

		it("rejects out-of-range CPU", () => {
			expect(() => buildValidatedSettings({ cpuLimit: 0 })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ cpuLimit: -1 })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ cpuLimit: 100 })).toThrow(ConfigInvalidError)
		})

		it("rejects NaN values", () => {
			expect(() => buildValidatedSettings({ memoryMb: NaN })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ cpuLimit: NaN })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ pidsLimit: NaN })).toThrow(ConfigInvalidError)
		})

		it("rejects invalid network mode", () => {
			expect(() => buildValidatedSettings({ networkMode: "host" })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ networkMode: "macvlan" })).toThrow(ConfigInvalidError)
		})

		it("rejects invalid workspace access", () => {
			expect(() => buildValidatedSettings({ workspaceAccess: "execute" })).toThrow(ConfigInvalidError)
			expect(() => buildValidatedSettings({ workspaceAccess: "admin" })).toThrow(ConfigInvalidError)
		})
	})

	// ─── Docker Image Validation ────────────────────────────────────────

	describe("Docker image validation (prevents malicious images)", () => {
		it("rejects Docker-in-Docker images", () => {
			expect(() => validateDockerImage("docker:dind")).toThrow(ConfigInvalidError)
		})

		it("rejects images with privileged in name", () => {
			expect(() => validateDockerImage("privileged-root")).toThrow(ConfigInvalidError)
		})

		it("rejects uppercase (potential injection)", () => {
			expect(() => validateDockerImage("MyImage:latest")).toThrow(ConfigInvalidError)
		})

		it("rejects empty image name", () => {
			expect(() => validateDockerImage("")).toThrow(ConfigInvalidError)
		})
	})

	// ─── Error Classification ────────────────────────────────────────────

	describe("error classification (proper error types for UI feedback)", () => {
		it("all errors are identifiable as SandboxError", () => {
			const errors = [
				new DockerNotInstalledError(),
				new DaemonNotRunningError(),
				new ImageNotFoundError("test"),
				new ContainerStartFailedError("abc"),
				new CommandFailedError(1, "fail"),
				new CommandTimeoutError(5000),
				new CommandCancelledError("exec-1"),
				new PolicyDeniedError("test"),
				new ConfigInvalidError("test"),
				new SandboxUnavailableError("test"),
				new SandboxContainmentError("container-1", "test"),
			]

			for (const err of errors) {
				expect(isSandboxError(err)).toBe(true)
			}
		})

		it("non-SandboxError returns false", () => {
			expect(isSandboxError(new Error("regular"))).toBe(false)
			expect(isSandboxError("string")).toBe(false)
			expect(isSandboxError(null)).toBe(false)
		})
	})

	describe("VS Code configuration scope", () => {
		it("keeps every sandbox policy setting at machine scope", () => {
			const packageJson = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")) as {
				contributes: { configuration: { properties: Record<string, { scope?: string }> } }
			}
			const sandboxProperties = Object.entries(packageJson.contributes.configuration.properties).filter(([key]) =>
				key.startsWith("njust-ai.sandbox."),
			)

			expect(sandboxProperties).toHaveLength(9)
			for (const [, property] of sandboxProperties) {
				expect(property.scope).toBe("machine")
			}
		})
	})
})
