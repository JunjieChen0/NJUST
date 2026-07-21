/**
 * Docker Sandbox Runner — executes commands inside restricted Docker containers.
 *
 * Container lifecycle:
 * 1. Task's first command  → `docker create` (with labels)
 * 2. Subsequent commands   → `docker exec` (reuse same container)
 * 3. Task complete/cancel  → `docker rm -f`
 * 4. Extension activation   → clean stale containers with extension labels
 *
 * Security constraints enforced at the Docker level:
 * - Read-only root filesystem
 * - All capabilities dropped
 * - No new privileges
 * - Network disabled by default
 * - Memory/CPU/PID limits
 * - Non-root user (1000:1000)
 * - No privileged, host network/PID/IPC, Docker socket, or device mounts
 *
 * Uses parameter arrays for Docker CLI calls and `spawn` for streamed command output.
 */

import { execFile, spawn, type ChildProcess } from "child_process"
import { promisify } from "util"
import * as path from "path"
import { homedir } from "os"
import { realpath, stat } from "fs/promises"
import { StringDecoder } from "string_decoder"
import { randomUUID } from "crypto"

import { logger } from "../../shared/logger"
import type {
	CommandRunner,
	CommandExecutionRequest,
	CommandExecutionHandle,
	CommandOutputChunk,
} from "./CommandRunner"
import type { SandboxSettings } from "./SandboxConfig"
import { validateDockerImage, validateNoPrivilegeEscalation, validateMountPath } from "./SandboxConfig"
import { isSensitiveEnvKey, DANGEROUS_ENV_KEYS } from "../../utils/env"
import {
	DockerNotInstalledError,
	DaemonNotRunningError,
	ImageNotFoundError,
	ContainerStartFailedError,
	ContainerExecFailedError,
	CommandTimeoutError,
	CommandCancelledError,
	ConfigInvalidError,
	SandboxError,
	SandboxContainmentError,
} from "./SandboxErrors"
import type { DockerStatus } from "./SandboxPolicy"
import { detectWindowsSpecificCommand } from "./commandCompatibility"
import { ConcurrencyGate } from "./ConcurrencyGate"
import { BoundedOutput } from "./BoundedOutput"

const execFileAsync = promisify(execFile)

/** Label prefix for all sandbox containers managed by this extension. */
const LABEL_PREFIX = "njust-ai.sandbox"

/** Generate a unique instance ID for this extension window/process. */
function generateInstanceId(): string {
	return `${process.pid}-${Date.now().toString(36)}`
}

/** Check if a process with the given PID is still alive. */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (error) {
		logger.debug("DockerSandboxRunner", "Process is not alive", { pid, error })
		return false
	}
}

/** Timeout for Docker CLI commands (detect, create, rm). */
const DOCKER_CLI_TIMEOUT_MS = 30_000

const DOCKER_PROCESS_TERMINATION_GRACE_MS = 2_000

const POSIX_SYSTEM_ROOTS = new Set([
	"/",
	"/bin",
	"/boot",
	"/dev",
	"/etc",
	"/home",
	"/opt",
	"/proc",
	"/root",
	"/sbin",
	"/sys",
	"/tmp",
	"/usr",
	"/var",
])

export type DockerPathFlavor = "win32" | "posix"

/**
 * Validate a workspace path using explicit path semantics so Windows paths can
 * be tested safely on non-Windows hosts and vice versa.
 */
export function validateDockerWorkspacePath(
	workspacePath: string,
	flavor: DockerPathFlavor = inferPathFlavor(workspacePath),
	homePath = homedir(),
): void {
	if (
		Array.from(workspacePath).some((character) => {
			const codePoint = character.codePointAt(0) ?? 0
			return codePoint <= 0x1f || codePoint === 0x7f
		})
	) {
		throw new ConfigInvalidError("Workspace mount path contains control characters")
	}
	if (workspacePath.includes(",")) {
		throw new ConfigInvalidError("Workspace mount path cannot contain commas")
	}

	const pathApi = flavor === "win32" ? path.win32 : path.posix
	if (!pathApi.isAbsolute(workspacePath)) {
		throw new ConfigInvalidError(`Workspace mount path must be absolute: "${workspacePath}"`)
	}

	const normalized = pathApi.normalize(workspacePath)
	if (flavor === "win32") {
		const lower = normalized.toLowerCase()
		if (lower.startsWith("\\\\.\\") || lower.startsWith("\\\\?\\")) {
			throw new ConfigInvalidError(`Windows device paths cannot be mounted: "${workspacePath}"`)
		}
		if (lower.includes("\\pipe\\docker_engine")) {
			throw new ConfigInvalidError("The Docker named pipe cannot be mounted")
		}

		const root = path.win32.parse(normalized).root
		if (root && normalizeWindowsPath(root) === normalizeWindowsPath(normalized)) {
			throw new ConfigInvalidError(`Windows drive and UNC roots cannot be mounted: "${workspacePath}"`)
		}
		if (isWindowsAbsolute(homePath) && normalizeWindowsPath(homePath) === normalizeWindowsPath(normalized)) {
			throw new ConfigInvalidError("The user home directory root cannot be mounted")
		}
		return
	}

	if (POSIX_SYSTEM_ROOTS.has(normalized)) {
		throw new ConfigInvalidError(`POSIX system root cannot be mounted: "${workspacePath}"`)
	}
	if (normalized === "/var/run/docker.sock" || normalized.startsWith("/var/run/docker/")) {
		throw new ConfigInvalidError("The Docker socket cannot be mounted")
	}
	if (path.posix.isAbsolute(homePath) && path.posix.normalize(homePath) === normalized) {
		throw new ConfigInvalidError("The user home directory root cannot be mounted")
	}
}

function inferPathFlavor(workspacePath: string): DockerPathFlavor {
	if (isWindowsAbsolute(workspacePath)) return "win32"
	return "posix"
}

function isWindowsAbsolute(candidate: string): boolean {
	return path.win32.isAbsolute(candidate)
}

