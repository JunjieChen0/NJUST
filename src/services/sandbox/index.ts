/**
 * Sandbox module — public API barrel export.
 *
 * Import from this module to access sandbox capabilities:
 * ```ts
 * import { SandboxExecutionService, type CommandExecutionRequest } from "../../services/sandbox"
 * ```
 */

// Core interfaces
export type {
	CommandRunner,
	CommandExecutionRequest,
	CommandExecutionHandle,
	CommandOutputChunk,
	CommandSource,
	ExecutionBackend,
	CommandAuditContext,
} from "./CommandRunner"
export { createTaskResourceScopeId } from "./CommandRunner"

// Error types
export {
	SandboxError,
	isSandboxError,
	DockerNotInstalledError,
	DaemonNotRunningError,
	ImageNotFoundError,
	ContainerStartFailedError,
	ContainerExecFailedError,
	CommandFailedError,
	CommandTimeoutError,
	CommandCancelledError,
	PolicyDeniedError,
	ConfigInvalidError,
	SandboxContainmentError,
	SandboxUnavailableError,
} from "./SandboxErrors"
export type { SandboxErrorKind, SandboxErrorAuditMetadata } from "./SandboxErrors"

// Policy engine
export { evaluatePolicy, resolveBackendForSource } from "./SandboxPolicy"
export type { PolicyDecision, PolicyConfig, DockerStatus } from "./SandboxPolicy"

// Audit
export { sandboxAudit } from "./SandboxAudit"
export type { AuditRecord } from "./SandboxAudit"

// Runners
export { GuardedHostRunner } from "./GuardedHostRunner"
export { DockerSandboxRunner, detectDocker } from "./DockerSandboxRunner"

// Concurrency control
export { ConcurrencyGate } from "./ConcurrencyGate"

// Service (main entry point)
export { SandboxExecutionService } from "./SandboxExecutionService"
export type { SandboxConfigProvider, SandboxDockerDependencies } from "./SandboxExecutionService"

// Command compatibility detection
export { detectWindowsSpecificCommand } from "./commandCompatibility"
export type { WindowsDetectionResult } from "./commandCompatibility"

// Command security checks
export { containsShellIoRedirection } from "./commandSecurity"

// Configuration
export {
	DEFAULT_SETTINGS,
	readSandboxSettings,
	buildValidatedSettings,
	validateDockerImage,
	validateMountPath,
	validateNoPrivilegeEscalation,
	VSCodeSandboxConfigProvider,
} from "./SandboxConfig"
export type { SandboxSettings, NetworkMode, WorkspaceAccess } from "./SandboxConfig"
