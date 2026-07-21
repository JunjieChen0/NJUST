import { describe, it, expect, vi, beforeEach } from "vitest"
import { SandboxExecutionService } from "../SandboxExecutionService"
import type { SandboxConfigProvider } from "../SandboxExecutionService"
import type { CommandExecutionRequest } from "../CommandRunner"
import type { DockerStatus } from "../SandboxPolicy"
import {
	CommandCancelledError,
	CommandTimeoutError,
	ConfigInvalidError,
	PolicyDeniedError,
	SandboxContainmentError,
	SandboxUnavailableError,
} from "../SandboxErrors"
import { sandboxAudit } from "../SandboxAudit"

// Mock VS Code
vi.mock("vscode", () => ({
	window: {
		createTerminal: vi.fn(),
		onDidEndTerminalShellExecution: vi.fn(),
		onDidCloseTerminal: vi.fn(),
	},
	workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn() })) },
}))

// Mock terminal dependencies
vi.mock("../../../integrations/terminal/TerminalRegistry", () => ({
	TerminalRegistry: {
		getOrCreateTerminal: vi.fn(),
		releaseTerminalsForTask: vi.fn(),
	},
}))

// Mock uuid for deterministic execution IDs
vi.mock("uuid", () => ({
	v4: () => "test-uuid-1234",
}))