function normalizeWindowsPath(candidate: string): string {
	return path.win32
		.normalize(candidate)
		.replace(/[\\/]+$/, "")
		.toLowerCase()
}

/** Tracks a container associated with a task. */
interface TaskContainer {
	taskId: string
	resourceScopeId: string
	containerId: string
	imageDigest?: string
	createdAt: number
}

interface ExecutionContext {
	executionId: string
	timeoutMs: number
	deadline: number
	signal: AbortSignal
}

const EXECUTION_CANCEL_REASON = Symbol("docker-execution-cancelled")
const EXECUTION_TIMEOUT_REASON = Symbol("docker-execution-timed-out")

// ─── Docker Detection ────────────────────────────────────────────────────────

/**
 * Detect Docker availability and daemon status.
 *
 * @returns DockerStatus indicating availability.
 */
export async function detectDocker(): Promise<DockerStatus> {
	try {
		// Step 1: Check if Docker CLI exists
		const { stdout } = await execFileAsync("docker", ["version", "--format", "{{.Server.Version}}"], {
			timeout: DOCKER_CLI_TIMEOUT_MS,
		})

		if (stdout.trim()) {
			// Step 2: Verify daemon is reachable
			await execFileAsync("docker", ["info", "--format", "{{.ServerVersion}}"], {
				timeout: DOCKER_CLI_TIMEOUT_MS,
			})
			return "available"
		}

		return "daemon-not-running"
	} catch (error: unknown) {
		const err = error as { code?: string; message?: string }
		logger.debug("DockerSandboxRunner", "Docker detection failed", { error })
		if (err.code === "ENOENT") {
			return "not-installed"
		}

		// Docker CLI exists but daemon not reachable
		if (err.message?.includes("Cannot connect") || err.message?.includes("daemon")) {
			return "daemon-not-running"
		}

		logger.warn("DockerSandboxRunner", "detectDocker unexpected error", { error: err.message })
		return "daemon-not-running"
	}
}

// ─── DockerSandboxRunner ─────────────────────────────────────────────────────

export class DockerSandboxRunner implements CommandRunner {
	/** Map of containerKey → container info for reuse. */
	private readonly containers = new Map<string, TaskContainer>()

	/** Map of containerKey → in-flight creation promise (prevents duplicate creation). */
	private readonly pendingCreation = new Map<string, Promise<TaskContainer>>()

	/** Commands sharing a container key must not execute concurrently. */
	private readonly containerGates = new Map<string, ConcurrencyGate>()

	/** Containers that must be removed before their key can be reused. */
	private readonly unusableContainers = new Set<string>()

	/** Containers whose stopped state could not be confirmed after cancellation. */
	private readonly containmentFailures = new Map<string, SandboxContainmentError>()

	/** Active executions for cancellation support. Registered before shared lease acquisition. */
	private readonly activeExecutions = new Map<
		string,
		{
			taskId: string
			resourceScopeId: string
			containerKey?: string
			containerId?: string
			abortController: AbortController
		}
	>()

	/** Unique instance ID for this runner (per-window isolation). */
	readonly instanceId: string

	/** Concurrency gate: shared for run(), exclusive for updateSettings/dispose. */
	private readonly gate = new ConcurrencyGate()

	constructor(private settings: SandboxSettings) {
		this.instanceId = generateInstanceId()
	}

	/**
	 * Generate a unique container key from workspacePath and taskId.
	 * This ensures containers from different workspaces are not reused even if taskId is the same.
	 */
	private containerKey(resourceScopeId: string, workspacePath: string): string {
		const scope = this.settings.taskScopedContainer ? `task::${resourceScopeId}` : "workspace::shared"
		return `${workspacePath}::${scope}`
	}

	private getContainerGate(key: string): ConcurrencyGate {
		let containerGate = this.containerGates.get(key)
		if (!containerGate) {
			containerGate = new ConcurrencyGate()
			this.containerGates.set(key, containerGate)
		}
		return containerGate
	}

	private executionAbortError(context: ExecutionContext): CommandTimeoutError | CommandCancelledError {
		return context.signal.reason === EXECUTION_TIMEOUT_REASON
			? new CommandTimeoutError(context.timeoutMs)
			: new CommandCancelledError(context.executionId)
	}

	private normalizeExecutionError(error: unknown, context: ExecutionContext): unknown {
		if (
			error instanceof CommandTimeoutError ||
			context.signal.reason === EXECUTION_TIMEOUT_REASON ||
			(!context.signal.aborted && Date.now() >= context.deadline)
		) {
			return new CommandTimeoutError(context.timeoutMs)
		}
		if (context.signal.aborted) return new CommandCancelledError(context.executionId)
		return error
	}

	private throwIfExecutionStopped(context: ExecutionContext): void {
		if (context.signal.aborted) throw this.executionAbortError(context)
		if (Date.now() >= context.deadline) throw new CommandTimeoutError(context.timeoutMs)
	}

	private remainingTimeout(context: ExecutionContext, maximumMs: number): number {
		this.throwIfExecutionStopped(context)
		return Math.max(1, Math.min(maximumMs, Math.ceil(context.deadline - Date.now())))
	}

	private waitForExecution<T>(operation: Promise<T>, context: ExecutionContext): Promise<T> {
		try {
			this.throwIfExecutionStopped(context)
		} catch (error) {
			return Promise.reject(error)
		}

		return new Promise<T>((resolve, reject) => {
			let settled = false
			const finish = (callback: () => void): void => {
				if (settled) return
				settled = true
				context.signal.removeEventListener("abort", onAbort)
				callback()
			}
			const onAbort = (): void => finish(() => reject(this.executionAbortError(context)))

			context.signal.addEventListener("abort", onAbort, { once: true })
			operation.then(
				(value) => finish(() => resolve(value)),
				(error) => finish(() => reject(error)),
			)
			if (context.signal.aborted) onAbort()
		})
	}

	private emitOutput(
		onOutput: (chunk: CommandOutputChunk) => void,
		chunk: CommandOutputChunk,
		executionId: string,
	): void {
		try {
			onOutput(chunk)
		} catch (error) {
			logger.debug("DockerSandboxRunner", "Output callback failed", { executionId, error })
		}
	}

