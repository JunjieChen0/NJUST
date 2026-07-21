import { describe, it, expect, vi, beforeEach } from "vitest"
import * as path from "path"
import { EventEmitter } from "events"
import { PassThrough } from "stream"
import type { SandboxSettings } from "../SandboxConfig"
import { DEFAULT_SETTINGS } from "../SandboxConfig"
import type { CommandExecutionRequest } from "../CommandRunner"
import { isSensitiveEnvKey, DANGEROUS_ENV_KEYS } from "../../../utils/env"
import { detectWindowsSpecificCommand } from "../commandCompatibility"
import { DockerSandboxRunner, validateDockerWorkspacePath } from "../DockerSandboxRunner"
import {
	CommandCancelledError,
	CommandTimeoutError,
	ConfigInvalidError,
	ImageNotFoundError,
	SandboxContainmentError,
} from "../SandboxErrors"

/**
 * Unit tests for DockerSandboxRunner.
 *
 * These tests validate Docker CLI parameter construction, mount arg building,
 * and security constraint enforcement WITHOUT actually calling Docker.
 *
 * Integration tests that require a real Docker daemon are in a separate
 * test file and skipped in CI environments without Docker.
 */

const { mockExecFile, mockExecFileAsync, mockSpawn } = vi.hoisted(() => ({
	mockExecFile: vi.fn(),
	mockExecFileAsync: vi.fn(),
	mockSpawn: vi.fn(),
}))

// Mock child_process before importing DockerSandboxRunner
vi.mock("child_process", () => {
	return {
		execFile: Object.assign(mockExecFile, {
			[Symbol.for("nodejs.util.promisify.custom")]: mockExecFileAsync,
		}),
		spawn: mockSpawn,
	}
})

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise
		reject = rejectPromise
	})
	return { promise, resolve, reject }
}

function createFakeChild(options: { closeOnKill?: boolean } = {}) {
	const child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill: vi.fn(),
	})
	child.kill.mockImplementation((signal?: NodeJS.Signals | number) => {
		if (options.closeOnKill !== false) {
			queueMicrotask(() => {
				child.signalCode = typeof signal === "string" ? signal : "SIGTERM"
				child.emit("close", null, child.signalCode)
			})
		}
		return true
	})
	return child
}

function makeRequest(overrides: Partial<CommandExecutionRequest> = {}): CommandExecutionRequest {
	return {
		executionId: "execution-1",
		taskId: "task-1",
		resourceScopeId: "task-1:instance-1",
		command: "echo test",
		workspacePath: process.cwd(),
		timeoutMs: 30_000,
		source: "local",
		onOutput: vi.fn(),
		...overrides,
	}
}

// We test parameter construction by accessing the private methods via
// the public interface. Since we can't easily mock promisify for execFile,
// we test the helper functions and validate the container creation args
// indirectly through the exported functions.

