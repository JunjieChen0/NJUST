/**
 * Sandbox error classification.
 *
 * Each error type maps to a distinct failure mode so that callers can react
 * appropriately (e.g. "Docker not installed" → offer guarded-host fallback in UI).
 */

/** Discriminated union tag for sandbox error categories. */
export type SandboxErrorKind =
	| "DockerNotInstalled"
	| "DaemonNotRunning"
	| "ImageNotFound"
	| "ContainerStartFailed"
	| "ContainerExecFailed"
	| "CommandFailed"
	| "CommandTimeout"
	| "CommandCancelled"
	| "PolicyDenied"
	| "ConfigInvalid"
	| "ContainmentFailed"
	| "SandboxUnavailable"

export interface SandboxErrorAuditMetadata {
	containerId?: string
	imageDigest?: string
	networkMode?: string
	memoryMb?: number
	cpuLimit?: number
}

/**
 * Base class for all sandbox-related errors.
 * Consumers should match on `kind` for branching logic.
 */
export class SandboxError extends Error {
	public readonly kind: SandboxErrorKind
	public auditMetadata?: SandboxErrorAuditMetadata

	constructor(kind: SandboxErrorKind, message: string, options?: ErrorOptions) {
		super(message, options)
		this.name = "SandboxError"
		this.kind = kind
	}
}

/** Docker CLI binary not found on PATH. */
export class DockerNotInstalledError extends SandboxError {
	constructor(message = "Docker CLI not found on PATH") {
		super("DockerNotInstalled", message)
		this.name = "DockerNotInstalledError"
	}
}

/** Docker daemon is not running or unreachable. */
export class DaemonNotRunningError extends SandboxError {
	constructor(message = "Docker daemon is not running") {
		super("DaemonNotRunning", message)
		this.name = "DaemonNotRunningError"
	}
}

/** The requested Docker image does not exist locally or in a registry. */
export class ImageNotFoundError extends SandboxError {
	constructor(image: string) {
		super("ImageNotFound", `Docker image not found: ${image}`)
		this.name = "ImageNotFoundError"
	}
}

/** Container failed to start (permissions, resource limits, etc.). */
export class ContainerStartFailedError extends SandboxError {
	constructor(containerId: string, reason?: string) {
		super(
			"ContainerStartFailed",
			`Container ${containerId.slice(0, 12)} failed to start${reason ? `: ${reason}` : ""}`,
		)
		this.name = "ContainerStartFailedError"
	}
}

/** `docker exec` inside an existing container failed to launch. */
export class ContainerExecFailedError extends SandboxError {
	constructor(containerId: string, reason?: string) {
		super(
			"ContainerExecFailed",
			`docker exec failed in container ${containerId.slice(0, 12)}${reason ? `: ${reason}` : ""}`,
		)
		this.name = "ContainerExecFailedError"
	}
}

/** The command inside the sandbox exited with a non-zero code. */
export class CommandFailedError extends SandboxError {
	public readonly exitCode: number
	public readonly stderr: string

	constructor(exitCode: number, stderr: string) {
		super("CommandFailed", `Command exited with code ${exitCode}`)
		this.name = "CommandFailedError"
		this.exitCode = exitCode
		this.stderr = stderr
	}
}

/** The command exceeded its timeout. */
export class CommandTimeoutError extends SandboxError {
	public readonly timeoutMs: number

	constructor(timeoutMs: number) {
		super("CommandTimeout", `Command timed out after ${timeoutMs}ms`)
		this.name = "CommandTimeoutError"
		this.timeoutMs = timeoutMs
	}
}

/** The command was cancelled by the user or system. */
export class CommandCancelledError extends SandboxError {
	constructor(executionId: string) {
		super("CommandCancelled", `Command execution ${executionId} was cancelled`)
		this.name = "CommandCancelledError"
	}
}

/** Sandbox policy denied the execution (e.g. denied command, network restriction). */
export class PolicyDeniedError extends SandboxError {
	public readonly reason: string

	constructor(reason: string) {
		super("PolicyDenied", `Execution denied by sandbox policy: ${reason}`)
		this.name = "PolicyDeniedError"
		this.reason = reason
	}
}

/** Configuration validation failed (e.g. memory out of range). */
export class ConfigInvalidError extends SandboxError {
	constructor(detail: string) {
		super("ConfigInvalid", `Invalid sandbox configuration: ${detail}`)
		this.name = "ConfigInvalidError"
	}
}

/** Sandbox backend is not available (e.g. Docker was available before but stopped). */
export class SandboxUnavailableError extends SandboxError {
	constructor(reason: string) {
		super("SandboxUnavailable", `Sandbox backend unavailable: ${reason}`)
		this.name = "SandboxUnavailableError"
	}
}

/** Docker could not confirm that a cancelled or timed-out container stopped. */
export class SandboxContainmentError extends SandboxError {
	public readonly containerId: string

	constructor(containerId: string, reason?: string, options?: ErrorOptions) {
		super(
			"ContainmentFailed",
			`Unable to confirm container ${containerId.slice(0, 12)} stopped${reason ? `: ${reason}` : ""}`,
			options,
		)
		this.name = "SandboxContainmentError"
		this.containerId = containerId
	}
}

/**
 * Type guard for SandboxError instances.
 */
export function isSandboxError(error: unknown): error is SandboxError {
	return error instanceof SandboxError
}