	private attachExecutionAuditMetadata<T>(error: T, container?: { containerId: string; imageDigest?: string }): T {
		if (error instanceof SandboxError) {
			error.auditMetadata = {
				containerId: container?.containerId,
				imageDigest: container?.imageDigest,
				networkMode: this.settings.networkMode,
				memoryMb: this.settings.memoryMb,
				cpuLimit: this.settings.cpuLimit,
				...error.auditMetadata,
			}
		}
		return error
	}

	/**
	 * Update settings (e.g. when user changes configuration).
	 * If security-related fields change, destroy existing containers so that
	 * the next exec will create new containers with the updated config.
	 */
	async updateSettings(settings: SandboxSettings): Promise<void> {
		const release = await this.gate.acquireExclusive()
		try {
			await this.retryContainmentCleanupInternal()
			const needsRecreate =
				settings.networkMode !== this.settings.networkMode ||
				settings.dockerImage !== this.settings.dockerImage ||
				settings.workspaceAccess !== this.settings.workspaceAccess ||
				settings.memoryMb !== this.settings.memoryMb ||
				settings.cpuLimit !== this.settings.cpuLimit ||
				settings.pidsLimit !== this.settings.pidsLimit ||
				settings.taskScopedContainer !== this.settings.taskScopedContainer

			if (needsRecreate) {
				logger.info("DockerSandboxRunner", "Security config changed, disposing all containers")
				await this.disposeAllContainersInternal()
			}

			this.settings = settings
		} finally {
			release()
		}
	}

	// ─── CommandRunner Interface ─────────────────────────────────────────

	public async run(request: CommandExecutionRequest): Promise<CommandExecutionHandle> {
		this.throwIfContainmentCompromised()
		const { executionId, taskId, command, workspacePath, timeoutMs } = request
		const resourceScopeId = request.resourceScopeId ?? taskId
		const cwd = request.cwd ?? workspacePath

		// Check for Windows-specific commands before creating a container
		const winDetection = detectWindowsSpecificCommand(command)
		if (winDetection.incompatible) {
			const errorMessage =
				`Command appears to be Windows-specific but Docker backend uses Linux containers.\n` +
				`Reason: ${winDetection.reason}\n` +
				`Please rewrite the command using POSIX shell syntax (bash/sh).\n` +
				`Detected issue in command: ${command.slice(0, 100)}${command.length > 100 ? "..." : ""}`

			logger.warn("DockerSandboxRunner", "Windows command rejected", {
				command,
				taskId,
				reason: winDetection.reason,
			})
			this.emitOutput(
				request.onOutput,
				{ text: errorMessage, isStderr: true, timestamp: Date.now() },
				executionId,
			)

			return {
				executionId,
				backend: "docker",
				exitCode: 1,
				output: errorMessage,
				stderr: errorMessage,
				cancelled: false,
				timedOut: false,
			}
		}

		// Register execution early so disposeTask() can abort during queue wait
		const effectiveTimeoutMs = timeoutMs > 0 ? timeoutMs : this.settings.timeoutSeconds * 1000
		const abortController = new AbortController()
		const context: ExecutionContext = {
			executionId,
			timeoutMs: effectiveTimeoutMs,
			deadline: Date.now() + effectiveTimeoutMs,
			signal: abortController.signal,
		}
		const timeoutHandle = setTimeout(() => abortController.abort(EXECUTION_TIMEOUT_REASON), effectiveTimeoutMs)
		this.activeExecutions.set(executionId, { taskId, resourceScopeId, abortController })

		// Connect external signal
		let externalAbortHandler: (() => void) | undefined
		if (request.signal) {
			if (request.signal.aborted) {
				abortController.abort(EXECUTION_CANCEL_REASON)
			} else {
				externalAbortHandler = () => abortController.abort(EXECUTION_CANCEL_REASON)
				request.signal.addEventListener("abort", externalAbortHandler, { once: true })
			}
		}

		let releaseGlobal: (() => void) | undefined
		let releaseContainer: (() => void) | undefined
		let key: string | undefined
		let container: TaskContainer | undefined
		let executing = false
		try {
			// Acquire shared lease (may wait for exclusive to finish)
			releaseGlobal = await this.gate.acquireShared(abortController.signal)
			this.throwIfContainmentCompromised()

			// Check if cancelled while waiting for lease
			if (abortController.signal.aborted) {
				throw new CommandCancelledError(executionId)
			}

			const canonicalWorkspacePath = await this.waitForExecution(
				this.resolveAndValidateWorkspacePath(workspacePath),
				context,
			)
			const scopedKey = this.containerKey(resourceScopeId, canonicalWorkspacePath)
			key = scopedKey
			const active = this.activeExecutions.get(executionId)
			if (active) active.containerKey = scopedKey

			try {
				releaseContainer = await this.getContainerGate(scopedKey).acquireExclusive(abortController.signal)
			} catch (error) {
				logger.debug("DockerSandboxRunner", "Container lock acquisition failed", { executionId, error })
				if (abortController.signal.aborted) throw new CommandCancelledError(executionId)
				throw error
			}

			if (abortController.signal.aborted) {
				throw new CommandCancelledError(executionId)
			}

			// Get or create a usable container. Failed cancellation cleanup leaves
			// the old container tracked, so it must be removed before replacement.
			while (!container) {
				container = this.containers.get(scopedKey)
				if (container && this.unusableContainers.has(container.containerId)) {
					await this.removeUnusableContainer(scopedKey, container)
					container = undefined
				}
				if (container) break

				let createPromise = this.pendingCreation.get(scopedKey)
				const ownsCreation = !createPromise
				if (!createPromise) {
					createPromise = this.createContainer(
						taskId,
						resourceScopeId,
						canonicalWorkspacePath,
						this.settings.taskScopedContainer ? "task" : "workspace",
						context,
						scopedKey,
					)
						.then(async (created) => {
							this.containers.set(scopedKey, created)
							if (context.signal.aborted) {
								this.unusableContainers.add(created.containerId)
								try {
									await this.removeUnusableContainer(scopedKey, created)
								} catch (error) {
									logger.warn("DockerSandboxRunner", "Failed to remove late-created container", {
										containerId: created.containerId.slice(0, 12),
										error,
									})
								}
								throw this.executionAbortError(context)
							}
							return created
						})
						.finally(() => {
							this.pendingCreation.delete(scopedKey)
						})
					this.pendingCreation.set(scopedKey, createPromise)
				}
				try {
					container = await this.waitForExecution(createPromise, context)
				} catch (error) {
					this.throwIfExecutionStopped(context)
					// A prior timed-out run can release the gate before its aborted
					// docker create callback settles. Ignore only that stale promise.
					if (!ownsCreation) continue
					throw error
				}
				if (this.unusableContainers.has(container.containerId)) {
					await this.removeUnusableContainer(scopedKey, container)
					container = undefined
				}
			}

			// Check if cancelled during container creation
			if (abortController.signal.aborted) {
				throw new CommandCancelledError(executionId)
			}

			// Update active execution with container ID
			const runningExecution = this.activeExecutions.get(executionId)
			if (runningExecution) runningExecution.containerId = container.containerId

			container.imageDigest =
				(await this.waitForExecution(this.ensureContainerRunning(container.containerId, context), context)) ??
				container.imageDigest
			if (abortController.signal.aborted) {
				throw new CommandCancelledError(executionId)
			}

			executing = true
			this.throwIfContainmentCompromised()
			const result = await this.execInContainer(
				container.containerId,
				command,
				cwd,
				workspacePath,
				this.remainingTimeout(context, effectiveTimeoutMs),
				request.environment,
				abortController.signal,
				request.onOutput,
				executionId,
			)

			return {
				executionId,
				backend: "docker",
				containerId: container.containerId,
				imageDigest: container.imageDigest,
				networkMode: this.settings.networkMode,
				memoryMb: this.settings.memoryMb,
				cpuLimit: this.settings.cpuLimit,
				exitCode: result.exitCode,
				output: result.output,
				stdout: result.stdout || undefined,
				stderr: result.stderr || undefined,
				cancelled: false,
				timedOut: false,
				truncated: result.truncated,
				capturedBytes: result.capturedBytes,
			}
		} catch (error) {
			logger.debug("DockerSandboxRunner", "Execution failed", { executionId, error })
			const executionError = this.attachExecutionAuditMetadata(
				this.normalizeExecutionError(error, context),
				container,
			)

			if (
				key &&
				container &&
				(executionError instanceof CommandTimeoutError || executionError instanceof CommandCancelledError)
			) {
				await this.evictAndRemoveContainer(key, container.containerId, executionError)
			}

			if (
				executionError instanceof CommandTimeoutError ||
				executionError instanceof CommandCancelledError ||
				!executing ||
				!container
			) {
				throw executionError
			}

			logger.debug("DockerSandboxRunner", "docker exec failed", { executionId, error: executionError })
			throw this.attachExecutionAuditMetadata(
				new ContainerExecFailedError(
					container.containerId,
					executionError instanceof Error ? executionError.message : String(executionError),
				),
				container,
			)
		} finally {
			clearTimeout(timeoutHandle)
			this.activeExecutions.delete(executionId)
			if (externalAbortHandler && request.signal) {
				request.signal.removeEventListener("abort", externalAbortHandler)
			}
			if (releaseContainer) releaseContainer()
			if (releaseGlobal) releaseGlobal()
		}
	}

