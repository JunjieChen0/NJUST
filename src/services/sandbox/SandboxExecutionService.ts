/**
 * Sandbox Execution Service — central coordinator for command execution.
 *
 * Responsibilities:
 * 1. Read current sandbox configuration
 * 2. Evaluate policy to determine the correct backend
 * 3. Delegate execution to the selected CommandRunner
 * 4. Record audit trail for every execution
 * 5. Manage container/task lifecycle (delegation to DockerSandboxRunner)
 *
 * In Phase 1, only the guarded-host backend is implemented.
 * Docker support is added in Phase 3 (DockerSandboxRunner).
 */

import { v4 as uuidv4 } from "uuid"
import * as vscode from "vscode"

import { logger } from "../../shared/logger"
import type { RooTerminalProcessResultPromise } from "../../integrations/terminal/types"
import type {
	CommandRunner,
	CommandExecutionRequest,
	CommandExecutionHandle,
	ExecutionBackend,
	CommandSource,
} from "./CommandRunner"
import { GuardedHostRunner } from "./GuardedHostRunner"
import type { DockerSandboxRunner } from "./DockerSandboxRunner"
import { evaluatePolicy, resolveBackendForSource, type DockerStatus } from "./SandboxPolicy"
import { sandboxAudit } from "./SandboxAudit"
import {
	CommandCancelledError,
	CommandTimeoutError,
	SandboxError,
	SandboxContainmentError,
	SandboxUnavailableError,
	PolicyDeniedError,
	ConfigInvalidError,
} from "./SandboxErrors"
import type { SandboxSettings } from "./SandboxConfig"

/**
 * Configuration provider interface.
 * Decouples the service from VS Code settings so it can be tested.
 */
export interface SandboxConfigProvider {
	/** Current configured backend. */
	getBackend(): ExecutionBackend

	/** Current Docker availability status. */
	getDockerStatus(): DockerStatus

	/** Maximum command timeout in seconds. */
	getTimeoutSeconds(): number

	/** Update cached Docker status (optional — only providers with mutable state implement this). */
	updateDockerStatus?(status: DockerStatus): void
}

/**
 * Default configuration provider: always returns guarded-host.
 * Replaced by a real provider in Phase 2 when SandboxConfig.ts is added.
 */
class DefaultConfigProvider implements SandboxConfigProvider {
	getBackend(): ExecutionBackend {
		return "guarded-host"
	}

	getDockerStatus(): DockerStatus {
		return "not-installed"
	}

	getTimeoutSeconds(): number {
		return 120
	}
}

export interface SandboxDockerDependencies {
	detectDocker: () => Promise<DockerStatus>
	readSettings: () => SandboxSettings
	createDockerRunner: (settings: SandboxSettings) => DockerSandboxRunner
}

const defaultDockerDeps: SandboxDockerDependencies = {
	detectDocker: async () => {
		const { detectDocker: impl } = await import("./DockerSandboxRunner")
		return impl()
	},
	readSettings: () => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { readSandboxSettings } = require("./SandboxConfig")
		return readSandboxSettings()
	},
	createDockerRunner: (settings: SandboxSettings) => {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const { DockerSandboxRunner } = require("./DockerSandboxRunner")
		return new DockerSandboxRunner(settings)
	},
}

const EXTERNAL_TERMINAL_INTERRUPT_GRACE_MS = 2_000

interface ActiveSandboxOperation {
	executionId: string
	taskId: string
	resourceScopeId: string
	abortController: AbortController
	settled: Promise<void>
	resolveSettled: () => void
	timedOut: boolean
	timeoutMs: number
	deadline?: number
	timeoutHandle?: ReturnType<typeof setTimeout>
	externalSignal?: AbortSignal
	externalAbortHandler?: () => void
}

interface ExternalScopedProcess {
	process: RooTerminalProcessResultPromise
	settled: Promise<void>
	abortRequested: boolean
}