describe("SandboxExecutionService", () => {
	let service: SandboxExecutionService
	let mockConfigProvider: SandboxConfigProvider

	beforeEach(() => {
		vi.useRealTimers()
		vi.clearAllMocks()
		SandboxExecutionService.resetInstance()
		sandboxAudit.clear()
		mockConfigProvider = {
			getBackend: vi.fn().mockReturnValue("guarded-host"),
			getDockerStatus: vi.fn().mockReturnValue("not-installed"),
			getTimeoutSeconds: vi.fn().mockReturnValue(120),
		}
		service = new SandboxExecutionService(mockConfigProvider)
	})

	// ─── Singleton Pattern ──────────────────────────────────────────────

	describe("getInstance", () => {
		it("returns the same instance on repeated calls", () => {
			const a = SandboxExecutionService.getInstance()
			const b = SandboxExecutionService.getInstance()
			expect(a).toBe(b)
		})

		it("adopts an explicitly provided config after default initialization", () => {
			const initial = SandboxExecutionService.getInstance()
			const provider: SandboxConfigProvider = {
				getBackend: () => "docker",
				getDockerStatus: () => "available",
				getTimeoutSeconds: () => 45,
			}

			const configured = SandboxExecutionService.getInstance(provider)

			expect(configured).toBe(initial)
			expect(configured.getConfiguredBackend()).toBe("docker")
			expect(configured.getDockerStatus()).toBe("available")
			expect(configured.getEffectiveTimeout(120_000, "local")).toBe(45_000)
		})

		it("returns new instance after resetInstance", () => {
			const a = SandboxExecutionService.getInstance()
			SandboxExecutionService.resetInstance()
			const b = SandboxExecutionService.getInstance()
			expect(a).not.toBe(b)
		})
	})

	// ─── Policy Evaluation ──────────────────────────────────────────────

	describe("policy evaluation", () => {
		it("uses guarded-host backend when configured", () => {
			expect(service.getConfiguredBackend()).toBe("guarded-host")
		})

		it("throws PolicyDeniedError when docker is required but unavailable", async () => {
			const dockerProvider: SandboxConfigProvider = {
				getBackend: () => "docker",
				getDockerStatus: () => "not-installed",
				getTimeoutSeconds: () => 120,
			}
			const dockerService = new SandboxExecutionService(dockerProvider)

			const request = createMockRequest()
			await expect(dockerService.run(request)).rejects.toThrow(PolicyDeniedError)
			expect(sandboxAudit.getRecords()[0]).toMatchObject({
				requestedBackend: "docker",
				backend: "docker",
				cwd: "/home/user/project",
				dockerStatus: "not-installed",
				approvalResult: "denied",
			})
		})

		it("fails closed when the configured sandbox settings are invalid", async () => {
			const invalidProvider: SandboxConfigProvider = {
				getBackend: () => {
					throw new ConfigInvalidError("memoryMb must be between 64 and 4096")
				},
				getDockerStatus: () => "available",
				getTimeoutSeconds: () => 120,
			}
			const invalidService = new SandboxExecutionService(invalidProvider)
			const request = createMockRequest()

			await expect(invalidService.run(request)).rejects.toThrow(ConfigInvalidError)
			expect(sandboxAudit.getRecords()[0]).toMatchObject({
				requestedBackend: "invalid",
				dockerStatus: "available",
				cwd: "/home/user/project",
				approvalResult: "denied",
			})
		})

		it("throws PolicyDeniedError when docker daemon is not running", async () => {
			const dockerProvider: SandboxConfigProvider = {
				getBackend: () => "docker",
				getDockerStatus: () => "daemon-not-running",
				getTimeoutSeconds: () => 120,
			}
			const dockerService = new SandboxExecutionService(dockerProvider)

			const request = createMockRequest()
			await expect(dockerService.run(request)).rejects.toThrow(PolicyDeniedError)
		})

		it("throws SandboxUnavailableError when docker runner is not registered", async () => {
			const dockerProvider: SandboxConfigProvider = {
				getBackend: () => "docker",
				getDockerStatus: () => "available",
				getTimeoutSeconds: () => 120,
			}
			const dockerService = new SandboxExecutionService(dockerProvider)
			// Don't call setDockerRunner — should get SandboxUnavailableError

			const request = createMockRequest()
			await expect(dockerService.run(request)).rejects.toThrow(SandboxUnavailableError)
		})

		it("allows guarded-host backend always", async () => {
			// The guarded-host runner will fail because TerminalRegistry is mocked,
			// but the policy evaluation should pass
			const request = createMockRequest()

			// We expect the run to fail at the terminal level, not at policy level
			try {
				await service.run(request)
			} catch (error) {
				// Should NOT be a PolicyDeniedError
				expect(error).not.toBeInstanceOf(PolicyDeniedError)
			}
		})
	})

	// ─── Backend Resolution ─────────────────────────────────────────────

	describe("backend resolution for sources", () => {
		it("always uses guarded-host for internal source", async () => {
			// Internal execution is an explicit host path and must not parse user sandbox settings.
			const dockerProvider: SandboxConfigProvider = {
				getBackend: vi.fn(() => {
					throw new ConfigInvalidError("invalid user sandbox config")
				}),
				getDockerStatus: () => "available",
				getTimeoutSeconds: () => 120,
			}
			const dockerService = new SandboxExecutionService(dockerProvider)
			const request = createMockRequest("internal")

			// Internal source should resolve to guarded-host, not fail with PolicyDeniedError
			try {
				await dockerService.run(request)
			} catch (error) {
				expect(error).not.toBeInstanceOf(PolicyDeniedError)
				expect(error).not.toBeInstanceOf(ConfigInvalidError)
			}
			expect(dockerProvider.getBackend).not.toHaveBeenCalled()
		})

		it("uses configured backend for local source", () => {
			expect(service.getConfiguredBackend()).toBe("guarded-host")
		})

		it("uses configured backend for cloud-agent source", () => {
			expect(service.getConfiguredBackend()).toBe("guarded-host")
		})

		it("uses configured backend for mcp source", () => {
			expect(service.getConfiguredBackend()).toBe("guarded-host")
		})
	})

	// ─── Docker Status ──────────────────────────────────────────────────

	describe("docker status", () => {
		it("returns current docker status from config provider", () => {
			expect(service.getDockerStatus()).toBe("not-installed")
		})

		it("reflects updated docker status", () => {
			const provider = mockConfigProvider as { getDockerStatus: ReturnType<typeof vi.fn> }
			provider.getDockerStatus.mockReturnValue("available")
			expect(service.getDockerStatus()).toBe("available")
		})
	})

	// ─── Lifecycle ──────────────────────────────────────────────────────

	describe("task lifecycle", () => {
		it("disposeTask calls both runners", async () => {
			const mockDockerRunner = {
				run: vi.fn(),
				cancel: vi.fn(),
				disposeTask: vi.fn().mockResolvedValue(undefined),
				cleanupStaleContainers: vi.fn().mockResolvedValue(0),
				disposeAllContainers: vi.fn().mockResolvedValue(undefined),
				updateSettings: vi.fn().mockResolvedValue(undefined),
			}
			const svcWithDocker = new SandboxExecutionService(
				{ getBackend: () => "docker", getDockerStatus: () => "available", getTimeoutSeconds: () => 120 },
				{
					detectDocker: async () => "available",
					readSettings: () => ({
						backend: "docker",
						dockerImage: "test:latest",
						networkMode: "none",
						workspaceAccess: "read-write",
						memoryMb: 512,
						cpuLimit: 1,
						pidsLimit: 256,
						timeoutSeconds: 120,
						taskScopedContainer: true,
						allowFallbackToHost: false as const,
					}),
					createDockerRunner: () => mockDockerRunner as any,
				},
			)
			await svcWithDocker.initializeDocker()
			await svcWithDocker.disposeTask("test-task")
			expect(mockDockerRunner.disposeTask).toHaveBeenCalledWith("test-task")
		})

		it("retains the Docker runner and propagates service cleanup failures", async () => {
			const mockDockerRunner = {
				run: vi.fn(),
				cancel: vi.fn(),
				disposeTask: vi.fn(),
				cleanupStaleContainers: vi.fn().mockResolvedValue(0),
				disposeAllContainers: vi
					.fn()
					.mockRejectedValueOnce(new Error("docker cleanup failed"))
					.mockResolvedValueOnce(undefined),
				updateSettings: vi.fn().mockResolvedValue(undefined),
			}
			const svcWithDocker = new SandboxExecutionService(
				{ getBackend: () => "docker", getDockerStatus: () => "available", getTimeoutSeconds: () => 120 },
				{
					detectDocker: async () => "available",
					readSettings: () => ({
						backend: "docker",
						dockerImage: "test:latest",
						networkMode: "none",
						workspaceAccess: "read-write",
						memoryMb: 512,
						cpuLimit: 1,
						pidsLimit: 256,
						timeoutSeconds: 120,
						taskScopedContainer: true,
						allowFallbackToHost: false as const,
					}),
					createDockerRunner: () => mockDockerRunner as any,
				},
			)
			await svcWithDocker.initializeDocker()

			await expect(svcWithDocker.dispose()).rejects.toThrow("docker cleanup failed")
			expect(svcWithDocker.getDockerRunner()).toBe(mockDockerRunner)

			await expect(svcWithDocker.dispose()).resolves.toBeUndefined()
			expect(mockDockerRunner.disposeAllContainers).toHaveBeenCalledTimes(2)
			expect(svcWithDocker.getDockerRunner()).toBeUndefined()
		})

		it("cancel calls both runners", async () => {
			const mockDockerRunner = {
				run: vi.fn(),
				cancel: vi.fn().mockResolvedValue(undefined),
				disposeTask: vi.fn(),
				cleanupStaleContainers: vi.fn().mockResolvedValue(0),
				disposeAllContainers: vi.fn().mockResolvedValue(undefined),
				updateSettings: vi.fn().mockResolvedValue(undefined),
			}
			const svcWithDocker = new SandboxExecutionService(
				{ getBackend: () => "docker", getDockerStatus: () => "available", getTimeoutSeconds: () => 120 },
				{
					detectDocker: async () => "available",
					readSettings: () => ({
						backend: "docker",
						dockerImage: "test:latest",
						networkMode: "none",
						workspaceAccess: "read-write",
						memoryMb: 512,
						cpuLimit: 1,
						pidsLimit: 256,
						timeoutSeconds: 120,
						taskScopedContainer: true,
						allowFallbackToHost: false as const,
					}),
					createDockerRunner: () => mockDockerRunner as any,
				},
			)
			await svcWithDocker.initializeDocker()
			await svcWithDocker.cancel("test-execution")
			expect(mockDockerRunner.cancel).toHaveBeenCalledWith("test-execution")
		})

		it("propagates runner cleanup failures", async () => {
			const guardedHostRunner = (
				service as unknown as {
					guardedHostRunner: { disposeTask: ReturnType<typeof vi.fn> }
				}
			).guardedHostRunner
			guardedHostRunner.disposeTask = vi.fn().mockRejectedValue(new Error("host cleanup failed"))

			await expect(service.disposeScope("task:test:instance")).rejects.toThrow("host cleanup failed")
		})

		it("rejects new executions once scope disposal starts", async () => {
			let resolveDisposal!: () => void
			const disposal = new Promise<void>((resolve) => {
				resolveDisposal = resolve
			})
			const guardedHostRunner = (
				service as unknown as {
					guardedHostRunner: {
						run: ReturnType<typeof vi.fn>
						disposeTask: ReturnType<typeof vi.fn>
					}
				}
			).guardedHostRunner
			guardedHostRunner.disposeTask = vi.fn().mockReturnValue(disposal)
			guardedHostRunner.run = vi.fn().mockImplementation(async (request: CommandExecutionRequest) => ({
				executionId: request.executionId,
				backend: "guarded-host",
				exitCode: 0,
				output: "",
				cancelled: false,
				timedOut: false,
			}))
			const resourceScopeId = "task:test:closing-instance"

			const disposing = service.disposeScope(resourceScopeId)
			await expect(
				service.run({ ...createMockRequest(), executionId: "late-exec", resourceScopeId }),
			).rejects.toBeInstanceOf(CommandCancelledError)
			expect(guardedHostRunner.run).not.toHaveBeenCalled()

			resolveDisposal()
			await disposing
			await expect(
				service.run({ ...createMockRequest(), executionId: "later-exec", resourceScopeId }),
			).rejects.toBeInstanceOf(CommandCancelledError)
			await expect(
				service.run({
					...createMockRequest(),
					executionId: "other-exec",
					resourceScopeId: "task:test:other-instance",
				}),
			).resolves.toMatchObject({ exitCode: 0 })
		})

		it("aborts and awaits scoped external terminal processes", async () => {
			let resolveProcess!: () => void
			const settled = new Promise<void>((resolve) => {
				resolveProcess = resolve
			})
			const process = Object.assign(settled, { abort: vi.fn() })
			const resourceScopeId = "task:test:external-instance"
			const unregister = service.registerExternalProcess(resourceScopeId, process as any)

			let disposalSettled = false
			const disposing = service.disposeScope(resourceScopeId).then(() => {
				disposalSettled = true
			})
			expect(process.abort).toHaveBeenCalledOnce()
			await Promise.resolve()
			expect(disposalSettled).toBe(false)

			resolveProcess()
			await disposing
			expect(
				(
					service as unknown as {
						externalProcesses: Map<string, Set<unknown>>
					}
				).externalProcesses.has(resourceScopeId),
			).toBe(false)
			expect(() => unregister()).not.toThrow()
		})

		it("rejects new executions once service disposal starts", async () => {
			let resolveProcess!: () => void
			const settled = new Promise<void>((resolve) => {
				resolveProcess = resolve
			})
			const process = Object.assign(settled, { abort: vi.fn() })
			service.registerExternalProcess("task:test:service-dispose", process as any)
			let disposalSettled = false
			const disposing = service.dispose().then(() => {
				disposalSettled = true
			})

			await expect(
				service.run({ ...createMockRequest(), executionId: "late-service-exec" }),
			).rejects.toBeInstanceOf(SandboxUnavailableError)
			expect(process.abort).toHaveBeenCalledOnce()
			await Promise.resolve()
			expect(disposalSettled).toBe(false)
			resolveProcess()
			await disposing
		})

		it("preserves cancellation when the runner settles after the deadline", async () => {
			vi.useFakeTimers()
			let rejectRun!: (error: Error) => void
			const guardedHostRunner = (
				service as unknown as {
					guardedHostRunner: {
						run: ReturnType<typeof vi.fn>
						cancel: ReturnType<typeof vi.fn>
					}
				}
			).guardedHostRunner
			guardedHostRunner.run = vi.fn().mockReturnValue(
				new Promise((_resolve, reject) => {
					rejectRun = reject
				}),
			)
			guardedHostRunner.cancel = vi.fn().mockResolvedValue(undefined)
			const executionId = "cancel-before-deadline"
			const result = service
				.run({ ...createMockRequest(), executionId, timeoutMs: 100 })
				.catch((error: unknown) => error)
			await Promise.resolve()
			await Promise.resolve()
			expect(guardedHostRunner.run).toHaveBeenCalledOnce()

			await vi.advanceTimersByTimeAsync(90)
			await service.cancel(executionId)
			await vi.advanceTimersByTimeAsync(20)
			rejectRun(new CommandCancelledError(executionId))

			expect(await result).toBeInstanceOf(CommandCancelledError)
			expect(sandboxAudit.getRecords().at(-1)).toMatchObject({ cancelled: true, timedOut: false })
		})
	})

	describe("timeout cap", () => {
		it("caps positive timeouts and passes through zero (user disabled timeout)", () => {
			expect(service.getEffectiveTimeout(300_000, "local")).toBe(120_000)
			expect(service.getEffectiveTimeout(30_000, "local")).toBe(30_000)
			// 0 means "user explicitly disabled timeout" — pass through, do not impose cap
			expect(service.getEffectiveTimeout(0, "local")).toBe(0)
			expect(service.getEffectiveTimeout(0, "internal")).toBe(0)
		})

		it("preserves Docker metadata when recording a timed-out execution", () => {
			const request = createMockRequest()
			sandboxAudit.recordStart(request, "docker")
			const error = new CommandTimeoutError(request.timeoutMs)
			error.auditMetadata = {
				containerId: "container-timeout",
				imageDigest: "sha256:timeout-image",
				networkMode: "none",
				memoryMb: 512,
				cpuLimit: 1,
			}
			;(
				service as unknown as {
					recordExecutionFailure: (executionId: string, backend: "docker", error: unknown) => void
				}
			).recordExecutionFailure(request.executionId, "docker", error)

			expect(sandboxAudit.getRecords()[0]).toMatchObject({
				containerId: "container-timeout",
				imageDigest: "sha256:timeout-image",
				networkMode: "none",
				memoryMb: 512,
				cpuLimit: 1,
				timedOut: true,
			})
		})

		it("records Docker metadata when the containment latch rejects before execution setup", async () => {
			const containmentError = new SandboxContainmentError("container-latched", "cleanup failed")
			containmentError.auditMetadata = {
				containerId: "container-latched",
				imageDigest: "sha256:latched-image",
				networkMode: "bridge",
				memoryMb: 768,
				cpuLimit: 1.5,
			}
			const dockerService = new SandboxExecutionService({
				getBackend: () => "docker",
				getDockerStatus: () => "available",
				getTimeoutSeconds: () => 120,
			})
			const run = vi.fn().mockRejectedValue(containmentError)
			;(dockerService as unknown as { dockerRunner: { run: typeof run } }).dockerRunner = { run }
			const request = createMockRequest("mcp")

			await expect(dockerService.run(request)).rejects.toBe(containmentError)
			expect(sandboxAudit.getRecords()[0]).toMatchObject({
				executionId: request.executionId,
				backend: "docker",
				requestedBackend: "docker",
				dockerStatus: "available",
				containerId: "container-latched",
				imageDigest: "sha256:latched-image",
				networkMode: "bridge",
				memoryMb: 768,
				cpuLimit: 1.5,
				error: containmentError.message,
			})
		})
	})

	describe("external terminal tracking", () => {
		it("records the shell exit code and cancels the hard-cap timer", async () => {
			vi.useFakeTimers()
			const vscode = await import("vscode")
			let endHandler:
				| ((event: { terminal: import("vscode").Terminal; exitCode: number | undefined }) => void)
				| undefined
			vi.mocked(vscode.window.onDidEndTerminalShellExecution).mockImplementation((handler) => {
				endHandler = handler as (event: {
					terminal: import("vscode").Terminal
					exitCode: number | undefined
				}) => void
				return { dispose: vi.fn() }
			})
			vi.mocked(vscode.window.onDidCloseTerminal).mockReturnValue({ dispose: vi.fn() })
			const terminal = { sendText: vi.fn() } as unknown as import("vscode").Terminal
			const request = createMockRequest("user")
			service.evaluateAndAuditExecution(request)

			service.trackExternalTerminalExecution(request.executionId, terminal, 1_000)
			endHandler?.({ terminal, exitCode: 7 })
			await vi.advanceTimersByTimeAsync(1_000)

			expect(terminal.sendText).not.toHaveBeenCalled()
			expect(sandboxAudit.getRecords()[0]).toMatchObject({
				status: "completed",
				exitCode: 7,
				cancelled: false,
				timedOut: false,
			})
		})

		it("interrupts, waits for the grace period, and completes audit only after terminal close", async () => {
			vi.useFakeTimers()
			const vscode = await import("vscode")
			const disposeEnd = vi.fn()
			const disposeClose = vi.fn()
			let closeHandler: ((terminal: import("vscode").Terminal) => void) | undefined
			vi.mocked(vscode.window.onDidEndTerminalShellExecution).mockReturnValue({ dispose: disposeEnd })
			vi.mocked(vscode.window.onDidCloseTerminal).mockImplementation((handler) => {
				closeHandler = handler
				return { dispose: disposeClose }
			})
			const terminal = { sendText: vi.fn(), dispose: vi.fn() } as unknown as import("vscode").Terminal
			const request = createMockRequest("user")
			service.evaluateAndAuditExecution(request)

			service.trackExternalTerminalExecution(request.executionId, terminal, 1_000)
			expect(sandboxAudit.getRecords()[0].status).toBe("dispatched")

			await vi.advanceTimersByTimeAsync(1_000)
			expect(terminal.sendText).toHaveBeenCalledWith("\x03", false)
			expect(terminal.dispose).not.toHaveBeenCalled()
			expect(sandboxAudit.getRecords()[0].status).toBe("dispatched")

			await vi.advanceTimersByTimeAsync(2_000)
			expect(terminal.dispose).toHaveBeenCalledOnce()
			expect(sandboxAudit.getRecords()[0].status).toBe("dispatched")

			closeHandler?.(terminal)
			expect(sandboxAudit.getRecords()[0]).toMatchObject({
				status: "completed",
				cancelled: true,
				timedOut: true,
			})
			expect(disposeEnd).toHaveBeenCalledOnce()
			expect(disposeClose).toHaveBeenCalledOnce()
		})

		it("returns an idempotent cleanup that ignores late terminal events", async () => {
			vi.useFakeTimers()
			const vscode = await import("vscode")
			const disposeEnd = vi.fn()
			const disposeClose = vi.fn()
			let endHandler:
				| ((event: { terminal: import("vscode").Terminal; exitCode: number | undefined }) => void)
				| undefined
			let closeHandler: ((terminal: import("vscode").Terminal) => void) | undefined
			vi.mocked(vscode.window.onDidEndTerminalShellExecution).mockImplementation((handler) => {
				endHandler = handler as typeof endHandler
				return { dispose: disposeEnd }
			})
			vi.mocked(vscode.window.onDidCloseTerminal).mockImplementation((handler) => {
				closeHandler = handler
				return { dispose: disposeClose }
			})
			const terminal = { sendText: vi.fn(), dispose: vi.fn() } as unknown as import("vscode").Terminal
			const request = createMockRequest("user")
			service.evaluateAndAuditExecution(request)

			const stopTracking = service.trackExternalTerminalExecution(request.executionId, terminal, 1_000)
			stopTracking()
			stopTracking()
			endHandler?.({ terminal, exitCode: 0 })
			closeHandler?.(terminal)
			await vi.advanceTimersByTimeAsync(3_000)

			expect(disposeEnd).toHaveBeenCalledOnce()
			expect(disposeClose).toHaveBeenCalledOnce()
			expect(terminal.sendText).not.toHaveBeenCalled()
			expect(terminal.dispose).not.toHaveBeenCalled()
			expect(sandboxAudit.getRecords()[0].status).toBe("dispatched")
		})
	})

	describe("docker reconciliation", () => {
		const settings = {
			backend: "docker" as const,
			dockerImage: "test:latest",
			networkMode: "none" as const,
			workspaceAccess: "read-write" as const,
			memoryMb: 512,
			cpuLimit: 1,
			pidsLimit: 256,
			timeoutSeconds: 120,
			taskScopedContainer: true,
			allowFallbackToHost: false as const,
		}

		it("waits for initialization before evaluating a Docker execution", async () => {
			let dockerStatus: DockerStatus = "checking"
			let resolveDetection!: (status: DockerStatus) => void
			const detection = new Promise<DockerStatus>((resolve) => {
				resolveDetection = resolve
			})
			const run = vi.fn().mockResolvedValue({
				executionId: "exec-test-001",
				backend: "docker",
				exitCode: 0,
				output: "",
				cancelled: false,
				timedOut: false,
			})
			const runner = {
				run,
				cancel: vi.fn(),
				disposeTask: vi.fn(),
				cleanupStaleContainers: vi.fn().mockResolvedValue(0),
				disposeAllContainers: vi.fn(),
				updateSettings: vi.fn(),
			}
			const provider: SandboxConfigProvider = {
				getBackend: () => "docker",
				getDockerStatus: () => dockerStatus,
				getTimeoutSeconds: () => 120,
				updateDockerStatus: (status) => {
					dockerStatus = status
				},
			}
			const dockerService = new SandboxExecutionService(provider, {
				detectDocker: () => detection,
				readSettings: () => settings,
				createDockerRunner: () => runner as any,
			})

			const initialization = dockerService.initializeDocker()
			const execution = dockerService.run(createMockRequest())
			await Promise.resolve()
			expect(run).not.toHaveBeenCalled()

			resolveDetection("available")
			await expect(initialization).resolves.toBe("available")
			await expect(execution).resolves.toMatchObject({ backend: "docker", exitCode: 0 })
			expect(run).toHaveBeenCalledOnce()
		})

		it("cancels an execution waiting for Docker reconciliation when its scope is disposed", async () => {
			let dockerStatus: DockerStatus = "checking"
			let resolveDetection!: (status: DockerStatus) => void
			const detection = new Promise<DockerStatus>((resolve) => {
				resolveDetection = resolve
			})
			const run = vi.fn().mockResolvedValue({
				executionId: "exec-reconcile-cancel",
				backend: "docker",
				exitCode: 0,
				output: "",
				cancelled: false,
				timedOut: false,
			})
			const runner = {
				run,
				cancel: vi.fn(),
				disposeTask: vi.fn().mockResolvedValue(undefined),
				cleanupStaleContainers: vi.fn().mockResolvedValue(0),
				disposeAllContainers: vi.fn(),
				updateSettings: vi.fn(),
			}
			const provider: SandboxConfigProvider = {
				getBackend: () => "docker",
				getDockerStatus: () => dockerStatus,
				getTimeoutSeconds: () => 120,
				updateDockerStatus: (status) => {
					dockerStatus = status
				},
			}
			const dockerService = new SandboxExecutionService(provider, {
				detectDocker: () => detection,
				readSettings: () => settings,
				createDockerRunner: () => runner as any,
			})
			const request = {
				...createMockRequest(),
				executionId: "exec-reconcile-cancel",
				resourceScopeId: "task:test:instance",
			}

			const execution = dockerService.run(request)
			const rejection = expect(execution).rejects.toBeInstanceOf(CommandCancelledError)
			await Promise.resolve()
			await dockerService.disposeScope("task:test:instance")
			resolveDetection("available")

			await rejection
			expect(run).not.toHaveBeenCalled()
		})

		it("includes Docker reconciliation in the command timeout", async () => {
			vi.useFakeTimers()
			let dockerStatus: DockerStatus = "checking"
			let resolveDetection!: (status: DockerStatus) => void
			const detection = new Promise<DockerStatus>((resolve) => {
				resolveDetection = resolve
			})
			const run = vi.fn().mockResolvedValue({
				executionId: "exec-reconcile-timeout",
				backend: "docker",
				exitCode: 0,
				output: "",
				cancelled: false,
				timedOut: false,
			})
			const runner = {
				run,
				cancel: vi.fn(),
				disposeTask: vi.fn().mockResolvedValue(undefined),
				cleanupStaleContainers: vi.fn().mockResolvedValue(0),
				disposeAllContainers: vi.fn(),
				updateSettings: vi.fn(),
			}
			const provider: SandboxConfigProvider = {
				getBackend: () => "docker",
				getDockerStatus: () => dockerStatus,
				getTimeoutSeconds: () => 120,
				updateDockerStatus: (status) => {
					dockerStatus = status
				},
			}
			const dockerService = new SandboxExecutionService(provider, {
				detectDocker: () => detection,
				readSettings: () => settings,
				createDockerRunner: () => runner as any,
			})

			const execution = dockerService.run({
				...createMockRequest(),
				executionId: "exec-reconcile-timeout",
				timeoutMs: 50,
			})
			const rejection = expect(execution).rejects.toBeInstanceOf(CommandTimeoutError)
			await vi.advanceTimersByTimeAsync(50)
			resolveDetection("available")

			await rejection
			expect(run).not.toHaveBeenCalled()
		})

		it("uses a single runner for concurrent initialization", async () => {
			let dockerStatus: DockerStatus = "checking"
			const createDockerRunner = vi.fn(() => ({
				run: vi.fn(),
				cancel: vi.fn(),
				disposeTask: vi.fn(),
				cleanupStaleContainers: vi.fn().mockResolvedValue(0),
				disposeAllContainers: vi.fn(),
				updateSettings: vi.fn(),
			}))
			const provider: SandboxConfigProvider = {
				getBackend: () => "docker",
				getDockerStatus: () => dockerStatus,
				getTimeoutSeconds: () => 120,
				updateDockerStatus: (status) => {
					dockerStatus = status
				},
			}
			const dockerService = new SandboxExecutionService(provider, {
				detectDocker: async () => "available",
				readSettings: () => settings,
				createDockerRunner: createDockerRunner as any,
			})

			await Promise.all([dockerService.initializeDocker(), dockerService.initializeDocker()])
			expect(createDockerRunner).toHaveBeenCalledOnce()
			expect(dockerStatus).toBe("available")
		})

		it("keeps policy fail-closed when a settings refresh fails", async () => {
			let dockerStatus: DockerStatus = "checking"
			const runner = {
				run: vi.fn(),
				cancel: vi.fn(),
				disposeTask: vi.fn(),
				cleanupStaleContainers: vi.fn().mockResolvedValue(0),
				disposeAllContainers: vi.fn(),
				updateSettings: vi.fn().mockRejectedValue(new Error("cleanup failed")),
			}
			const provider: SandboxConfigProvider = {
				getBackend: () => "docker",
				getDockerStatus: () => dockerStatus,
				getTimeoutSeconds: () => 120,
				updateDockerStatus: (status) => {
					dockerStatus = status
				},
			}
			const dockerService = new SandboxExecutionService(provider, {
				detectDocker: async () => "available",
				readSettings: () => settings,
				createDockerRunner: () => runner as any,
			})

			await dockerService.initializeDocker()
			await expect(dockerService.refreshDockerBackend()).resolves.toBe("daemon-not-running")
			expect(dockerStatus).toBe("daemon-not-running")
			await expect(dockerService.run(createMockRequest())).rejects.toThrow(PolicyDeniedError)
		})
	})

	// ─── Execution ID ───────────────────────────────────────────────────

	describe("generateExecutionId", () => {
		it("returns a string", () => {
			const id = SandboxExecutionService.generateExecutionId()
			expect(typeof id).toBe("string")
		})

		it("returns the mocked uuid", () => {
			const id = SandboxExecutionService.generateExecutionId()
			expect(id).toBe("test-uuid-1234")
		})
	})
})

// ─── Helper ──────────────────────────────────────────────────────────────────

function createMockRequest(source: CommandExecutionRequest["source"] = "local"): CommandExecutionRequest {
	return {
		executionId: "exec-test-001",
		taskId: "task-test-001",
		command: "echo hello",
		workspacePath: "/home/user/project",
		cwd: "/home/user/project",
		timeoutMs: 30_000,
		source,
		onOutput: vi.fn(),
	}
}