	public cancel(executionId: string): Promise<void> {
		const active = this.activeExecutions.get(executionId)
		if (active) {
			active.abortController.abort(EXECUTION_CANCEL_REASON)
			logger.info("DockerSandboxRunner", "cancel", { executionId, containerId: active.containerId })
		}
		return Promise.resolve()
	}

	public async disposeTask(resourceScopeId: string): Promise<void> {
		// Accept taskId as a compatibility fallback for callers not yet using instance scopes.
		for (const [, active] of this.activeExecutions) {
			if (active.resourceScopeId === resourceScopeId || active.taskId === resourceScopeId) {
				active.abortController.abort(EXECUTION_CANCEL_REASON)
			}
		}

		const release = await this.gate.acquireExclusive()
		try {
			if (!this.settings.taskScopedContainer) return
			// A cancelled run can release its shared lease before an underlying
			// docker create callback settles. Wait here so a late-created task
			// container is visible to the removal pass below.
			await Promise.allSettled(Array.from(this.pendingCreation.values()))

			const keysToRemove = Array.from(this.containers.entries())
				.filter(
					([, container]) =>
						container.resourceScopeId === resourceScopeId || container.taskId === resourceScopeId,
				)
				.map(([key]) => key)
			const failures: string[] = []
			for (const key of keysToRemove) {
				const container = this.containers.get(key)
				if (!container) continue
				try {
					await this.removeContainer(container.containerId)
					if (this.containers.get(key)?.containerId === container.containerId) {
						this.containers.delete(key)
					}
					this.pendingCreation.delete(key)
					this.unusableContainers.delete(container.containerId)
					this.containmentFailures.delete(container.containerId)
					this.containerGates.get(key)?.dispose()
					this.containerGates.delete(key)
					logger.info("DockerSandboxRunner", "disposeTask", {
						resourceScopeId,
						containerId: container.containerId.slice(0, 12),
					})
				} catch (error) {
					if (!(await this.stopAndConfirmContainer(container.containerId))) {
						this.containmentFailures.set(
							container.containerId,
							new SandboxContainmentError(container.containerId, "task cleanup failed", { cause: error }),
						)
					}
					failures.push(container.containerId.slice(0, 12))
					logger.warn("DockerSandboxRunner", "disposeTask: failed to remove container", {
						resourceScopeId,
						containerId: container.containerId.slice(0, 12),
						error,
					})
				}
			}
			if (failures.length > 0) {
				throw new Error(`Failed to remove ${failures.length} task container(s): ${failures.join(", ")}`)
			}
		} finally {
			release()
		}
	}