/**
 * Central sandbox execution service.
 *
 * Usage:
 * ```ts
 * const service = SandboxExecutionService.getInstance()
 * const handle = await service.run(request)
 * ```
 */
export class SandboxExecutionService {
	private static instance: SandboxExecutionService | undefined

	private configProvider: SandboxConfigProvider
	private guardedHostRunner: GuardedHostRunner
	private dockerRunner: CommandRunner | undefined
	private deps: SandboxDockerDependencies

	private reconcileFlight: Promise<DockerStatus> | undefined
	private refreshRequested = false
	private disposed = false
	private readonly activeOperations = new Map<string, ActiveSandboxOperation>()
	private readonly closedResourceScopes = new Set<string>()
	private readonly externalProcesses = new Map<string, Set<ExternalScopedProcess>>()

	constructor(configProvider?: SandboxConfigProvider, deps?: SandboxDockerDependencies) {
		this.configProvider = configProvider ?? new DefaultConfigProvider()
		this.guardedHostRunner = new GuardedHostRunner()
		this.deps = deps ?? defaultDockerDeps
	}

	/**
	 * Get or create the singleton service instance.
	 */
	static getInstance(configProvider?: SandboxConfigProvider): SandboxExecutionService {
		if (!SandboxExecutionService.instance) {
			SandboxExecutionService.instance = new SandboxExecutionService(configProvider)
		} else if (configProvider) {
			SandboxExecutionService.instance.configProvider = configProvider
		}
		return SandboxExecutionService.instance
	}

	/**
	 * Reset the singleton (for testing).
	 */
	static resetInstance(): void {
		SandboxExecutionService.instance = undefined
	}

	/**
	 * Execute a command through the sandbox pipeline.
	 *
	 * Flow:
	 * 1. Resolve backend for the command source
	 * 2. Evaluate policy (may throw PolicyDeniedError)
	 * 3. Select the appropriate runner
	 * 4. Record audit start
	 * 5. Execute via the runner
	 * 6. Record audit completion
	 */
	async run(request: CommandExecutionRequest): Promise<CommandExecutionHandle> {
		const source = request.source
		let requestedBackend: ExecutionBackend | "invalid" = source === "internal" ? "guarded-host" : "invalid"
		let effectiveRequest = request
		let decision: ReturnType<typeof evaluatePolicy> | undefined
		let operation: ActiveSandboxOperation | undefined
		let auditStarted = false

		try {
			requestedBackend = this.resolveConfiguredBackend(source)
			effectiveRequest = this.withEffectiveTimeout(request)
			operation = this.beginOperation(effectiveRequest)

			await this.waitForDockerReconcile(requestedBackend, operation)
			this.throwIfOperationAborted(operation)
			decision = evaluatePolicy(
				{
					backend: requestedBackend,
					dockerStatus: this.configProvider.getDockerStatus(),
				},
				source,
			)

			// Runner selection failures are infrastructure failures, not policy
			// denials, and still need a complete audit lifecycle.
			sandboxAudit.recordStart(effectiveRequest, decision.backend, {
				requestedBackend,
				dockerStatus: this.configProvider.getDockerStatus(),
			})
			auditStarted = true

			const runner = this.selectRunner(decision.backend)
			const handle = await runner.run(this.requestForRunner(effectiveRequest, operation))

			sandboxAudit.recordComplete(effectiveRequest.executionId, handle)
			return handle
		} catch (rawError) {
			const error = operation ? this.normalizeOperationError(operation, rawError) : rawError
			const backend = decision?.backend ?? (requestedBackend === "invalid" ? "guarded-host" : requestedBackend)

			if (auditStarted) {
				this.recordExecutionFailure(request.executionId, backend, error)
			} else if (error instanceof PolicyDeniedError || error instanceof ConfigInvalidError) {
				this.recordPreExecutionDenial(request, requestedBackend, error)
			} else if (error instanceof CommandCancelledError || error instanceof CommandTimeoutError) {
				sandboxAudit.recordStart(effectiveRequest, backend, {
					requestedBackend,
					dockerStatus: this.configProvider.getDockerStatus(),
				})
				this.recordExecutionFailure(request.executionId, backend, error)
			}

			throw error
		} finally {
			if (operation) this.finishOperation(operation)
		}
	}