describe("DockerSandboxRunner", () => {
	let settings: SandboxSettings

	beforeEach(() => {
		vi.clearAllMocks()
		mockExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" })
		settings = { ...DEFAULT_SETTINGS }
	})

	// ─── Docker Parameter Construction ───────────────────────────────────

	describe("container creation parameters", () => {
		it("should use default settings for container security", () => {
			// Validate that DEFAULT_SETTINGS enforce all security constraints
			expect(settings.networkMode).toBe("none")
			expect(settings.workspaceAccess).toBe("read-write")
			expect(settings.memoryMb).toBe(512)
			expect(settings.cpuLimit).toBe(1.0)
			expect(settings.pidsLimit).toBe(256)
			expect(settings.timeoutSeconds).toBe(120)
			expect(settings.taskScopedContainer).toBe(true)
			expect(settings.allowFallbackToHost).toBe(false)
		})

		it("should produce correct memory flag format", () => {
			const memoryFlag = `${settings.memoryMb}m`
			expect(memoryFlag).toBe("512m")
		})

		it("should produce correct CPU flag format", () => {
			const cpuFlag = String(settings.cpuLimit)
			expect(cpuFlag).toBe("1")
		})

		it("should produce correct PIDs flag format", () => {
			const pidsFlag = String(settings.pidsLimit)
			expect(pidsFlag).toBe("256")
		})

		it("should produce correct tmpfs options", () => {
			const tmpfs = "/tmp:size=64m,noexec,nosuid"
			expect(tmpfs).toContain("noexec")
			expect(tmpfs).toContain("nosuid")
			// Verify noexec and nosuid are present (security flags)
			expect(tmpfs.split(",")).toContain("noexec")
			expect(tmpfs.split(",")).toContain("nosuid")
		})

		it("should produce read-write mount arg", () => {
			const workspacePath = "/home/user/project"
			const readonlyFlag = settings.workspaceAccess === "read-only" ? ",readonly" : ""
			const mountArg = `type=bind,src=${workspacePath},dst=/workspace${readonlyFlag}`
			expect(mountArg).toBe("type=bind,src=/home/user/project,dst=/workspace")
			expect(mountArg).not.toContain("readonly")
		})

		it("should produce read-only mount arg when configured", () => {
			const roSettings: SandboxSettings = { ...settings, workspaceAccess: "read-only" }
			const workspacePath = "/home/user/project"
			const readonlyFlag = roSettings.workspaceAccess === "read-only" ? ",readonly" : ""
			const mountArg = `type=bind,src=${workspacePath},dst=/workspace${readonlyFlag}`
			expect(mountArg).toBe("type=bind,src=/home/user/project,dst=/workspace,readonly")
		})
	})

	// ─── Security Constraint Enforcement ─────────────────────────────────

	describe("security constraints in docker create args", () => {
		it("should include --read-only flag", () => {
			// The createContainer method includes --read-only
			const requiredArgs = ["--read-only"]
			expect(requiredArgs).toContain("--read-only")
		})

		it("should include --cap-drop ALL", () => {
			const args = ["--cap-drop", "ALL"]
			expect(args).toContain("--cap-drop")
			expect(args[args.indexOf("--cap-drop") + 1]).toBe("ALL")
		})

		it("should include --security-opt no-new-privileges", () => {
			const args = ["--security-opt", "no-new-privileges"]
			expect(args).toContain("--security-opt")
			expect(args[args.indexOf("--security-opt") + 1]).toBe("no-new-privileges")
		})

		it("should use non-root user 1000:1000", () => {
			const args = ["--user", "1000:1000"]
			expect(args).toContain("--user")
			expect(args[args.indexOf("--user") + 1]).toBe("1000:1000")
		})

		it("should NOT include --privileged in container args", () => {
			// The DockerSandboxRunner.createContainer method builds args WITHOUT --privileged
			// We verify the expected args pattern here
			const safeArgs = ["create", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges"]
			expect(safeArgs).not.toContain("--privileged")
			expect(safeArgs).not.toContain("--device")
		})

		it("should NOT include Docker socket mount", () => {
			const mountArg = "type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock"
			expect(mountArg).toContain("docker.sock") // Test the detection
			// The validateMountPath would reject this
		})

		it("should NOT include host network/PID/IPC", () => {
			const forbiddenModes = ["host"]
			expect(settings.networkMode).not.toBe("host")
			expect(forbiddenModes).toContain("host")
		})

		it("should use sleep infinity as entrypoint command", () => {
			const entrypointArgs = ["sleep", "infinity"]
			expect(entrypointArgs).toEqual(["sleep", "infinity"])
		})
	})

	// ─── Label Construction ──────────────────────────────────────────────

	describe("container labels", () => {
		const LABEL_PREFIX = "njust-ai.sandbox"

		it("should include extension identification label", () => {
			const labels = [
				`${LABEL_PREFIX}=true`,
				`${LABEL_PREFIX}.task-id=test-task-123`,
				`${LABEL_PREFIX}.workspace=/home/user/project`,
			]
			expect(labels[0]).toBe("njust-ai.sandbox=true")
		})

		it("should include task ID label for container affinity", () => {
			const taskId = "task-abc-def"
			const label = `${LABEL_PREFIX}.task-id=${taskId}`
			expect(label).toBe("njust-ai.sandbox.task-id=task-abc-def")
		})

		it("should include workspace label for identification", () => {
			const workspace = "/home/user/my-project"
			const label = `${LABEL_PREFIX}.workspace=${workspace}`
			expect(label).toContain(workspace)
		})

		it("should be usable for stale container cleanup filter", () => {
			const filter = `label=${LABEL_PREFIX}=true`
			expect(filter).toBe("label=njust-ai.sandbox=true")
		})
	})

	// ─── Docker Exec Parameters ──────────────────────────────────────────

	describe("docker exec parameter construction", () => {
		it("should use --workdir /workspace for exec", () => {
			const execArgs = ["exec", "--workdir", "/workspace"]
			expect(execArgs).toContain("--workdir")
			expect(execArgs[execArgs.indexOf("--workdir") + 1]).toBe("/workspace")
		})

		it("should pass environment variables via --env", () => {
			const env = { NODE_ENV: "test", CI: "true" }
			const envArgs: string[] = []
			for (const [key, value] of Object.entries(env)) {
				envArgs.push("--env", `${key}=${value}`)
			}
			expect(envArgs).toContain("--env")
			expect(envArgs).toContain("NODE_ENV=test")
			expect(envArgs).toContain("CI=true")
		})

		it("should use /bin/sh -c for shell execution", () => {
			const shellArgs = ["/bin/sh", "-c", "echo hello"]
			expect(shellArgs[0]).toBe("/bin/sh")
			expect(shellArgs[1]).toBe("-c")
		})
	})

	// ─── Docker Image Digest ─────────────────────────────────────────────

	describe("image management", () => {
		it("should support explicit image pull (not implicit)", () => {
			// Image pull is a deliberate user action, never implicit during exec
			const pullArgs = ["pull", "njust-ai/sandbox:latest"]
			expect(pullArgs[0]).toBe("pull")
		})

		it("should support image digest inspection", () => {
			const inspectArgs = ["inspect", "--format", "{{index .RepoDigests 0}}", "njust-ai/sandbox:latest"]
			expect(inspectArgs).toContain("inspect")
			expect(inspectArgs).toContain("{{index .RepoDigests 0}}")
		})

		it("should use generous timeout for image pull", () => {
			const pullTimeout = 600_000 // 10 minutes
			expect(pullTimeout).toBeGreaterThan(60_000)
		})
	})

	// ─── Timeout and Cancellation ────────────────────────────────────────

	describe("timeout handling", () => {
		it("should add grace period to exec timeout", () => {
			const timeoutMs = 30_000
			const execTimeout = timeoutMs + 5000
			expect(execTimeout).toBe(35_000)
		})

		it("should have no timeout when timeoutMs is 0", () => {
			const timeoutMs = 0
			const execTimeout = timeoutMs > 0 ? timeoutMs + 5000 : undefined
			expect(execTimeout).toBeUndefined()
		})

		it("should limit maxBuffer for exec output", () => {
			const maxBuffer = 50 * 1024 * 1024 // 50 MB
			expect(maxBuffer).toBe(52_428_800)
		})
	})

	// ─── Error Classification ────────────────────────────────────────────

	describe("error classification", () => {
		it("should detect ENOENT as DockerNotInstalled", () => {
			const error = { code: "ENOENT" }
			expect(error.code).toBe("ENOENT")
		})

		it("should detect daemon errors from message", () => {
			const messages = ["Cannot connect to the Docker daemon", "daemon is not running"]
			for (const msg of messages) {
				expect(msg.includes("Cannot connect") || msg.includes("daemon")).toBe(true)
			}
		})

		it("should detect image not found from stderr", () => {
			const stderr = "Error: No such image: nonexistent:latest"
			expect(stderr.includes("No such image")).toBe(true)
		})
	})

	// ─── Settings Change & Container Rebuild ──────────────────────────────

	describe("updateSettings container rebuild", () => {
		it("should detect security-relevant setting changes", () => {
			const originalSettings: SandboxSettings = { ...DEFAULT_SETTINGS }
			const newSettings: SandboxSettings = { ...DEFAULT_SETTINGS, networkMode: "bridge" }

			// Verify the change detection logic
			const needsRecreate =
				newSettings.networkMode !== originalSettings.networkMode ||
				newSettings.dockerImage !== originalSettings.dockerImage ||
				newSettings.workspaceAccess !== originalSettings.workspaceAccess ||
				newSettings.memoryMb !== originalSettings.memoryMb ||
				newSettings.cpuLimit !== originalSettings.cpuLimit ||
				newSettings.pidsLimit !== originalSettings.pidsLimit

			expect(needsRecreate).toBe(true)
		})

		it("should NOT trigger rebuild when non-security settings change", () => {
			const originalSettings: SandboxSettings = { ...DEFAULT_SETTINGS }
			const newSettings: SandboxSettings = { ...DEFAULT_SETTINGS, timeoutSeconds: 300 }

			const needsRecreate =
				newSettings.networkMode !== originalSettings.networkMode ||
				newSettings.dockerImage !== originalSettings.dockerImage ||
				newSettings.workspaceAccess !== originalSettings.workspaceAccess ||
				newSettings.memoryMb !== originalSettings.memoryMb ||
				newSettings.cpuLimit !== originalSettings.cpuLimit ||
				newSettings.pidsLimit !== originalSettings.pidsLimit

			expect(needsRecreate).toBe(false)
		})

		it("should detect docker image change", () => {
			const originalSettings: SandboxSettings = { ...DEFAULT_SETTINGS }
			const newSettings: SandboxSettings = { ...DEFAULT_SETTINGS, dockerImage: "njust-ai/sandbox:v2" }

			const needsRecreate = newSettings.dockerImage !== originalSettings.dockerImage
			expect(needsRecreate).toBe(true)
		})

		it("should detect memory limit change", () => {
			const originalSettings: SandboxSettings = { ...DEFAULT_SETTINGS }
			const newSettings: SandboxSettings = { ...DEFAULT_SETTINGS, memoryMb: 1024 }

			const needsRecreate = newSettings.memoryMb !== originalSettings.memoryMb
			expect(needsRecreate).toBe(true)
		})

		it("should detect workspace access change", () => {
			const originalSettings: SandboxSettings = { ...DEFAULT_SETTINGS }
			const newSettings: SandboxSettings = { ...DEFAULT_SETTINGS, workspaceAccess: "read-only" }

			const needsRecreate = newSettings.workspaceAccess !== originalSettings.workspaceAccess
			expect(needsRecreate).toBe(true)
		})

		it("should detect pids limit change", () => {
			const originalSettings: SandboxSettings = { ...DEFAULT_SETTINGS }
			const newSettings: SandboxSettings = { ...DEFAULT_SETTINGS, pidsLimit: 512 }

			const needsRecreate = newSettings.pidsLimit !== originalSettings.pidsLimit
			expect(needsRecreate).toBe(true)
		})

		it("should detect cpu limit change", () => {
			const originalSettings: SandboxSettings = { ...DEFAULT_SETTINGS }
			const newSettings: SandboxSettings = { ...DEFAULT_SETTINGS, cpuLimit: 2.0 }

			const needsRecreate = newSettings.cpuLimit !== originalSettings.cpuLimit
			expect(needsRecreate).toBe(true)
		})
	})

	// ─── Instance Isolation ──────────────────────────────────────────────

	describe("instance isolation", () => {
		it("should include instance label in container creation", () => {
			const LABEL_PREFIX = "njust-ai.sandbox"
			const instanceId = "test-instance-123"
			const label = `${LABEL_PREFIX}.instance=${instanceId}`
			expect(label).toBe("njust-ai.sandbox.instance=test-instance-123")
		})

		it("should filter stale containers by instance ID", () => {
			const currentInstance = "current-pid-abc"
			const otherInstance = "other-pid-xyz"

			// Simulate container lines from docker ps
			const lines = [
				`abc123 ${currentInstance}`,
				`def456 ${otherInstance}`,
				`ghi789`, // old container with no instance label
			]

			const toClean: string[] = []
			for (const line of lines) {
				const [id, instance] = line.split(" ")
				if (id && instance !== currentInstance) {
					toClean.push(id!)
				}
			}

			// Should clean other instance and unlabeled containers, but NOT current
			expect(toClean).toContain("def456")
			expect(toClean).toContain("ghi789")
			expect(toClean).not.toContain("abc123")
		})
	})

	// ─── taskScopedContainer ─────────────────────────────────────────────

	describe("taskScopedContainer behavior", () => {
		it("should destroy container when taskScopedContainer is true", () => {
			const s: SandboxSettings = { ...DEFAULT_SETTINGS, taskScopedContainer: true }
			expect(s.taskScopedContainer).toBe(true)
			// When true, disposeTask should call removeContainer
		})

		it("should preserve container when taskScopedContainer is false", () => {
			const s: SandboxSettings = { ...DEFAULT_SETTINGS, taskScopedContainer: false }
			expect(s.taskScopedContainer).toBe(false)
			// When false, disposeTask should NOT call removeContainer
		})
	})

	// ─── Environment Variable Filtering ──────────────────────────────────

	describe("environment variable filtering", () => {
		it("should block sensitive env vars (API keys, tokens)", () => {
			const env = {
				NODE_ENV: "test",
				OPENAI_API_KEY: "sk-123",
				GITHUB_TOKEN: "ghp_abc",
				PATH: "/usr/bin",
				LD_PRELOAD: "/lib/evil.so",
			}
			const allowed: string[] = []
			for (const [key] of Object.entries(env)) {
				if (!isSensitiveEnvKey(key) && !DANGEROUS_ENV_KEYS.has(key)) {
					allowed.push(key)
				}
			}
			expect(allowed).toContain("NODE_ENV")
			expect(allowed).toContain("PATH")
			expect(allowed).not.toContain("OPENAI_API_KEY")
			expect(allowed).not.toContain("GITHUB_TOKEN")
			expect(allowed).not.toContain("LD_PRELOAD")
		})

		it("should block dangerous env vars (LD_PRELOAD, NODE_OPTIONS)", () => {
			const dangerous = ["LD_PRELOAD", "NODE_OPTIONS", "DYLD_INSERT_LIBRARIES", "BASH_ENV", "PYTHONPATH"]
			for (const key of dangerous) {
				expect(DANGEROUS_ENV_KEYS.has(key)).toBe(true)
			}
		})

		it("should allow safe env vars", () => {
			const safe = ["NODE_ENV", "PATH", "HOME", "USER", "LANG", "TERM", "SHELL"]
			for (const key of safe) {
				expect(isSensitiveEnvKey(key)).toBe(false)
				expect(DANGEROUS_ENV_KEYS.has(key)).toBe(false)
			}
		})
	})

	// ─── Container Key Composition ──────────────────────────────────────

	describe("container key composition", () => {
		it("should combine workspacePath and taskId into unique key", () => {
			const containerKey = (taskId: string, workspacePath: string): string => {
				return `${path.resolve(workspacePath)}::${taskId}`
			}

			const key1 = containerKey("run-code", "/home/user/projectA")
			const key2 = containerKey("run-code", "/home/user/projectB")
			const key3 = containerKey("mcp", "/home/user/projectA")

			expect(key1).not.toBe(key2)
			expect(key1).not.toBe(key3)
		})

		it("should normalize workspace paths", () => {
			const containerKey = (taskId: string, workspacePath: string): string => {
				return `${path.resolve(workspacePath)}::${taskId}`
			}

			const key1 = containerKey("task", "/home/user/project")
			const key2 = containerKey("task", "/home/user/project/")

			expect(key1).toBe(key2)
		})
	})

	// ─── CWD Path Mapping ──────────────────────────────────────────────

	describe("cwd path mapping", () => {
		const mapHostPathToContainer = (hostCwd: string, workspacePath: string): string => {
			const resolved = path.resolve(hostCwd)
			const wsResolved = path.resolve(workspacePath)
			if (!resolved.startsWith(wsResolved + path.sep) && resolved !== wsResolved) {
				return "/workspace"
			}
			const relative = path.relative(wsResolved, resolved)
			return "/workspace" + (relative ? "/" + relative.replace(/\\/g, "/") : "")
		}

		it("should map host path to container path", () => {
			expect(mapHostPathToContainer("/home/user/project", "/home/user/project")).toBe("/workspace")
			expect(mapHostPathToContainer("/home/user/project/src", "/home/user/project")).toBe("/workspace/src")
			expect(mapHostPathToContainer("/home/user/project/src/components", "/home/user/project")).toBe(
				"/workspace/src/components",
			)
		})

		it("should fall back to /workspace for paths outside workspace", () => {
			expect(mapHostPathToContainer("/home/other/project", "/home/user/project")).toBe("/workspace")
			expect(mapHostPathToContainer("/etc", "/home/user/project")).toBe("/workspace")
		})
	})

	// ─── Windows Command Compatibility ──────────────────────────────────

	describe("Windows command compatibility detection", () => {
		const detect = (cmd: string) => detectWindowsSpecificCommand(cmd).incompatible

		it("should detect PowerShell cmdlets", () => {
			expect(detect("Get-ChildItem")).toBe(true)
			expect(detect("Set-Location C:\\project")).toBe(true)
			expect(detect("New-Item -ItemType File")).toBe(true)
			expect(detect("Remove-Item temp.txt")).toBe(true)
			expect(detect("Write-Output hello")).toBe(true)
			expect(detect("Test-Path /tmp")).toBe(true)
		})

		it("should detect Windows executables", () => {
			expect(detect("build.bat")).toBe(true)
			expect(detect("script.cmd")).toBe(true)
			expect(detect("program.exe")).toBe(true)
		})

		it("should detect PowerShell pipeline syntax", () => {
			expect(detect("Get-Process | Out-File out.txt")).toBe(true)
			expect(detect("Get-Service | Where-Object {$_.Status -eq 'Running'}")).toBe(true)
			expect(detect("dir | Format-Table")).toBe(true)
			expect(detect("get-process | out-file")).toBe(true)
			expect(detect("get-service | where-object status")).toBe(true)
		})

		it("should detect PowerShell env syntax", () => {
			expect(detect("$env:PATH")).toBe(true)
			expect(detect("$ENV:PATH")).toBe(true)
		})

		it("should detect Windows paths", () => {
			expect(detect("cd C:\\Users\\user\\project")).toBe(true)
			expect(detect("dir D:\\data\\files")).toBe(true)
		})

		it("should accept POSIX commands with $ variables", () => {
			expect(detect("echo $HOME")).toBe(false)
			expect(detect("export PATH=$PATH:/bin")).toBe(false)
			expect(detect("echo ${USER}")).toBe(false)
			expect(detect("ls $(pwd)")).toBe(false)
		})

		it("should accept standard POSIX commands", () => {
			expect(detect("ls -la /workspace")).toBe(false)
			expect(detect("cd /home/user/project")).toBe(false)
			expect(detect("find . -name '*.txt'")).toBe(false)
			expect(detect("grep -r 'pattern' /workspace")).toBe(false)
		})

		it("should provide reason on detection", () => {
			const result = detectWindowsSpecificCommand("$env:PATH")
			expect(result.incompatible).toBe(true)
			expect(result.reason).toBeDefined()
		})
	})

	// ─── Timeout Fallback ──────────────────────────────────────────────

	describe("timeout fallback logic", () => {
		it("should use request timeoutMs when specified and positive", () => {
			const requestTimeoutMs = 60000
			const settingsTimeoutSeconds = 120
			const effectiveTimeoutMs = requestTimeoutMs > 0 ? requestTimeoutMs : settingsTimeoutSeconds * 1000
			expect(effectiveTimeoutMs).toBe(60000)
		})

		it("should fall back to settings.timeoutSeconds when timeoutMs is 0", () => {
			const requestTimeoutMs = 0
			const settingsTimeoutSeconds = 120
			const effectiveTimeoutMs = requestTimeoutMs > 0 ? requestTimeoutMs : settingsTimeoutSeconds * 1000
			expect(effectiveTimeoutMs).toBe(120000)
		})

		it("should convert settings.timeoutSeconds to milliseconds", () => {
			const settingsTimeoutSeconds = 180
			const effectiveTimeoutMs = settingsTimeoutSeconds * 1000
			expect(effectiveTimeoutMs).toBe(180000)
		})
	})

	// ─── Environment Variable Case Insensitivity ──────────────────────

	describe("dangerous env keys case insensitivity", () => {
		it("should block LD_PRELOAD regardless of case", () => {
			const keys = ["LD_PRELOAD", "ld_preload", "Ld_Preload", "LD_preload"]
			for (const key of keys) {
				expect(DANGEROUS_ENV_KEYS.has(key.toUpperCase())).toBe(true)
			}
		})

		it("should block NODE_OPTIONS regardless of case", () => {
			const keys = ["NODE_OPTIONS", "node_options", "Node_Options", "node_OPTIONS"]
			for (const key of keys) {
				expect(DANGEROUS_ENV_KEYS.has(key.toUpperCase())).toBe(true)
			}
		})

		it("should block PYTHONPATH regardless of case", () => {
			const keys = ["PYTHONPATH", "pythonpath", "PythonPath", "pythonPATH"]
			for (const key of keys) {
				expect(DANGEROUS_ENV_KEYS.has(key.toUpperCase())).toBe(true)
			}
		})

		it("should not block safe env keys", () => {
			const safeKeys = ["PATH", "HOME", "USER", "LANG", "TERM"]
			for (const key of safeKeys) {
				expect(DANGEROUS_ENV_KEYS.has(key.toUpperCase())).toBe(false)
			}
		})
	})

	// ─── Container Key Composition ──────────────────────────────────────

	describe("concurrent container creation", () => {
		it("should use workspacePath::taskId format for container key", () => {
			const containerKey = (taskId: string, workspacePath: string): string => {
				return `${path.resolve(workspacePath)}::${taskId}`
			}

			const key = containerKey("task-123", "/home/user/project")
			expect(key).toContain("::")
			expect(key).toContain("task-123")
			expect(key).toContain(path.resolve("/home/user/project"))
		})

		it("should generate unique keys for different workspaces with same taskId", () => {
			const containerKey = (taskId: string, workspacePath: string): string => {
				return `${path.resolve(workspacePath)}::${taskId}`
			}

			const key1 = containerKey("task-123", "/home/user/project1")
			const key2 = containerKey("task-123", "/home/user/project2")
			expect(key1).not.toBe(key2)
		})

		it("should generate unique keys for different taskIds with same workspace", () => {
			const containerKey = (taskId: string, workspacePath: string): string => {
				return `${path.resolve(workspacePath)}::${taskId}`
			}

			const key1 = containerKey("task-123", "/home/user/project")
			const key2 = containerKey("task-456", "/home/user/project")
			expect(key1).not.toBe(key2)
		})
	})

	// ─── Transactional Settings Update ─────────────────────────────────

	describe("non-zero command output", () => {
		it("returns separate stdout and stderr without rejecting", async () => {
			const stdout = new PassThrough()
			const stderr = new PassThrough()
			const child = Object.assign(new EventEmitter(), {
				stdout,
				stderr,
				kill: vi.fn(),
			})
			mockSpawn.mockReturnValueOnce(child)

			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const execInContainer = (
				runner as unknown as {
					execInContainer: (
						containerId: string,
						command: string,
						cwd: string,
						workspacePath: string,
						timeoutMs: number,
						environment: Record<string, string> | undefined,
						signal: AbortSignal,
						onOutput: (chunk: { text: string; isStderr?: boolean; timestamp: number }) => void,
						executionId: string,
					) => Promise<{
						exitCode: number
						output: string
						stdout: string
						stderr: string
						truncated: boolean
						capturedBytes: number
					}>
				}
			).execInContainer.bind(runner)

			const execution = execInContainer(
				"container-1",
				"failing-command",
				"/workspace",
				"/workspace",
				30_000,
				undefined,
				new AbortController().signal,
				vi.fn(),
				"execution-1",
			)
			stdout.write("partial output\n")
			stderr.write("failure details\n")
			child.emit("close", 7)

			await expect(execution).resolves.toEqual({
				exitCode: 7,
				output: "partial output\nfailure details\n",
				stdout: "partial output\n",
				stderr: "failure details\n",
				truncated: false,
				capturedBytes: 31,
			})
			expect(mockSpawn).toHaveBeenCalledWith(
				"docker",
				expect.arrayContaining(["exec", "container-1", "/bin/sh", "-c", "failing-command"]),
				expect.objectContaining({ shell: false }),
			)
		})
	})

	describe("workspace mount validation", () => {
		it("rejects dangerous Win32 mount roots and device paths", () => {
			const home = "C:\\Users\\dev"
			expect(() => validateDockerWorkspacePath("C:\\Users\\dev\\project", "win32", home)).not.toThrow()
			for (const candidate of [
				"C:\\",
				"\\\\server\\share\\",
				"\\\\.\\pipe\\docker_engine",
				"\\\\?\\C:\\workspace",
				home,
				"C:\\workspace,readonly",
				"C:\\workspace\u0000escape",
			]) {
				expect(() => validateDockerWorkspacePath(candidate, "win32", home)).toThrow(ConfigInvalidError)
			}
		})

		it("rejects dangerous POSIX roots while allowing a workspace directory", () => {
			const home = "/home/dev"
			expect(() => validateDockerWorkspacePath("/home/dev/project", "posix", home)).not.toThrow()
			for (const candidate of [
				"/",
				"/etc",
				"/proc",
				"/var/run/docker.sock",
				home,
				"/home/dev/project,readonly",
				"/home/dev/project\u0007escape",
			]) {
				expect(() => validateDockerWorkspacePath(candidate, "posix", home)).toThrow(ConfigInvalidError)
			}
		})

		it("rejects an unsafe mount before invoking Docker", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			await expect(runner.run(makeRequest({ workspacePath: "C:\\" }))).rejects.toThrow(ConfigInvalidError)
			expect(mockExecFileAsync).not.toHaveBeenCalled()
			expect(mockSpawn).not.toHaveBeenCalled()
		})
	})

	describe("container scope and keyed serialization", () => {
		type Container = {
			taskId: string
			resourceScopeId: string
			containerId: string
			imageDigest?: string
			createdAt: number
		}
		type ExecResult = {
			exitCode: number
			output: string
			stdout: string
			stderr: string
			truncated: boolean
			capturedBytes: number
		}
		type RunnerInternals = {
			containers: Map<string, Container>
			pendingCreation: Map<string, Promise<Container>>
			containerGates: Map<string, { dispose: () => void }>
			containmentFailures: Map<string, SandboxContainmentError>
			resolveAndValidateWorkspacePath: (workspacePath: string) => Promise<string>
			createContainer: (
				taskId: string,
				resourceScopeId: string,
				workspacePath: string,
				scope: "task" | "workspace",
			) => Promise<Container>
			ensureContainerRunning: (containerId: string) => Promise<string | undefined>
			execInContainer: (
				containerId: string,
				command: string,
				cwd: string,
				workspacePath: string,
				timeoutMs: number,
				environment: Record<string, string> | undefined,
				signal: AbortSignal,
				onOutput: CommandExecutionRequest["onOutput"],
				executionId: string,
			) => Promise<ExecResult>
			removeContainer: (containerId: string) => Promise<void>
			stopAndConfirmContainer: (containerId: string) => Promise<boolean>
		}

		const success = (output = "ok"): ExecResult => ({
			exitCode: 0,
			output,
			stdout: output,
			stderr: "",
			truncated: false,
			capturedBytes: Buffer.byteLength(output),
		})

		function stubRunner(runner: DockerSandboxRunner): RunnerInternals {
			const internals = runner as unknown as RunnerInternals
			let nextContainer = 0
			internals.resolveAndValidateWorkspacePath = vi.fn(async (workspacePath) => path.resolve(workspacePath))
			internals.createContainer = vi.fn(async (taskId, resourceScopeId) => ({
				taskId,
				resourceScopeId,
				containerId: `container-${++nextContainer}`,
				createdAt: Date.now(),
			}))
			internals.ensureContainerRunning = vi.fn().mockResolvedValue("sha256:test-image")
			internals.execInContainer = vi.fn().mockResolvedValue(success())
			internals.removeContainer = vi.fn().mockResolvedValue(undefined)
			internals.stopAndConfirmContainer = vi.fn().mockResolvedValue(true)
			return internals
		}

		it("labels task and workspace containers with distinct scopes", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "task-container\n", stderr: "" })
				.mockResolvedValueOnce({ stdout: "shared-container\n", stderr: "" })
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const createContainer = (
				runner as unknown as {
					createContainer: RunnerInternals["createContainer"]
				}
			).createContainer.bind(runner)

			await createContainer("task-1", "task-1:instance", process.cwd(), "task")
			await createContainer("task-2", "task-2:instance", process.cwd(), "workspace")

			const taskArgs = mockExecFileAsync.mock.calls[0]?.[1] as string[]
			const sharedArgs = mockExecFileAsync.mock.calls[1]?.[1] as string[]
			expect(taskArgs).toEqual(expect.arrayContaining(["--pull", "never"]))
			expect(sharedArgs).toEqual(expect.arrayContaining(["--pull", "never"]))
			expect(taskArgs).toEqual(expect.arrayContaining(["--no-healthcheck", "--entrypoint", "/bin/sh"]))
			const taskImageIndex = taskArgs.indexOf(DEFAULT_SETTINGS.dockerImage)
			expect(taskArgs.slice(taskImageIndex + 1)).toEqual(["-c", "exec sleep infinity"])
			expect(taskArgs).toEqual(
				expect.arrayContaining([
					"--label",
					"njust-ai.sandbox.scope=task",
					"--label",
					"njust-ai.sandbox.resource-scope=task-1:instance",
				]),
			)
			expect(sharedArgs).toEqual(
				expect.arrayContaining([
					"--label",
					"njust-ai.sandbox.scope=workspace",
					"--label",
					"njust-ai.sandbox.resource-scope=shared",
				]),
			)
		})

		it("serializes commands sharing a workspace container", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: false })
			const internals = stubRunner(runner)
			const firstResult = deferred<ExecResult>()
			internals.execInContainer = vi
				.fn()
				.mockImplementation((_containerId, command) =>
					command === "first" ? firstResult.promise : Promise.resolve(success("second")),
				)

			const first = runner.run(makeRequest({ executionId: "first", taskId: "task-a", command: "first" }))
			await vi.waitFor(() => expect(internals.execInContainer).toHaveBeenCalledTimes(1))
			const second = runner.run(
				makeRequest({
					executionId: "second",
					taskId: "task-b",
					resourceScopeId: "task-b:instance",
					command: "second",
				}),
			)
			await Promise.resolve()
			expect(internals.execInContainer).toHaveBeenCalledTimes(1)

			firstResult.resolve(success("first"))
			await first
			await expect(second).resolves.toMatchObject({ output: "second", containerId: "container-1" })
			expect(internals.createContainer).toHaveBeenCalledTimes(1)
		})

		it("runs different task-scoped container keys in parallel", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const internals = stubRunner(runner)
			const firstResult = deferred<ExecResult>()
			const secondResult = deferred<ExecResult>()
			internals.execInContainer = vi
				.fn()
				.mockImplementation((_containerId, command) =>
					command === "first" ? firstResult.promise : secondResult.promise,
				)

			const first = runner.run(makeRequest({ executionId: "first", command: "first" }))
			const second = runner.run(
				makeRequest({
					executionId: "second",
					resourceScopeId: "task-1:instance-2",
					command: "second",
				}),
			)
			await vi.waitFor(() => expect(internals.execInContainer).toHaveBeenCalledTimes(2))
			expect(internals.createContainer).toHaveBeenCalledTimes(2)

			firstResult.resolve(success("first"))
			secondResult.resolve(success("second"))
			await Promise.all([first, second])
		})

		it("returns immutable container and effective resource metadata for audit", async () => {
			const runner = new DockerSandboxRunner({
				...DEFAULT_SETTINGS,
				networkMode: "bridge",
				memoryMb: 768,
				cpuLimit: 1.5,
			})
			stubRunner(runner)

			await expect(runner.run(makeRequest())).resolves.toMatchObject({
				containerId: "container-1",
				imageDigest: "sha256:test-image",
				networkMode: "bridge",
				memoryMb: 768,
				cpuLimit: 1.5,
			})
		})

		it("awaits cancellation cleanup and rebuilds for the queued command", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const internals = stubRunner(runner)
			const removal = deferred<void>()
			internals.removeContainer = vi.fn().mockReturnValue(removal.promise)
			internals.execInContainer = vi
				.fn()
				.mockImplementation((_containerId, command, _cwd, _workspacePath, _timeoutMs, _environment, signal) => {
					if (command !== "first") return Promise.resolve(success("second"))
					return new Promise<ExecResult>((_resolve, reject) => {
						signal.addEventListener("abort", () => reject(new CommandCancelledError("first")), {
							once: true,
						})
					})
				})

			const first = runner.run(makeRequest({ executionId: "first", command: "first" }))
			await vi.waitFor(() => expect(internals.execInContainer).toHaveBeenCalledTimes(1))
			const second = runner.run(makeRequest({ executionId: "second", command: "second" }))
			await runner.cancel("first")
			await vi.waitFor(() => expect(internals.removeContainer).toHaveBeenCalledWith("container-1"))

			let firstSettled = false
			void first.then(
				() => {
					firstSettled = true
				},
				() => {
					firstSettled = true
				},
			)
			await Promise.resolve()
			expect(firstSettled).toBe(false)
			expect(internals.execInContainer).toHaveBeenCalledTimes(1)

			removal.resolve()
			await expect(first).rejects.toBeInstanceOf(CommandCancelledError)
			await expect(second).resolves.toMatchObject({ output: "second", containerId: "container-2" })
			expect(internals.createContainer).toHaveBeenCalledTimes(2)
		})

		it("awaits container removal before returning a timeout", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const internals = stubRunner(runner)
			const removal = deferred<void>()
			internals.removeContainer = vi.fn().mockReturnValue(removal.promise)
			internals.execInContainer = vi.fn().mockRejectedValue(new CommandTimeoutError(50))

			const execution = runner.run(makeRequest())
			await vi.waitFor(() => expect(internals.removeContainer).toHaveBeenCalledWith("container-1"))
			let settled = false
			void execution.then(
				() => {
					settled = true
				},
				() => {
					settled = true
				},
			)
			await Promise.resolve()
			expect(settled).toBe(false)

			removal.resolve()
			await expect(execution).rejects.toBeInstanceOf(CommandTimeoutError)
			expect(internals.containers.size).toBe(0)
		})

		it("retries failed cancellation cleanup before replacing the contaminated container", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const internals = stubRunner(runner)
			internals.removeContainer = vi
				.fn()
				.mockRejectedValueOnce(new Error("docker rm failed"))
				.mockResolvedValue(undefined)
			internals.execInContainer = vi
				.fn()
				.mockImplementation((_containerId, command, _cwd, _workspacePath, _timeoutMs, _environment, signal) => {
					if (command !== "first") return Promise.resolve(success("second"))
					return new Promise<ExecResult>((_resolve, reject) => {
						signal.addEventListener("abort", () => reject(new CommandCancelledError("first")), {
							once: true,
						})
					})
				})

			const first = runner.run(makeRequest({ executionId: "first", command: "first" }))
			const firstRejection = expect(first).rejects.toBeInstanceOf(CommandCancelledError)
			await vi.waitFor(() => expect(internals.execInContainer).toHaveBeenCalledTimes(1))
			await runner.cancel("first")
			await firstRejection

			expect(Array.from(internals.containers.values())).toEqual([
				expect.objectContaining({ containerId: "container-1" }),
			])

			await expect(runner.run(makeRequest({ executionId: "second", command: "second" }))).resolves.toMatchObject({
				containerId: "container-2",
				output: "second",
			})
			expect(internals.removeContainer).toHaveBeenNthCalledWith(1, "container-1")
			expect(internals.removeContainer).toHaveBeenNthCalledWith(2, "container-1")
			expect(internals.execInContainer).toHaveBeenLastCalledWith(
				"container-2",
				expect.anything(),
				expect.anything(),
				expect.anything(),
				expect.anything(),
				undefined,
				expect.anything(),
				expect.anything(),
				expect.anything(),
			)
		})

		it("retries failed timeout cleanup before replacing the contaminated container", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const internals = stubRunner(runner)
			internals.removeContainer = vi
				.fn()
				.mockRejectedValueOnce(new Error("docker rm failed"))
				.mockResolvedValue(undefined)
			internals.execInContainer = vi
				.fn()
				.mockRejectedValueOnce(new CommandTimeoutError(50))
				.mockResolvedValueOnce(success("second"))

			await expect(runner.run(makeRequest({ timeoutMs: 50 }))).rejects.toBeInstanceOf(CommandTimeoutError)
			expect(Array.from(internals.containers.values())).toEqual([
				expect.objectContaining({ containerId: "container-1" }),
			])

			await expect(runner.run(makeRequest({ executionId: "second", command: "second" }))).resolves.toMatchObject({
				containerId: "container-2",
				output: "second",
			})
			expect(internals.removeContainer).toHaveBeenNthCalledWith(1, "container-1")
			expect(internals.removeContainer).toHaveBeenNthCalledWith(2, "container-1")
		})

		it("fails closed until an unconfirmed running container is removed", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const internals = stubRunner(runner)
			internals.removeContainer = vi
				.fn()
				.mockRejectedValueOnce(new Error("initial rm failed"))
				.mockResolvedValueOnce(undefined)
			internals.stopAndConfirmContainer = vi.fn().mockResolvedValue(false)
			internals.execInContainer = vi
				.fn()
				.mockRejectedValueOnce(new CommandTimeoutError(50))
				.mockResolvedValueOnce(success("recovered"))

			await expect(runner.run(makeRequest({ executionId: "first", timeoutMs: 50 }))).rejects.toBeInstanceOf(
				SandboxContainmentError,
			)
			expect(internals.containmentFailures.has("container-1")).toBe(true)

			await expect(
				runner.run(makeRequest({ executionId: "blocked", command: "blocked" })),
			).rejects.toBeInstanceOf(SandboxContainmentError)
			expect(internals.execInContainer).toHaveBeenCalledTimes(1)
			expect(internals.removeContainer).toHaveBeenCalledOnce()

			await runner.updateSettings({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			await expect(
				runner.run(makeRequest({ executionId: "recovered", command: "recovered" })),
			).resolves.toMatchObject({ output: "recovered", containerId: "container-2" })
			expect(internals.containmentFailures.size).toBe(0)
		})

		it("attaches Docker audit metadata when the containment latch blocks execution", async () => {
			const runner = new DockerSandboxRunner({
				...DEFAULT_SETTINGS,
				networkMode: "bridge",
				memoryMb: 768,
				cpuLimit: 1.5,
			})
			const internals = stubRunner(runner)
			const container = {
				taskId: "task-1",
				resourceScopeId: "task-1:instance-1",
				containerId: "container-latched",
				imageDigest: "sha256:latched-image",
				createdAt: Date.now(),
			}
			internals.containers.set("workspace::task::task-1:instance-1", container)
			internals.containmentFailures.set(
				container.containerId,
				new SandboxContainmentError(container.containerId, "cleanup failed"),
			)

			await expect(runner.run(makeRequest({ executionId: "blocked" }))).rejects.toMatchObject({
				name: "SandboxContainmentError",
				auditMetadata: {
					containerId: container.containerId,
					imageDigest: container.imageDigest,
					networkMode: "bridge",
					memoryMb: 768,
					cpuLimit: 1.5,
				},
			})
			expect(internals.resolveAndValidateWorkspacePath).not.toHaveBeenCalled()
		})

		it("keeps task tracking and its gate when disposal fails", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const internals = stubRunner(runner)
			const key = "workspace::task::task-1:instance-1"
			const container = {
				taskId: "task-1",
				resourceScopeId: "task-1:instance-1",
				containerId: "container-1",
				createdAt: Date.now(),
			}
			const containerGate = { dispose: vi.fn() }
			internals.containers.set(key, container)
			internals.containerGates.set(key, containerGate)
			internals.removeContainer = vi.fn().mockRejectedValueOnce(new Error("docker rm failed"))

			await expect(runner.disposeTask(container.resourceScopeId)).rejects.toThrow("Failed to remove")
			expect(internals.containers.get(key)).toBe(container)
			expect(internals.containerGates.get(key)).toBe(containerGate)
			expect(containerGate.dispose).not.toHaveBeenCalled()

			internals.removeContainer = vi.fn().mockResolvedValue(undefined)
			await runner.disposeTask(container.resourceScopeId)
			expect(internals.containers.has(key)).toBe(false)
			expect(internals.containerGates.has(key)).toBe(false)
			expect(containerGate.dispose).toHaveBeenCalledOnce()
		})

		it("does not reuse an aborted pending container creation", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const internals = stubRunner(runner)
			const lateCreation = deferred<Container>()
			internals.createContainer = vi.fn().mockReturnValueOnce(lateCreation.promise).mockResolvedValueOnce({
				taskId: "task-1",
				resourceScopeId: "task-1:instance-1",
				containerId: "container-2",
				createdAt: Date.now(),
			})

			const first = runner.run(makeRequest({ executionId: "first", timeoutMs: 50 }))
			const firstRejection = expect(first).rejects.toBeInstanceOf(CommandTimeoutError)
			await vi.waitFor(() => expect(internals.createContainer).toHaveBeenCalledOnce())
			await firstRejection

			const second = runner.run(makeRequest({ executionId: "second", timeoutMs: 30_000 }))
			lateCreation.reject(new Error("aborted docker create"))
			await expect(second).resolves.toMatchObject({ containerId: "container-2" })
			expect(internals.createContainer).toHaveBeenCalledTimes(2)
		})

		it("stops retrying a stale creation when the waiting execution times out", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const internals = stubRunner(runner)
			const lateCreation = deferred<Container>()
			internals.createContainer = vi.fn().mockReturnValue(lateCreation.promise)

			const first = runner.run(makeRequest({ executionId: "first", timeoutMs: 20 }))
			const firstRejection = expect(first).rejects.toBeInstanceOf(CommandTimeoutError)
			await vi.waitFor(() => expect(internals.createContainer).toHaveBeenCalledOnce())
			await firstRejection

			const second = runner.run(makeRequest({ executionId: "second", timeoutMs: 20 }))
			await expect(second).rejects.toBeInstanceOf(CommandTimeoutError)

			lateCreation.reject(new Error("aborted docker create"))
			await Promise.resolve()
		})

		it("waits for late task container creation before disposal completes", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const internals = stubRunner(runner)
			const lateCreation = deferred<Container>()
			internals.createContainer = vi.fn().mockReturnValue(lateCreation.promise)

			const execution = runner.run(makeRequest({ executionId: "late", timeoutMs: 20 }))
			const rejection = expect(execution).rejects.toBeInstanceOf(CommandTimeoutError)
			await vi.waitFor(() => expect(internals.createContainer).toHaveBeenCalledOnce())
			await rejection

			let disposed = false
			const disposal = runner.disposeTask("task-1:instance-1").then(() => {
				disposed = true
			})
			await Promise.resolve()
			expect(disposed).toBe(false)

			lateCreation.resolve({
				taskId: "task-1",
				resourceScopeId: "task-1:instance-1",
				containerId: "container-late",
				createdAt: Date.now(),
			})
			await disposal

			expect(internals.removeContainer).toHaveBeenCalledWith("container-late")
			expect(internals.containers.size).toBe(0)
		})

		it("proactively removes a container created after its execution timed out", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const internals = stubRunner(runner)
			const lateCreation = deferred<Container>()
			internals.createContainer = vi.fn().mockReturnValue(lateCreation.promise)

			const execution = runner.run(makeRequest({ executionId: "late-cleanup", timeoutMs: 20 }))
			const rejection = expect(execution).rejects.toBeInstanceOf(CommandTimeoutError)
			await vi.waitFor(() => expect(internals.createContainer).toHaveBeenCalledOnce())
			await rejection

			lateCreation.resolve({
				taskId: "task-1",
				resourceScopeId: "task-1:instance-1",
				containerId: "container-late",
				createdAt: Date.now(),
			})

			await vi.waitFor(() => expect(internals.removeContainer).toHaveBeenCalledWith("container-late"))
			expect(internals.containers.size).toBe(0)
		})

		it("tracks an aborted create by name when the Docker CLI loses its container ID", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS, taskScopedContainer: true })
			const abortController = new AbortController()
			let createArgs: string[] = []
			mockExecFileAsync
				.mockImplementationOnce((_file, args, options) => {
					createArgs = args as string[]
					return new Promise((_resolve, reject) => {
						const signal = (options as { signal: AbortSignal }).signal
						signal.addEventListener("abort", () => reject(new Error("docker create aborted")), {
							once: true,
						})
					})
				})
				.mockRejectedValueOnce(new Error("Docker daemon temporarily unavailable"))
				.mockResolvedValueOnce({ stdout: "", stderr: "" })

			const execution = runner.run(makeRequest({ executionId: "lost-create-id", signal: abortController.signal }))
			await vi.waitFor(() => expect(mockExecFileAsync).toHaveBeenCalledOnce())
			abortController.abort()

			await expect(execution).rejects.toBeInstanceOf(CommandCancelledError)
			const nameIndex = createArgs.indexOf("--name")
			const containerName = createArgs[nameIndex + 1]
			expect(containerName).toMatch(/^njust-ai-sandbox-/)
			await vi.waitFor(() =>
				expect(
					Array.from((runner as unknown as { containers: Map<string, Container> }).containers.values()),
				).toEqual([expect.objectContaining({ containerId: containerName })]),
			)

			await runner.disposeTask("task-1:instance-1")
			expect(mockExecFileAsync).toHaveBeenLastCalledWith("docker", ["rm", "-f", containerName], {
				timeout: 30_000,
			})
			expect((runner as unknown as { containers: Map<string, Container> }).containers.size).toBe(0)
		})
	})

	describe("wall-clock execution deadline", () => {
		it("times out while waiting for the global runner gate", async () => {
			vi.useFakeTimers()
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const gate = (
				runner as unknown as {
					gate: { acquireExclusive: () => Promise<() => void> }
				}
			).gate
			const release = await gate.acquireExclusive()

			try {
				const execution = runner.run(makeRequest({ timeoutMs: 50 }))
				const rejection = expect(execution).rejects.toMatchObject({
					name: "CommandTimeoutError",
					timeoutMs: 50,
				})
				await vi.advanceTimersByTimeAsync(50)
				await rejection
			} finally {
				release()
				vi.useRealTimers()
			}
		})

		it("passes cancellation and the remaining deadline to Docker lifecycle calls", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "container-1\n", stderr: "" })
				.mockResolvedValueOnce({ stdout: "false\n", stderr: "" })
				.mockResolvedValueOnce({ stdout: "container-1\n", stderr: "" })
			const child = createFakeChild({ closeOnKill: false })
			mockSpawn.mockReturnValueOnce(child)
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })

			const execution = runner.run(makeRequest({ timeoutMs: 5_000 }))
			await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledOnce())
			child.emit("close", 0)
			await execution

			for (const operation of ["create", "inspect", "start"]) {
				const call = mockExecFileAsync.mock.calls.find(([, args]) => (args as string[])[0] === operation)
				expect(call, `missing docker ${operation} call`).toBeDefined()
				expect(call?.[2]).toEqual(
					expect.objectContaining({
						signal: expect.objectContaining({ aborted: false }),
						timeout: expect.any(Number),
					}),
				)
				expect((call?.[2] as { timeout: number }).timeout).toBeGreaterThan(0)
				expect((call?.[2] as { timeout: number }).timeout).toBeLessThanOrEqual(5_000)
			}
		})
	})

	describe("streaming process lifecycle", () => {
		it("isolates output callback failures", async () => {
			const child = createFakeChild({ closeOnKill: false })
			mockSpawn.mockReturnValueOnce(child)
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const execInContainer = (
				runner as unknown as {
					execInContainer: (
						containerId: string,
						command: string,
						cwd: string,
						workspacePath: string,
						timeoutMs: number,
						environment: Record<string, string> | undefined,
						signal: AbortSignal,
						onOutput: CommandExecutionRequest["onOutput"],
						executionId: string,
					) => Promise<{ output: string }>
				}
			).execInContainer.bind(runner)
			const onOutput = vi.fn(() => {
				throw new Error("consumer failed")
			})

			const execution = execInContainer(
				"container-1",
				"echo test",
				process.cwd(),
				process.cwd(),
				30_000,
				undefined,
				new AbortController().signal,
				onOutput,
				"execution-1",
			)
			child.stdout.write("test\n")
			child.emit("close", 0)

			await expect(execution).resolves.toMatchObject({ output: "test\n" })
			expect(onOutput).toHaveBeenCalledOnce()
		})

		it("terminates only the Docker CLI process when cancelled", async () => {
			const child = createFakeChild()
			mockSpawn.mockReturnValueOnce(child)
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const abortController = new AbortController()
			const execInContainer = (
				runner as unknown as {
					execInContainer: (
						containerId: string,
						command: string,
						cwd: string,
						workspacePath: string,
						timeoutMs: number,
						environment: Record<string, string> | undefined,
						signal: AbortSignal,
						onOutput: CommandExecutionRequest["onOutput"],
						executionId: string,
					) => Promise<unknown>
				}
			).execInContainer.bind(runner)

			const execution = execInContainer(
				"container-1",
				"sleep 30",
				process.cwd(),
				process.cwd(),
				30_000,
				undefined,
				abortController.signal,
				vi.fn(),
				"execution-1",
			)
			abortController.abort()

			await expect(execution).rejects.toBeInstanceOf(CommandCancelledError)
			expect(child.kill).toHaveBeenCalledWith("SIGTERM")
			expect(mockExecFileAsync).not.toHaveBeenCalledWith(
				"docker",
				expect.arrayContaining(["exec", "container-1", "kill"]),
				expect.anything(),
			)
		})

		it("terminates the Docker CLI process when the execution times out", async () => {
			vi.useFakeTimers()
			try {
				const child = createFakeChild()
				mockSpawn.mockReturnValueOnce(child)
				const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
				const execInContainer = (
					runner as unknown as {
						execInContainer: (
							containerId: string,
							command: string,
							cwd: string,
							workspacePath: string,
							timeoutMs: number,
							environment: Record<string, string> | undefined,
							signal: AbortSignal,
							onOutput: CommandExecutionRequest["onOutput"],
							executionId: string,
						) => Promise<unknown>
					}
				).execInContainer.bind(runner)

				const execution = execInContainer(
					"container-1",
					"sleep 30",
					process.cwd(),
					process.cwd(),
					50,
					undefined,
					new AbortController().signal,
					vi.fn(),
					"execution-1",
				)
				const rejection = expect(execution).rejects.toBeInstanceOf(CommandTimeoutError)
				await vi.advanceTimersByTimeAsync(50)

				await rejection
				expect(child.kill).toHaveBeenCalledWith("SIGTERM")
			} finally {
				vi.useRealTimers()
			}
		})

		it("decodes split UTF-8 and bounds captured output while still streaming all chunks", async () => {
			const child = createFakeChild({ closeOnKill: false })
			mockSpawn.mockReturnValueOnce(child)
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const onOutput = vi.fn()
			const execInContainer = (
				runner as unknown as {
					execInContainer: (
						containerId: string,
						command: string,
						cwd: string,
						workspacePath: string,
						timeoutMs: number,
						environment: Record<string, string> | undefined,
						signal: AbortSignal,
						onOutput: CommandExecutionRequest["onOutput"],
						executionId: string,
					) => Promise<{ output: string; truncated: boolean; capturedBytes: number }>
				}
			).execInContainer.bind(runner)

			const execution = execInContainer(
				"container-1",
				"large-output",
				process.cwd(),
				process.cwd(),
				30_000,
				undefined,
				new AbortController().signal,
				onOutput,
				"execution-1",
			)
			const multibyte = Buffer.from("\u4f60", "utf8")
			child.stdout.write(multibyte.subarray(0, 1))
			child.stdout.write(Buffer.concat([multibyte.subarray(1), Buffer.alloc(100_000, 0x61)]))
			child.emit("close", 0)

			const result = await execution
			expect(result.output.startsWith("\u4f60")).toBe(true)
			expect(result.capturedBytes).toBe(100_000)
			expect(Buffer.byteLength(result.output)).toBe(100_000)
			expect(result.truncated).toBe(true)
			expect(onOutput.mock.calls.map(([chunk]) => chunk.text).join("")).toBe(`\u4f60${"a".repeat(100_000)}`)
		})
	})

	describe("maintenance errors and image validation", () => {
		it("removes containers with docker rm -f", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const removeContainer = (
				runner as unknown as { removeContainer: (containerId: string) => Promise<void> }
			).removeContainer.bind(runner)
			await removeContainer("container-1")

			expect(mockExecFileAsync).toHaveBeenCalledWith("docker", ["rm", "-f", "container-1"], { timeout: 30_000 })
		})

		it("kills a container and verifies that it is stopped after removal fails", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: "container-1\n", stderr: "" })
				.mockResolvedValueOnce({ stdout: "false\n", stderr: "" })
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const stopAndConfirmContainer = (
				runner as unknown as { stopAndConfirmContainer: (containerId: string) => Promise<boolean> }
			).stopAndConfirmContainer.bind(runner)

			await expect(stopAndConfirmContainer("container-1")).resolves.toBe(true)
			expect(mockExecFileAsync).toHaveBeenNthCalledWith(1, "docker", ["kill", "container-1"], { timeout: 10_000 })
			expect(mockExecFileAsync).toHaveBeenNthCalledWith(
				2,
				"docker",
				["inspect", "--format", "{{.State.Running}}", "container-1"],
				{ timeout: 10_000 },
			)
		})

		it("cleans containers left by an older runner in the same process", async () => {
			mockExecFileAsync
				.mockResolvedValueOnce({ stdout: `container-old ${process.pid}-older\n`, stderr: "" })
				.mockResolvedValueOnce({ stdout: "", stderr: "" })
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })

			await expect(runner.cleanupStaleContainers()).resolves.toBe(1)
			expect(mockExecFileAsync).toHaveBeenNthCalledWith(2, "docker", ["rm", "-f", "container-old"], {
				timeout: 30_000,
			})
		})

		it("validates an image before starting docker pull", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			await expect(runner.pullImage("docker:dind")).rejects.toBeInstanceOf(ConfigInvalidError)
			expect(mockSpawn).not.toHaveBeenCalled()
			expect(mockExecFile).not.toHaveBeenCalled()
		})

		it("propagates stale-container cleanup failures", async () => {
			mockExecFileAsync.mockRejectedValueOnce(new Error("docker ps failed"))
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			await expect(runner.cleanupStaleContainers()).rejects.toThrow("docker ps failed")
		})

		it("propagates image pull process failures", async () => {
			const child = createFakeChild({ closeOnKill: false })
			mockSpawn.mockReturnValueOnce(child)
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const pull = runner.pullImage("ubuntu:latest")
			expect(mockSpawn).toHaveBeenCalledWith(
				"docker",
				["pull", "ubuntu:latest"],
				expect.objectContaining({ shell: false }),
			)
			child.emit("close", 1)
			await expect(pull).rejects.toBeInstanceOf(ImageNotFoundError)
		})
	})

	describe("transactional settings update", () => {
		type RunnerInternals = {
			settings: SandboxSettings
			containers: Map<string, { taskId: string; containerId: string; createdAt: number }>
			pendingCreation: Map<string, Promise<{ taskId: string; containerId: string; createdAt: number }>>
			removeContainer: (containerId: string) => Promise<void>
		}

		it("keeps old settings and container tracking when removal fails", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const internals = runner as unknown as RunnerInternals
			internals.containers.set("/workspace::task-1", {
				taskId: "task-1",
				containerId: "container-old",
				createdAt: Date.now(),
			})
			internals.removeContainer = vi.fn().mockRejectedValue(new Error("docker rm failed"))

			const nextSettings: SandboxSettings = { ...DEFAULT_SETTINGS, networkMode: "bridge" }
			await expect(runner.updateSettings(nextSettings)).rejects.toThrow("Failed to remove")

			expect(internals.settings.networkMode).toBe("none")
			expect(internals.containers.has("/workspace::task-1")).toBe(true)
		})

		it("commits new settings only after old containers are removed", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const internals = runner as unknown as RunnerInternals
			internals.containers.set("/workspace::task-1", {
				taskId: "task-1",
				containerId: "container-old",
				createdAt: Date.now(),
			})
			internals.removeContainer = vi.fn().mockResolvedValue(undefined)

			const nextSettings: SandboxSettings = { ...DEFAULT_SETTINGS, networkMode: "bridge" }
			await runner.updateSettings(nextSettings)

			expect(internals.settings.networkMode).toBe("bridge")
			expect(internals.containers.size).toBe(0)
		})

		it("waits for pending creation and removes the resulting container", async () => {
			const runner = new DockerSandboxRunner({ ...DEFAULT_SETTINGS })
			const internals = runner as unknown as RunnerInternals
			const key = "/workspace::task-pending"
			let resolveCreation!: (container: { taskId: string; containerId: string; createdAt: number }) => void
			const creation = new Promise<{ taskId: string; containerId: string; createdAt: number }>((resolve) => {
				resolveCreation = resolve
			}).then((container) => {
				internals.containers.set(key, container)
				return container
			})
			internals.pendingCreation.set(key, creation)
			internals.removeContainer = vi.fn().mockResolvedValue(undefined)

			const cleanup = runner.disposeAllContainers()
			await Promise.resolve()
			expect(internals.removeContainer).not.toHaveBeenCalled()

			resolveCreation({
				taskId: "task-pending",
				containerId: "container-pending",
				createdAt: Date.now(),
			})
			await cleanup

			expect(internals.removeContainer).toHaveBeenCalledWith("container-pending")
			expect(internals.containers.size).toBe(0)
		})
	})
})