	// ─── Container Lifecycle ─────────────────────────────────────────────

	/** Resolve symlinks and revalidate the canonical directory before mounting it. */
	private async resolveAndValidateWorkspacePath(workspacePath: string): Promise<string> {
		validateDockerWorkspacePath(workspacePath)

		try {
			const canonicalPath = await realpath(workspacePath)
			const workspaceStat = await stat(canonicalPath)
			if (!workspaceStat.isDirectory()) {
				throw new ConfigInvalidError(`Workspace mount path is not a directory: "${workspacePath}"`)
			}

			validateDockerWorkspacePath(canonicalPath)
			validateMountPath(canonicalPath)
			return canonicalPath
		} catch (error) {
			logger.debug("DockerSandboxRunner", "Workspace mount validation failed", { workspacePath, error })
			if (error instanceof ConfigInvalidError) throw error
			throw new ConfigInvalidError(
				`Workspace mount path cannot be resolved: "${workspacePath}" (${error instanceof Error ? error.message : String(error)})`,
			)
		}
	}

	/** Create a new sandbox container for a task or shared workspace. */
	private async createContainer(
		taskId: string,
		resourceScopeId: string,
		workspacePath: string,
		scope: "task" | "workspace",
		context?: ExecutionContext,
		containerKey?: string,
	): Promise<TaskContainer> {
		const s = this.settings
		const containerName = `njust-ai-sandbox-${randomUUID()}`

		// Validate security constraints
		validateDockerWorkspacePath(workspacePath)
		validateDockerImage(s.dockerImage)
		validateNoPrivilegeEscalation({
			privileged: false,
			networkMode: s.networkMode,
		})
		validateMountPath(workspacePath)

		const args: string[] = [
			"create",
			"--name",
			containerName,
			"--pull",
			"never",
			"--no-healthcheck",
			// Security
			"--read-only",
			"--cap-drop",
			"ALL",
			"--security-opt",
			"no-new-privileges",
			"--user",
			"1000:1000",

			// Network
			"--network",
			s.networkMode,

			// Resource limits
			"--memory",
			`${s.memoryMb}m`,
			"--memory-swap",
			`${s.memoryMb}m`,
			"--cpus",
			String(s.cpuLimit),
			"--pids-limit",
			String(s.pidsLimit),

			// Temp filesystem (writable /tmp)
			"--tmpfs",
			"/tmp:size=64m,noexec,nosuid",

			// Workspace mount
			"--mount",
			this.buildMountArg(workspacePath, s.workspaceAccess),

			// Working directory
			"--workdir",
			"/workspace",

			// Labels for identification and cleanup
			"--label",
			`${LABEL_PREFIX}=true`,
			"--label",
			`${LABEL_PREFIX}.scope=${scope}`,
			"--label",
			`${LABEL_PREFIX}.task-id=${scope === "task" ? taskId : "shared"}`,
			"--label",
			`${LABEL_PREFIX}.resource-scope=${scope === "task" ? resourceScopeId : "shared"}`,
			"--label",
			`${LABEL_PREFIX}.workspace=${workspacePath}`,
			"--label",
			`${LABEL_PREFIX}.instance=${this.instanceId}`,

			// Image
			"--entrypoint",
			"/bin/sh",
			s.dockerImage,

			// Keep container alive without executing image metadata.
			"-c",
			"exec sleep infinity",
		]

		try {
			const { stdout } = await execFileAsync("docker", args, {
				timeout: context ? this.remainingTimeout(context, DOCKER_CLI_TIMEOUT_MS) : DOCKER_CLI_TIMEOUT_MS,
				...(context ? { signal: context.signal } : {}),
			})

			const containerId = stdout.trim()
			logger.info("DockerSandboxRunner", "container_created", {
				containerId: containerId.slice(0, 12),
				taskId,
				image: s.dockerImage,
			})

			return {
				taskId,
				resourceScopeId,
				containerId,
				createdAt: Date.now(),
			}
		} catch (error: unknown) {
			if (context?.signal.aborted) {
				const removed = await this.removeContainerIfExists(containerName)
				const abortedError = this.executionAbortError(context)
				if (!removed && containerKey) {
					const orphanedContainer = {
						taskId,
						resourceScopeId,
						containerId: containerName,
						createdAt: Date.now(),
					}
					this.containers.set(containerKey, orphanedContainer)
					this.unusableContainers.add(containerName)
					this.attachExecutionAuditMetadata(abortedError, orphanedContainer)
				}
				throw abortedError
			}

			const err = error as { code?: string; message?: string; stderr?: string }
			logger.debug("DockerSandboxRunner", "container creation failed", {
				taskId,
				resourceScopeId,
				error,
			})

			if (err.code === "ENOENT") {
				throw new DockerNotInstalledError()
			}

			const msg = err.message ?? ""
			const stderr = err.stderr ?? ""

			if (msg.includes("Cannot connect") || msg.includes("daemon")) {
				throw new DaemonNotRunningError()
			}

			if (msg.includes("No such image") || stderr.includes("No such image")) {
				throw new ImageNotFoundError(s.dockerImage)
			}

			throw new ContainerStartFailedError("unknown", msg || stderr)
		}
	}

	/**
	 * Ensure a container is running, start it if stopped.
	 */
	private async ensureContainerRunning(containerId: string, context?: ExecutionContext): Promise<string | undefined> {
		try {
			const { stdout } = await execFileAsync(
				"docker",
				["inspect", "--format", "{{.State.Running}} {{.Image}}", containerId],
				{
					timeout: context ? this.remainingTimeout(context, 10_000) : 10_000,
					...(context ? { signal: context.signal } : {}),
				},
			)

			const [running, imageDigest] = stdout.trim().split(/\s+/, 2)
			if (running !== "true") {
				await execFileAsync("docker", ["start", containerId], {
					timeout: context ? this.remainingTimeout(context, DOCKER_CLI_TIMEOUT_MS) : DOCKER_CLI_TIMEOUT_MS,
					...(context ? { signal: context.signal } : {}),
				})
			}
			return imageDigest || undefined
		} catch (error) {
			logger.debug("DockerSandboxRunner", "Failed to inspect or start container", { containerId, error })
			throw new ContainerStartFailedError(containerId, "Failed to inspect or start container")
		}
	}