	/**
	 * Cancel a running execution.
	 */
	async cancel(executionId: string): Promise<void> {
		this.activeOperations.get(executionId)?.abortController.abort()
		// Try both runners — only one will have the execution
		await Promise.allSettled([this.guardedHostRunner.cancel(executionId), this.dockerRunner?.cancel(executionId)])
	}

	/** Register a terminal-backed process so scope disposal can abort and await it. */
	registerExternalProcess(resourceScopeId: string, process: RooTerminalProcessResultPromise): () => void {
		let unregistered = false
		const unregister = (): void => {
			if (unregistered) return
			unregistered = true
			const scopedProcesses = this.externalProcesses.get(resourceScopeId)
			scopedProcesses?.delete(tracked)
			if (scopedProcesses?.size === 0) this.externalProcesses.delete(resourceScopeId)
		}
		const settled = Promise.resolve(process).then(
			() => unregister(),
			(error: unknown) => {
				logger.debug("SandboxExecutionService", "External terminal process failed", {
					resourceScopeId,
					error,
				})
				unregister()
			},
		)
		const tracked: ExternalScopedProcess = { process, settled, abortRequested: false }
		let scopedProcesses = this.externalProcesses.get(resourceScopeId)
		if (!scopedProcesses) {
			scopedProcesses = new Set()
			this.externalProcesses.set(resourceScopeId, scopedProcesses)
		}
		scopedProcesses.add(tracked)

		if (this.disposed || this.closedResourceScopes.has(resourceScopeId)) {
			this.abortExternalProcesses([tracked], resourceScopeId)
		}

		return unregister
	}

	/**
	 * Release all resources for a task.
	 */
	async disposeScope(resourceScopeId: string): Promise<void> {
		this.closedResourceScopes.add(resourceScopeId)
		const operations = Array.from(this.activeOperations.values()).filter(
			(operation) => operation.resourceScopeId === resourceScopeId || operation.taskId === resourceScopeId,
		)
		for (const operation of operations) operation.abortController.abort()
		const externalCleanup = this.drainExternalProcesses(resourceScopeId)

		const results = await Promise.allSettled([
			...operations.map((operation) => operation.settled),
			this.guardedHostRunner.disposeTask(resourceScopeId),
			this.dockerRunner?.disposeTask(resourceScopeId),
			externalCleanup,
		])
		const failures: unknown[] = results
			.filter((result): result is PromiseRejectedResult => result.status === "rejected")
			.map((result) => result.reason)
		failures.push(...(await externalCleanup), ...(await this.drainExternalProcesses(resourceScopeId)))

		logger.info("SandboxExecutionService", "disposeScope", { resourceScopeId, failures: failures.length })
		if (failures.length === 1) throw failures[0]
		if (failures.length > 1)
			throw new AggregateError(failures, `Failed to dispose sandbox scope ${resourceScopeId}`)
	}

	/** @deprecated Use disposeScope() with a task/session instance identifier. */
	async disposeTask(taskId: string): Promise<void> {
		await this.disposeScope(taskId)
	}

	/**
	 * Generate a unique execution ID.
	 */
	static generateExecutionId(): string {
		return uuidv4()
	}

	/**
	 * Get the current Docker status.
	 */
	getDockerStatus(): DockerStatus {
		return this.configProvider.getDockerStatus()
	}

	/**
	 * Get the configured backend.
	 */
	getConfiguredBackend(): ExecutionBackend {
		return this.configProvider.getBackend()
	}

