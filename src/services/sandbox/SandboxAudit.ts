/**
 * Sandbox audit trail.
 *
 * Records every command execution for security auditing and diagnostics.
 * Uses the existing `logger` — never `console.*`.
 *
 * **Do NOT record:** API keys, unfiltered environment variables, or
 * commands containing sensitive values.
 */

import { logger } from "../../shared/logger"
import type { CommandExecutionRequest, CommandExecutionHandle, ExecutionBackend } from "./CommandRunner"

/** A single audit record for one command execution. */
export interface AuditRecord {
	/** Task ID that owns this execution. */
	taskId: string

	/** Runtime resource scope used for cancellation and cleanup. */
	resourceScopeId: string

	/** Unique execution ID. */
	executionId: string

	/** Where the command originated. */
	source: CommandExecutionRequest["source"]

	/** Which backend executed it. */
	backend: ExecutionBackend

	/** Backend requested before policy evaluation. */
	requestedBackend?: ExecutionBackend | "invalid"

	/** Docker availability at policy evaluation time. */
	dockerStatus?: string

	/** Docker container ID (docker backend only). */
	containerId?: string

	/** Docker image digest (docker backend only). */
	imageDigest?: string

	/** Working directory used. */
	cwd: string

	/** Network mode used (docker backend only). */
	networkMode?: string

	/** Memory limit in MB (docker backend only). */
	memoryMb?: number

	/** CPU limit (docker backend only). */
	cpuLimit?: number

	/** Whether user approval was obtained (guarded-host only). */
	approvalResult?: "approved" | "denied" | "auto-approved" | "bypass"

	/** Result of checkCommandSafety (guarded-host only). */
	commandSafety?: "safe" | "unsafe" | "skipped"

	/** Whether execution used an interactive approval path. */
	interactive?: boolean

	/** Whether approval was bypassed. */
	bypass?: boolean

	/** ISO 8601 timestamp when execution started. */
	startedAt: string

	/** Current audit lifecycle state. */
	status: "running" | "completed" | "dispatched"

	/** Time the command was handed to an external terminal whose exit is not observable. */
	dispatchedAt?: string

	/** ISO 8601 timestamp when execution ended. */
	endedAt?: string

	/** Exit code (undefined if still running). */
	exitCode?: number

	/** Whether execution was cancelled. */
	cancelled?: boolean

	/** Whether execution timed out. */
	timedOut?: boolean

	/** Duration in milliseconds. */
	durationMs?: number

	/** Error message if execution failed. */
	error?: string
}

/**
 * Singleton audit service.
 *
 * Maintains an in-memory ring buffer of recent records for diagnostics,
 * and writes structured entries to the logger for persistent storage.
 */
class SandboxAuditService {
	private static readonly MAX_BUFFER_SIZE = 500
	private readonly buffer: AuditRecord[] = []

	/**
	 * Record the start of a command execution.
	 */
	recordStart(request: CommandExecutionRequest, backend: ExecutionBackend, extra?: Partial<AuditRecord>): string {
		const record: AuditRecord = {
			taskId: request.taskId,
			resourceScopeId: request.resourceScopeId ?? request.taskId,
			executionId: request.executionId,
			source: request.source,
			backend,
			cwd: request.cwd ?? request.workspacePath,
			startedAt: new Date().toISOString(),
			status: "running",
			...request.audit,
			...extra,
		}

		this.buffer.push(record)
		this.trimBuffer()

		logger.info("SandboxAudit", "execution_start", {
			executionId: record.executionId,
			taskId: record.taskId,
			resourceScopeId: record.resourceScopeId,
			source: record.source,
			backend: record.backend,
			requestedBackend: record.requestedBackend,
			dockerStatus: record.dockerStatus,
			cwd: record.cwd,
			containerId: record.containerId,
			imageDigest: record.imageDigest,
			networkMode: record.networkMode,
			memoryMb: record.memoryMb,
			cpuLimit: record.cpuLimit,
			approvalResult: record.approvalResult,
			commandSafety: record.commandSafety,
			interactive: record.interactive,
			bypass: record.bypass,
		})

		return record.executionId
	}