	/**
	 * Execute a command inside a running container.
	 */
	private async execInContainer(
		containerId: string,
		command: string,
		cwd: string,
		workspacePath: string,
		timeoutMs: number,
		environment: Record<string, string> | undefined,
		signal: AbortSignal,
		onOutput: (chunk: CommandOutputChunk) => void,
		executionId: string,
	): Promise<{
		exitCode: number
		output: string
		stdout: string
		stderr: string
		truncated: boolean
		capturedBytes: number
	}> {
		const args: string[] = ["exec"]

		// Working directory (map host path to container path)
		const containerWorkdir = this.mapHostPathToContainer(cwd, workspacePath)
		args.push("--workdir", containerWorkdir)

		// Environment variables - filter sensitive and dangerous keys
		if (environment) {
			for (const [key, value] of Object.entries(environment)) {
				if (isSensitiveEnvKey(key) || DANGEROUS_ENV_KEYS.has(key.toUpperCase())) {
					logger.debug("DockerSandboxRunner", "Blocked env var", { key })
					continue
				}
				args.push("--env", `${key}=${value}`)
			}
		}

		args.push(containerId)

		// Use /bin/sh -c for shell command execution
		args.push("/bin/sh", "-c", command)

		return new Promise((resolve, reject) => {
			const stdout = new BoundedOutput()
			const stderr = new BoundedOutput()
			const combinedOutput = new BoundedOutput()
			const stdoutDecoder = new StringDecoder("utf8")
			const stderrDecoder = new StringDecoder("utf8")
			let completionStarted = false
			let decodersFlushed = false
			let timeoutHandle: NodeJS.Timeout | undefined

			const proc = spawn("docker", args, {
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			})

			const emitText = (text: string, isStderr: boolean): void => {
				if (!text) return
				const streamOutput = isStderr ? stderr : stdout
				streamOutput.append(text)
				combinedOutput.append(text)
				this.emitOutput(onOutput, { text, isStderr: isStderr || undefined, timestamp: Date.now() }, executionId)
			}

			const flushDecoders = (): void => {
				if (decodersFlushed) return
				decodersFlushed = true
				emitText(stdoutDecoder.end(), false)
				emitText(stderrDecoder.end(), true)
			}

			const cleanup = (): void => {
				if (timeoutHandle) clearTimeout(timeoutHandle)
				signal.removeEventListener("abort", onAbort)
			}

			const rejectAfterTermination = async (error: Error): Promise<void> => {
				if (completionStarted) return
				completionStarted = true
				cleanup()
				try {
					await this.terminateDockerCli(proc)
				} catch (terminationError) {
					logger.warn("DockerSandboxRunner", "Failed to terminate Docker CLI process", {
						containerId,
						terminationError,
					})
				}
				flushDecoders()
				reject(error)
			}

			const onAbort = (): void => {
				void rejectAfterTermination(new CommandCancelledError(executionId))
			}

			proc.stdout?.on("data", (chunk: Buffer) => {
				emitText(stdoutDecoder.write(chunk), false)
			})

			proc.stderr?.on("data", (chunk: Buffer) => {
				emitText(stderrDecoder.write(chunk), true)
			})

			proc.on("close", (code: number | null) => {
				if (completionStarted) return
				completionStarted = true
				cleanup()
				flushDecoders()
				resolve({
					exitCode: code ?? 1,
					output: combinedOutput.value,
					stdout: stdout.value,
					stderr: stderr.value,
					truncated: combinedOutput.truncated || stdout.truncated || stderr.truncated,
					capturedBytes: combinedOutput.capturedBytes,
				})
			})

			proc.on("error", (error: Error) => {
				if (completionStarted) return
				completionStarted = true
				cleanup()
				logger.debug("DockerSandboxRunner", "docker exec process error", { containerId, error })
				reject(new ContainerExecFailedError(containerId, error.message))
			})

			if (signal.aborted) {
				onAbort()
				return
			}

			signal.addEventListener("abort", onAbort, { once: true })
			if (timeoutMs > 0) {
				timeoutHandle = setTimeout(() => {
					void rejectAfterTermination(new CommandTimeoutError(timeoutMs))
				}, timeoutMs)
			}
		})
	}

	private async terminateDockerCli(proc: ChildProcess): Promise<void> {
		if (proc.exitCode !== null || proc.signalCode !== null) return

		await new Promise<void>((resolve) => {
			let settled = false
			const timers: { force?: NodeJS.Timeout; final?: NodeJS.Timeout } = {}
			const finish = (): void => {
				if (settled) return
				settled = true
				if (timers.force) clearTimeout(timers.force)
				if (timers.final) clearTimeout(timers.final)
				proc.removeListener("close", finish)
				resolve()
			}

			proc.once("close", finish)
			try {
				proc.kill("SIGTERM")
			} catch (error) {
				logger.debug("DockerSandboxRunner", "Failed to terminate Docker CLI process", { error })
				finish()
				return
			}

			timers.force = setTimeout(() => {
				try {
					proc.kill("SIGKILL")
				} catch (error) {
					logger.debug("DockerSandboxRunner", "Failed to force-kill Docker CLI process", { error })
				}
				timers.final = setTimeout(finish, DOCKER_PROCESS_TERMINATION_GRACE_MS)
			}, DOCKER_PROCESS_TERMINATION_GRACE_MS)
		})
	}