	/**
	 * Compute the effective timeout for a command, applying the configured cap.
	 * Internal sources are not capped. Returns 0 if no timeout applies.
	 * requestedMs === 0 means "user explicitly disabled timeout" — pass through.
	 */
	getEffectiveTimeout(requestedMs: number, source: CommandSource): number {
		if (source === "internal") return requestedMs
		if (requestedMs <= 0) return requestedMs
		const capMs = this.configProvider.getTimeoutSeconds() * 1000
		if (capMs <= 0) return requestedMs
		return Math.min(requestedMs, capMs)
	}

	/**
	 * Evaluate policy without recording audit.
	 * Use this when the caller will invoke run() (which handles audit internally)
	 * and only needs to know the backend to decide execution path.
	 *
	 * @returns The resolved backend.
	 * @throws {PolicyDeniedError} if policy denies the execution.
	 */
	async evaluatePolicyOnly(source: CommandSource, request?: CommandExecutionRequest): Promise<ExecutionBackend> {
		let requestedBackend: ExecutionBackend | "invalid" = source === "internal" ? "guarded-host" : "invalid"
		let effectiveRequest = request
		let operation: ActiveSandboxOperation | undefined
		try {
			requestedBackend = this.resolveConfiguredBackend(source)
			if (request) {
				effectiveRequest = this.withEffectiveTimeout(request)
				operation = this.beginOperation(effectiveRequest)
			}
			await this.waitForDockerReconcile(requestedBackend, operation)
			if (operation) this.throwIfOperationAborted(operation)
			return evaluatePolicy(
				{
					backend: requestedBackend,
					dockerStatus: this.configProvider.getDockerStatus(),
				},
				source,
			).backend
		} catch (rawError) {
			const error = operation ? this.normalizeOperationError(operation, rawError) : rawError
			if (request) {
				if (error instanceof PolicyDeniedError || error instanceof ConfigInvalidError) {
					this.recordPreExecutionDenial(request, requestedBackend, error)
				} else if (error instanceof CommandCancelledError || error instanceof CommandTimeoutError) {
					const backend = requestedBackend === "invalid" ? "guarded-host" : requestedBackend
					sandboxAudit.recordStart(effectiveRequest ?? request, backend, {
						requestedBackend,
						dockerStatus: this.configProvider.getDockerStatus(),
					})
					this.recordExecutionFailure(request.executionId, backend, error)
				}
			}
			throw error
		} finally {
			if (operation) this.finishOperation(operation)
		}
	}

	/**
	 * Get the Docker runner instance (may be undefined if Docker is not available).
	 */
	getDockerRunner(): DockerSandboxRunner | undefined {
		return this.dockerRunner as DockerSandboxRunner | undefined
	}

	/**
	 * Initialize Docker backend. Safe to call multiple times — uses single-flight.
	 */
	initializeDocker(): Promise<DockerStatus> {
		return this.refreshDockerBackend()
	}

	/**
	 * Refresh Docker backend status. Merges concurrent calls via single-flight.
	 * If a refresh is requested during an active reconcile, a second reconcile
	 * runs after the current one completes.
	 */
	refreshDockerBackend(): Promise<DockerStatus> {
		this.refreshRequested = true

		if (!this.reconcileFlight) {
			const flight = this.runReconcileLoop()
			this.reconcileFlight = flight

			void flight.finally(() => {
				if (this.reconcileFlight === flight) {
					this.reconcileFlight = undefined
				}
			})
		}

		return this.reconcileFlight
	}

	async pullImage(image: string, onProgress?: (line: string) => void): Promise<void> {
		const runner = await this.requireDockerRunner()
		await runner.pullImage(image, onProgress)
	}

	async cleanupStaleContainers(): Promise<number> {
		const runner = await this.requireDockerRunner()
		return runner.cleanupStaleContainers()
	}

	private async waitForDockerReconcile(backend: ExecutionBackend, operation?: ActiveSandboxOperation): Promise<void> {
		if (backend !== "docker") return

		if (this.reconcileFlight) {
			await this.waitForOperation(this.reconcileFlight, operation)
			return
		}

		if (this.configProvider.getDockerStatus() === "checking") {
			await this.waitForOperation(this.refreshDockerBackend(), operation)
		}
	}