	/**
	 * Record the completion of a command execution.
	 */
	recordComplete(executionId: string, handle: CommandExecutionHandle, error?: Error): void {
		const record = this.findRecord(executionId)
		if (!record) {
			logger.warn("SandboxAudit", "recordComplete called for unknown execution", { executionId })
			return
		}

		const now = new Date()
		record.endedAt = now.toISOString()
		record.status = "completed"
		record.exitCode = handle.exitCode
		record.containerId = handle.containerId ?? record.containerId
		record.imageDigest = handle.imageDigest ?? record.imageDigest
		record.networkMode = handle.networkMode ?? record.networkMode
		record.memoryMb = handle.memoryMb ?? record.memoryMb
		record.cpuLimit = handle.cpuLimit ?? record.cpuLimit
		record.cancelled = handle.cancelled
		record.timedOut = handle.timedOut
		record.durationMs = now.getTime() - new Date(record.startedAt).getTime()
		record.error = error?.message

		logger.info("SandboxAudit", "execution_complete", {
			executionId: record.executionId,
			taskId: record.taskId,
			resourceScopeId: record.resourceScopeId,
			backend: record.backend,
			containerId: record.containerId,
			imageDigest: record.imageDigest,
			networkMode: record.networkMode,
			memoryMb: record.memoryMb,
			cpuLimit: record.cpuLimit,
			exitCode: record.exitCode,
			cancelled: record.cancelled,
			timedOut: record.timedOut,
			durationMs: record.durationMs,
			error: record.error,
		})
	}

	/**
	 * Mark an externally-managed terminal command as dispatched.
	 * VS Code's raw sendText API does not provide a reliable exit event, so
	 * this is an explicit terminal audit state rather than a false completion.
	 */
	recordDispatched(executionId: string): void {
		const record = this.findRecord(executionId)
		if (!record) {
			logger.warn("SandboxAudit", "recordDispatched called for unknown execution", { executionId })
			return
		}

		record.status = "dispatched"
		record.dispatchedAt = new Date().toISOString()
		logger.info("SandboxAudit", "execution_dispatched", {
			executionId: record.executionId,
			taskId: record.taskId,
			resourceScopeId: record.resourceScopeId,
			backend: record.backend,
			requestedBackend: record.requestedBackend,
			dockerStatus: record.dockerStatus,
			dispatchedAt: record.dispatchedAt,
		})
	}

	/**
	 * Record a policy denial.
	 */
	recordDenial(
		request: Pick<
			CommandExecutionRequest,
			"executionId" | "taskId" | "resourceScopeId" | "source" | "workspacePath" | "cwd" | "audit"
		>,
		requestedBackend: ExecutionBackend | "invalid",
		dockerStatus: string | undefined,
		reason: string,
	): void {
		const record: AuditRecord = {
			taskId: request.taskId,
			resourceScopeId: request.resourceScopeId ?? request.taskId,
			executionId: request.executionId,
			source: request.source,
			backend: requestedBackend === "invalid" ? "guarded-host" : requestedBackend,
			requestedBackend,
			dockerStatus,
			cwd: request.cwd ?? request.workspacePath,
			startedAt: new Date().toISOString(),
			status: "completed",
			endedAt: new Date().toISOString(),
			...request.audit,
			approvalResult: "denied",
			error: reason,
		}

		this.buffer.push(record)
		this.trimBuffer()

		logger.warn("SandboxAudit", "execution_denied", {
			executionId: request.executionId,
			taskId: request.taskId,
			resourceScopeId: record.resourceScopeId,
			source: request.source,
			requestedBackend,
			dockerStatus,
			cwd: record.cwd,
			reason,
		})
	}

	/**
	 * Get all audit records (most recent first).
	 */
	getRecords(): ReadonlyArray<AuditRecord> {
		return [...this.buffer].reverse()
	}

	/**
	 * Get audit records for a specific task.
	 */
	getRecordsForTask(taskId: string): ReadonlyArray<AuditRecord> {
		return this.buffer.filter((r) => r.taskId === taskId).reverse()
	}

	/**
	 * Clear all buffered records.
	 */
	clear(): void {
		this.buffer.length = 0
	}

	private findRecord(executionId: string): AuditRecord | undefined {
		return this.buffer.find((r) => r.executionId === executionId)
	}

	private trimBuffer(): void {
		while (this.buffer.length > SandboxAuditService.MAX_BUFFER_SIZE) {
			this.buffer.shift()
		}
	}
}

/** Global singleton audit service instance. */
export const sandboxAudit = new SandboxAuditService()