	private async evictAndRemoveContainer(key: string, containerId: string, reason: Error): Promise<void> {
		this.unusableContainers.add(containerId)

		try {
			await this.removeContainer(containerId)
			if (this.containers.get(key)?.containerId === containerId) {
				this.containers.delete(key)
			}
			this.pendingCreation.delete(key)
			this.unusableContainers.delete(containerId)
			this.containmentFailures.delete(containerId)
		} catch (error) {
			logger.warn("DockerSandboxRunner", "Failed to remove cancelled container", {
				containerId: containerId.slice(0, 12),
				reason: reason.message,
				error,
			})

			const containmentError = this.attachExecutionAuditMetadata(
				new SandboxContainmentError(containerId, reason.message, { cause: error }),
				this.containers.get(key) ?? { containerId },
			)
			this.containmentFailures.set(containerId, containmentError)
			if (await this.stopAndConfirmContainer(containerId)) {
				this.containmentFailures.delete(containerId)
				return
			}

			throw containmentError
		}
	}

	private async removeUnusableContainer(key: string, container: TaskContainer): Promise<void> {
		await this.removeContainer(container.containerId)
		if (this.containers.get(key)?.containerId === container.containerId) {
			this.containers.delete(key)
		}
		this.pendingCreation.delete(key)
		this.unusableContainers.delete(container.containerId)
		this.containmentFailures.delete(container.containerId)
	}

	private throwIfContainmentCompromised(): void {
		const failure = this.containmentFailures.values().next().value
		if (!failure) return

		const container = Array.from(this.containers.values()).find(
			(candidate) => candidate.containerId === failure.containerId,
		)
		throw this.attachExecutionAuditMetadata(failure, container ?? { containerId: failure.containerId })
	}

	private async recoverContainment(): Promise<void> {
		if (this.containmentFailures.size === 0) return
		const release = await this.gate.acquireExclusive()
		try {
			await this.retryContainmentCleanupInternal()
		} finally {
			release()
		}
	}

	private async retryContainmentCleanupInternal(): Promise<void> {
		for (const containerId of Array.from(this.containmentFailures.keys())) {
			try {
				await this.removeContainer(containerId)
				this.forgetContainer(containerId)
			} catch (error) {
				if (await this.stopAndConfirmContainer(containerId)) {
					this.containmentFailures.delete(containerId)
					continue
				}

				this.containmentFailures.set(
					containerId,
					new SandboxContainmentError(containerId, "cleanup retry failed", { cause: error }),
				)
			}
		}

		this.throwIfContainmentCompromised()
	}

	private forgetContainer(containerId: string): void {
		for (const [key, container] of this.containers) {
			if (container.containerId !== containerId) continue
			this.containers.delete(key)
			this.pendingCreation.delete(key)
			this.containerGates.get(key)?.dispose()
			this.containerGates.delete(key)
		}
		this.unusableContainers.delete(containerId)
		this.containmentFailures.delete(containerId)
	}

	private async stopAndConfirmContainer(containerId: string): Promise<boolean> {
		try {
			await execFileAsync("docker", ["kill", containerId], { timeout: 10_000 })
		} catch (error) {
			logger.debug("DockerSandboxRunner", "docker kill failed during containment", { containerId, error })
		}

		try {
			const { stdout } = await execFileAsync(
				"docker",
				["inspect", "--format", "{{.State.Running}}", containerId],
				{ timeout: 10_000 },
			)
			return stdout.trim() === "false"
		} catch (error) {
			if (this.isMissingContainerError(error)) return true
			logger.warn("DockerSandboxRunner", "Unable to verify container stopped", {
				containerId: containerId.slice(0, 12),
				error,
			})
			return false
		}
	}

	private async removeContainerIfExists(containerId: string): Promise<boolean> {
		try {
			await this.removeContainer(containerId)
			return true
		} catch (error) {
			if (this.isMissingContainerError(error)) return true
			logger.warn("DockerSandboxRunner", "Unable to remove aborted container creation", {
				containerId: containerId.slice(0, 12),
				error,
			})
			return false
		}
	}

	private isMissingContainerError(error: unknown): boolean {
		const detail = error as { message?: string; stderr?: string }
		return /no such (?:container|object)/i.test(`${detail.message ?? ""}\n${detail.stderr ?? ""}`)
	}

	/**
	 * Remove a container forcefully.
	 */
	private async removeContainer(containerId: string): Promise<void> {
		await execFileAsync("docker", ["rm", "-f", containerId], {
			timeout: DOCKER_CLI_TIMEOUT_MS,
		})
		logger.info("DockerSandboxRunner", "container_removed", {
			containerId: containerId.slice(0, 12),
		})
	}

	async disposeAllContainers(): Promise<void> {
		// Abort all active executions
		for (const [, active] of this.activeExecutions) {
			active.abortController.abort(EXECUTION_CANCEL_REASON)
		}

		const release = await this.gate.acquireExclusive()
		try {
			await this.disposeAllContainersInternal()
		} catch (error) {
			logger.warn("DockerSandboxRunner", "disposeAll: some containers could not be removed", { error })
			throw error
		} finally {
			release()
		}
	}

	private async disposeAllContainersInternal(): Promise<void> {
		// Wait for all pending creations to settle
		const pendingSnapshots = Array.from(this.pendingCreation.values())
		await Promise.allSettled(pendingSnapshots)

		// Remove containers: Docker rm first, then Map delete on success
		const keys = Array.from(this.containers.keys())
		const failures: string[] = []
		for (const key of keys) {
			const container = this.containers.get(key)
			if (!container) continue
			try {
				await this.removeContainer(container.containerId)
				this.containers.delete(key)
				this.pendingCreation.delete(key)
				this.unusableContainers.delete(container.containerId)
				this.containmentFailures.delete(container.containerId)
			} catch (error) {
				if (!(await this.stopAndConfirmContainer(container.containerId))) {
					this.containmentFailures.set(
						container.containerId,
						new SandboxContainmentError(container.containerId, "runner cleanup failed", { cause: error }),
					)
				}
				failures.push(container.containerId.slice(0, 12))
				logger.warn("DockerSandboxRunner", "disposeAll: failed to remove container", {
					containerId: container.containerId.slice(0, 12),
					error,
				})
			}
		}
		if (failures.length > 0) {
			throw new Error(`Failed to remove ${failures.length} container(s): ${failures.join(", ")}`)
		}
		for (const containerGate of this.containerGates.values()) {
			containerGate.dispose()
		}
		this.containerGates.clear()
	}