	private async runReconcileLoop(): Promise<DockerStatus> {
		let status: DockerStatus = "not-installed"

		do {
			this.refreshRequested = false
			this.configProvider.updateDockerStatus?.("checking")
			try {
				status = await this.reconcileDocker()
			} catch (error) {
				logger.error("SandboxExecutionService", "reconcileDocker failed", error)
				status = "daemon-not-running"
				this.configProvider.updateDockerStatus?.(status)
			}
		} while (this.refreshRequested && !this.disposed)

		return status
	}

	private async reconcileDocker(): Promise<DockerStatus> {
		const detectedStatus = await this.deps.detectDocker()

		if (detectedStatus !== "available") {
			if (this.configProvider.updateDockerStatus) {
				this.configProvider.updateDockerStatus(detectedStatus)
			}
			return detectedStatus
		}

		if (!this.dockerRunner) {
			try {
				const settings = this.deps.readSettings()
				const candidate = this.deps.createDockerRunner(settings)
				await candidate.cleanupStaleContainers()

				if (this.disposed) {
					await candidate.disposeAllContainers()
					if (this.configProvider.updateDockerStatus) {
						this.configProvider.updateDockerStatus("not-installed")
					}
					return "not-installed"
				}

				this.dockerRunner = candidate
				logger.info("SandboxExecutionService", "Docker runner created")
			} catch (error) {
				logger.error("SandboxExecutionService", "Failed to create Docker runner", error)
				if (this.configProvider.updateDockerStatus) {
					this.configProvider.updateDockerStatus("daemon-not-running")
				}
				return "daemon-not-running"
			}
		} else {
			try {
				const settings = this.deps.readSettings()
				await (this.dockerRunner as DockerSandboxRunner).updateSettings(settings)
			} catch (error) {
				logger.warn("SandboxExecutionService", "Failed to update Docker runner settings", error)
				this.configProvider.updateDockerStatus?.("daemon-not-running")
				return "daemon-not-running"
			}
		}

		if (this.configProvider.updateDockerStatus) {
			this.configProvider.updateDockerStatus("available")
		}
		return "available"
	}

	/**
	 * Dispose the service: wait for pending initialization, clean up runner, reset singleton.
	 */
	async dispose(): Promise<void> {
		this.disposed = true
		const operations = Array.from(this.activeOperations.values())
		for (const operation of operations) operation.abortController.abort()
		const externalCleanup = this.drainExternalProcesses()
		const operationResults = await Promise.allSettled([
			...operations.map((operation) => operation.settled),
			externalCleanup,
		])
		const failures: unknown[] = operationResults
			.filter((result): result is PromiseRejectedResult => result.status === "rejected")
			.map((result) => result.reason)
		failures.push(...(await externalCleanup))

		if (this.reconcileFlight) {
			try {
				await this.reconcileFlight
			} catch (error) {
				logger.debug("SandboxExecutionService", "Docker reconciliation failed during disposal", error)
			}
		}

		if (this.dockerRunner) {
			const runner = this.dockerRunner as DockerSandboxRunner
			try {
				await runner.disposeAllContainers()
				if (this.dockerRunner === runner) this.dockerRunner = undefined
			} catch (error) {
				logger.warn("SandboxExecutionService", "Error disposing docker runner", error)
				failures.push(error)
			}
		}

		failures.push(...(await this.drainExternalProcesses()))
		if (failures.length === 1) throw failures[0]
		if (failures.length > 1) throw new AggregateError(failures, "Failed to dispose sandbox service")
	}

	/**
	 * Evaluate policy and record audit for an execution that will be
	 * performed outside this service (e.g. ExecuteCommandTool's terminal
	 * pipeline, runCode's vscode.window.createTerminal).
	 *
	 * This ensures ALL command executions go through policy evaluation
	 * and audit, even when they use their own execution infrastructure.
	 *
	 * @returns The resolved backend and execution ID.
	 * @throws {PolicyDeniedError} if policy denies the execution.
	 */
	evaluateAndAuditExecution(
		request: CommandExecutionRequest,
		extra?: Partial<import("./SandboxAudit").AuditRecord>,
	): { executionId: string; backend: ExecutionBackend } {
		const source = request.source
		let requestedBackend: ExecutionBackend | "invalid" = source === "internal" ? "guarded-host" : "invalid"
		let decision: ReturnType<typeof evaluatePolicy>
		try {
			this.assertOperationAdmission(request)
			requestedBackend = this.resolveConfiguredBackend(source)
			decision = evaluatePolicy(
				{
					backend: requestedBackend,
					dockerStatus: this.configProvider.getDockerStatus(),
				},
				source,
			)
		} catch (error) {
			this.recordPreExecutionDenial(request, requestedBackend, error)
			throw error
		}

		sandboxAudit.recordStart(request, decision.backend, {
			requestedBackend,
			dockerStatus: this.configProvider.getDockerStatus(),
			...extra,
		})

		return {
			executionId: request.executionId,
			backend: decision.backend,
		}
	}

	/**
	 * Record completion of an externally-executed command.
	 */
	recordExecutionComplete(executionId: string, handle: CommandExecutionHandle, error?: Error): void {
		sandboxAudit.recordComplete(executionId, handle, error)
	}

	recordExecutionDispatched(executionId: string): void {
		sandboxAudit.recordDispatched(executionId)
	}

	/**
	 * Track a command sent through VS Code's raw terminal API.
	 * The terminal is dedicated to this command, so a timeout may safely send
	 * Ctrl+C even when shell-integration end events are unavailable.
	 */
	trackExternalTerminalExecution(executionId: string, terminal: vscode.Terminal, timeoutMs: number): () => void {
		let settled = false
		let timeoutTriggered = false
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined
		let forceDisposeHandle: ReturnType<typeof setTimeout> | undefined
		const listenerDisposables: vscode.Disposable[] = []

		const stopTracking = (): void => {
			if (settled) return
			settled = true
			if (timeoutHandle) clearTimeout(timeoutHandle)
			if (forceDisposeHandle) clearTimeout(forceDisposeHandle)
			for (const disposable of listenerDisposables) disposable.dispose()
		}

		const complete = (exitCode: number | undefined, cancelled: boolean, timedOut: boolean): void => {
			if (settled) return
			stopTracking()
			this.recordExecutionComplete(executionId, {
				executionId,
				backend: "guarded-host",
				exitCode,
				output: "",
				cancelled,
				timedOut,
			})
		}

		const endDisposable = vscode.window.onDidEndTerminalShellExecution?.((event) => {
			if (event.terminal === terminal) {
				complete(event.exitCode, timeoutTriggered, timeoutTriggered)
			}
		})
		if (endDisposable) listenerDisposables.push(endDisposable)

		const closeDisposable = vscode.window.onDidCloseTerminal?.((closedTerminal) => {
			if (closedTerminal === terminal) {
				complete(undefined, true, timeoutTriggered)
			}
		})
		if (closeDisposable) listenerDisposables.push(closeDisposable)

		if (timeoutMs > 0) {
			timeoutHandle = setTimeout(() => {
				timeoutTriggered = true
				try {
					terminal.sendText("\x03", false)
				} catch (error) {
					logger.warn("SandboxExecutionService", "Failed to interrupt external terminal", error)
				}
				forceDisposeHandle = setTimeout(() => {
					try {
						terminal.dispose()
					} catch (error) {
						logger.warn("SandboxExecutionService", "Failed to dispose timed-out external terminal", error)
						complete(undefined, true, true)
					}
				}, EXTERNAL_TERMINAL_INTERRUPT_GRACE_MS)
				forceDisposeHandle.unref?.()
			}, timeoutMs)
			timeoutHandle.unref?.()
		}

		this.recordExecutionDispatched(executionId)
		return stopTracking
	}