	// ─── Utility ─────────────────────────────────────────────────────────

	/**
	 * Build the Docker mount argument for the workspace.
	 */
	private buildMountArg(workspacePath: string, access: "read-only" | "read-write"): string {
		const readonlyFlag = access === "read-only" ? ",readonly" : ""
		return `type=bind,src=${workspacePath},dst=/workspace${readonlyFlag}`
	}

	/**
	 * Map a host filesystem path to the corresponding container path.
	 * The workspace is mounted at /workspace in the container.
	 * If hostCwd is outside the workspace, falls back to /workspace with a warning.
	 */
	private mapHostPathToContainer(hostCwd: string, workspacePath: string): string {
		const resolved = path.resolve(hostCwd)
		const wsResolved = path.resolve(workspacePath)

		if (!resolved.startsWith(wsResolved + path.sep) && resolved !== wsResolved) {
			logger.warn("DockerSandboxRunner", "cwd outside workspace, falling back to /workspace", {
				hostCwd,
				workspacePath,
			})
			return "/workspace"
		}

		const relative = path.relative(wsResolved, resolved)
		const containerPath = "/workspace" + (relative ? "/" + relative.replace(/\\/g, "/") : "")
		return containerPath
	}

	/**
	 * Clean up stale containers from previous extension sessions (other instances).
	 * Should be called during extension activation.
	 * Only removes containers NOT belonging to this instance.
	 */
	async cleanupStaleContainers(): Promise<number> {
		try {
			await this.recoverContainment()
			// List all sandbox containers with their instance labels
			const { stdout } = await execFileAsync(
				"docker",
				[
					"ps",
					"-a",
					"--filter",
					`label=${LABEL_PREFIX}=true`,
					"--format",
					'{{.ID}} {{.Label "' + LABEL_PREFIX + '.instance"}}',
				],
				{ timeout: DOCKER_CLI_TIMEOUT_MS },
			)

			const lines = stdout.trim().split("\n").filter(Boolean)
			let cleaned = 0
			const failures: string[] = []

			for (const line of lines) {
				const [id, instance] = line.split(" ")
				// Skip containers belonging to this instance
				if (!id || instance === this.instanceId) continue

				// Extract PID from instance label (format: "pid-timestamp")
				const pid = parseInt(instance?.split("-")[0] ?? "", 10)
				if (pid && pid !== process.pid && isProcessAlive(pid)) {
					// Other window is still running, skip
					continue
				}

				try {
					await this.removeContainer(id)
					cleaned++
				} catch (error) {
					failures.push(id.slice(0, 12))
					logger.warn("DockerSandboxRunner", "Failed to remove stale container", {
						containerId: id.slice(0, 12),
						error: error instanceof Error ? error.message : String(error),
					})
				}
			}
			if (failures.length > 0) {
				throw new Error(`Failed to remove ${failures.length} stale container(s): ${failures.join(", ")}`)
			}

			if (cleaned > 0) {
				logger.info("DockerSandboxRunner", "Stale containers cleaned", {
					count: cleaned,
					instanceId: this.instanceId,
				})
			}

			return cleaned
		} catch (error) {
			logger.warn("DockerSandboxRunner", "Failed to cleanup stale containers", {
				error: error instanceof Error ? error.message : String(error),
			})
			throw error
		}
	}

	/**
	 * Pull a Docker image explicitly (triggered from settings UI).
	 * Image pulling is NOT implicit during command execution.
	 */
	async pullImage(image: string, onProgress?: (line: string) => void): Promise<void> {
		validateDockerImage(image)
		logger.info("DockerSandboxRunner", "pullImage", { image })

		return new Promise<void>((resolve, reject) => {
			const proc = spawn("docker", ["pull", image], {
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			})
			const stdoutDecoder = new StringDecoder("utf8")
			const stderrDecoder = new StringDecoder("utf8")
			let settled = false
			const timeoutHandle = setTimeout(() => {
				if (settled) return
				settled = true
				void this.terminateDockerCli(proc)
					.then(() => {
						reject(new CommandTimeoutError(600_000))
					})
					.catch((error) => {
						logger.warn("DockerSandboxRunner", "Failed to terminate timed-out image pull", { image, error })
						reject(error)
					})
			}, 600_000)

			const cleanup = (): void => {
				clearTimeout(timeoutHandle)
			}

			proc.stdout?.on("data", (chunk: Buffer) => {
				const text = stdoutDecoder.write(chunk)
				if (text) onProgress?.(text)
			})

			proc.stderr?.on("data", (chunk: Buffer) => {
				const text = stderrDecoder.write(chunk)
				if (text) onProgress?.(text)
			})

			proc.on("close", (code: number | null) => {
				if (settled) return
				settled = true
				cleanup()
				const stdoutTail = stdoutDecoder.end()
				const stderrTail = stderrDecoder.end()
				if (stdoutTail) onProgress?.(stdoutTail)
				if (stderrTail) onProgress?.(stderrTail)
				if (code === 0) {
					resolve()
				} else {
					reject(new ImageNotFoundError(image))
				}
			})

			proc.on("error", (error: Error) => {
				if (settled) return
				settled = true
				cleanup()
				logger.debug("DockerSandboxRunner", "docker pull process error", { image, error })
				reject(new DockerNotInstalledError(error.message))
			})
		})
	}

	/**
	 * Get the Docker image digest for a local image.
	 */
	async getImageDigest(image: string): Promise<string | undefined> {
		try {
			const { stdout } = await execFileAsync(
				"docker",
				["inspect", "--format", "{{index .RepoDigests 0}}", image],
				{ timeout: 10_000 },
			)
			return stdout.trim() || undefined
		} catch (error) {
			logger.debug("DockerSandboxRunner", "Failed to inspect image digest", { image, error })
			return undefined
		}
	}
}