	private withEffectiveTimeout(request: CommandExecutionRequest): CommandExecutionRequest {
		const timeoutMs = this.getEffectiveTimeout(request.timeoutMs, request.source)
		return timeoutMs === request.timeoutMs ? request : { ...request, timeoutMs }
	}

	private beginOperation(request: CommandExecutionRequest): ActiveSandboxOperation {
		this.assertOperationAdmission(request)
		if (this.activeOperations.has(request.executionId)) {
			throw new ConfigInvalidError(`Execution ID is already active: ${request.executionId}`)
		}

		let resolveSettled!: () => void
		const settled = new Promise<void>((resolve) => {
			resolveSettled = resolve
		})
		const abortController = new AbortController()
		const operation: ActiveSandboxOperation = {
			executionId: request.executionId,
			taskId: request.taskId,
			resourceScopeId: request.resourceScopeId ?? request.taskId,
			abortController,
			settled,
			resolveSettled,
			timedOut: false,
			timeoutMs: request.timeoutMs,
		}

		if (request.signal) {
			operation.externalSignal = request.signal
			operation.externalAbortHandler = () => abortController.abort()
			if (request.signal.aborted) {
				abortController.abort()
			} else {
				request.signal.addEventListener("abort", operation.externalAbortHandler, { once: true })
			}
		}

		if (request.timeoutMs > 0) {
			operation.deadline = Date.now() + request.timeoutMs
			operation.timeoutHandle = setTimeout(() => {
				if (abortController.signal.aborted) return
				operation.timedOut = true
				abortController.abort()
			}, request.timeoutMs)
			operation.timeoutHandle.unref?.()
		}

		this.activeOperations.set(request.executionId, operation)
		return operation
	}

	private finishOperation(operation: ActiveSandboxOperation): void {
		if (operation.timeoutHandle) clearTimeout(operation.timeoutHandle)
		if (operation.externalSignal && operation.externalAbortHandler) {
			operation.externalSignal.removeEventListener("abort", operation.externalAbortHandler)
		}
		if (this.activeOperations.get(operation.executionId) === operation) {
			this.activeOperations.delete(operation.executionId)
		}
		operation.resolveSettled()
	}

	private throwIfOperationAborted(operation: ActiveSandboxOperation): void {
		if (!operation.abortController.signal.aborted) return
		throw operation.timedOut
			? new CommandTimeoutError(operation.timeoutMs)
			: new CommandCancelledError(operation.executionId)
	}

	private normalizeOperationError(operation: ActiveSandboxOperation, error: unknown): unknown {
		if (error instanceof SandboxContainmentError) return error
		if (operation.timedOut) {
			return error instanceof CommandTimeoutError ? error : new CommandTimeoutError(operation.timeoutMs)
		}
		if (operation.abortController.signal.aborted && !(error instanceof CommandTimeoutError)) {
			return error instanceof CommandCancelledError ? error : new CommandCancelledError(operation.executionId)
		}
		return error
	}

	private assertOperationAdmission(request: CommandExecutionRequest): void {
		if (this.disposed) {
			throw new SandboxUnavailableError("Sandbox execution service is disposed")
		}
		const resourceScopeId = request.resourceScopeId ?? request.taskId
		if (this.closedResourceScopes.has(resourceScopeId)) {
			throw new CommandCancelledError(request.executionId)
		}
	}

	private abortExternalProcesses(processes: ExternalScopedProcess[], resourceScopeId?: string): unknown[] {
		const failures: unknown[] = []
		for (const tracked of processes) {
			if (tracked.abortRequested) continue
			tracked.abortRequested = true
			try {
				tracked.process.abort()
			} catch (error) {
				failures.push(error)
				logger.warn("SandboxExecutionService", "Failed to abort external terminal process", {
					resourceScopeId,
					error,
				})
			}
		}
		return failures
	}

	private async drainExternalProcesses(resourceScopeId?: string): Promise<unknown[]> {
		const failures: unknown[] = []
		while (true) {
			const processes = resourceScopeId
				? Array.from(this.externalProcesses.get(resourceScopeId) ?? [])
				: Array.from(this.externalProcesses.values()).flatMap((entries) => Array.from(entries))
			if (processes.length === 0) return failures
			failures.push(...this.abortExternalProcesses(processes, resourceScopeId))
			await Promise.all(processes.map((tracked) => tracked.settled))
		}
	}

	private requestForRunner(
		request: CommandExecutionRequest,
		operation: ActiveSandboxOperation,
	): CommandExecutionRequest {
		this.throwIfOperationAborted(operation)
		let timeoutMs = operation.timeoutMs
		if (operation.deadline !== undefined) {
			const remainingMs = operation.deadline - Date.now()
			if (remainingMs <= 0) {
				operation.timedOut = true
				operation.abortController.abort()
				this.throwIfOperationAborted(operation)
			}
			timeoutMs = Math.max(1, remainingMs)
		}

		return { ...request, timeoutMs, signal: operation.abortController.signal }
	}

	private async waitForOperation<T>(promise: Promise<T>, operation?: ActiveSandboxOperation): Promise<T> {
		if (!operation) return promise
		this.throwIfOperationAborted(operation)

		return new Promise<T>((resolve, reject) => {
			const signal = operation.abortController.signal
			const onAbort = (): void => {
				signal.removeEventListener("abort", onAbort)
				try {
					this.throwIfOperationAborted(operation)
				} catch (error) {
					reject(error)
				}
			}

			signal.addEventListener("abort", onAbort, { once: true })
			promise.then(
				(value) => {
					signal.removeEventListener("abort", onAbort)
					resolve(value)
				},
				(error) => {
					signal.removeEventListener("abort", onAbort)
					reject(error)
				},
			)
		})
	}

	private recordExecutionFailure(executionId: string, backend: ExecutionBackend, error: unknown): void {
		const auditMetadata = error instanceof SandboxError ? error.auditMetadata : undefined
		const failedHandle: CommandExecutionHandle = {
			executionId,
			backend,
			...auditMetadata,
			exitCode: error instanceof SandboxError ? undefined : 1,
			output: "",
			cancelled: error instanceof CommandCancelledError,
			timedOut: error instanceof CommandTimeoutError,
		}
		sandboxAudit.recordComplete(
			executionId,
			failedHandle,
			error instanceof Error ? error : new Error(String(error)),
		)
	}

	private selectRunner(backend: ExecutionBackend): CommandRunner {
		switch (backend) {
			case "guarded-host":
				return this.guardedHostRunner

			case "docker":
				if (!this.dockerRunner) {
					throw new SandboxUnavailableError(
						"Docker runner not registered. DockerSandboxRunner must be initialized.",
					)
				}
				return this.dockerRunner

			default: {
				const _exhaustive: never = backend
				throw new SandboxUnavailableError(`Unknown backend: ${_exhaustive}`)
			}
		}
	}

	private resolveConfiguredBackend(source: CommandSource): ExecutionBackend {
		if (source === "internal") return "guarded-host"
		return resolveBackendForSource(this.configProvider.getBackend(), source)
	}

	private recordPreExecutionDenial(
		request: CommandExecutionRequest,
		requestedBackend: ExecutionBackend | "invalid",
		error: unknown,
	): void {
		if (!(error instanceof PolicyDeniedError) && !(error instanceof ConfigInvalidError)) return
		sandboxAudit.recordDenial(
			request,
			requestedBackend,
			this.configProvider.getDockerStatus(),
			error instanceof Error ? error.message : String(error),
		)
	}

	private async requireDockerRunner(): Promise<DockerSandboxRunner> {
		const status = await this.refreshDockerBackend()
		if (status !== "available" || !this.dockerRunner) {
			throw new SandboxUnavailableError(`Docker is unavailable (status: ${status})`)
		}
		return this.dockerRunner as DockerSandboxRunner
	}
}
