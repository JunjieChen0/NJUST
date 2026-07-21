/**
 * Unified command execution interface for sandbox and host execution.
 *
 * This abstraction decouples "what to execute" from "how to execute",
 * enabling the Docker sandbox backend to be plugged in alongside the
 * existing guarded-host runner.
 */

/**
 * Origin of the command — used for audit and policy decisions.
 * - `"local"`        : ExecuteCommandTool (LLM/agent on local machine)
 * - `"cloud-agent"`  : Deferred tool call from cloud agent
 * - `"mcp"`          : MCP server tool invocation
 * - `"user"`         : User-triggered action (run code, cangjie commands)
 * - `"internal"`     : Extension internal (git, ripgrep, etc.)
 */
export type CommandSource = "local" | "cloud-agent" | "mcp" | "user" | "internal"

/**
 * The execution backend to use.
 * - `"guarded-host"` : Run on the host OS with existing safety layers
 * - `"docker"`       : Run inside a Docker sandbox container
 */
export type ExecutionBackend = "guarded-host" | "docker"

export interface CommandAuditContext {
	approvalResult?: "approved" | "denied" | "auto-approved" | "bypass"
	commandSafety?: "safe" | "unsafe" | "skipped"
	interactive?: boolean
	bypass?: boolean
}

export function createTaskResourceScopeId(taskId: string, instanceId: string): string {
	return `task:${taskId}:${instanceId}`
}

/**
 * A chunk of output produced during command execution.
 */
export interface CommandOutputChunk {
	/** The text content of this output chunk. */
	text: string
	/** Whether this chunk is from stderr (default: false → stdout). */
	isStderr?: boolean
	/** Timestamp when the chunk was produced. */
	timestamp?: number
}

/**
 * Request to execute a command.
 *
 * All fields are required except where marked optional.
 */
export interface CommandExecutionRequest {
	/** Unique ID for this execution (used for cancel / audit). */
	executionId: string

	/** Task ID that owns this execution (for container affinity). */
	taskId: string

	/** Unique task/session instance that owns runtime resources. Defaults to taskId. */
	resourceScopeId?: string

	/** The shell command to execute. */
	command: string

	/** Absolute path to the workspace root. */
	workspacePath: string

	/** Working directory inside the workspace (resolved, absolute). */
	cwd?: string

	/** Maximum execution time in milliseconds. */
	timeoutMs: number

	/** Extra environment variables to set (merged with filtered host env). */
	environment?: Record<string, string>

	/** Where the command originated from. */
	source: CommandSource

	/** Callback invoked for each output chunk. */
	onOutput: (chunk: CommandOutputChunk) => void

	/** Optional AbortSignal for external cancellation. */
	signal?: AbortSignal

	/** Security decision metadata recorded with the execution audit. */
	audit?: CommandAuditContext
}

/**
 * Handle to a running or completed command execution.
 */
export interface CommandExecutionHandle {
	/** The execution ID (same as in the request). */
	executionId: string

	/** The backend that was actually used. */
	backend: ExecutionBackend

	/** Container ID if running in Docker (undefined for guarded-host). */
	containerId?: string

	/** Immutable Docker image ID associated with the container. */
	imageDigest?: string

	/** Effective Docker network mode. */
	networkMode?: string

	/** Effective Docker memory limit in MB. */
	memoryMb?: number

	/** Effective Docker CPU limit. */
	cpuLimit?: number

	/** Exit code (undefined if still running or killed by signal). */
	exitCode: number | undefined

	/** Combined output in chronological order (stdout + stderr interleaved). */
	output: string

	/** Standard output only. */
	stdout?: string

	/** Standard error only. */
	stderr?: string

	/** Whether the execution was cancelled. */
	cancelled: boolean

	/** Whether the execution timed out. */
	timedOut: boolean

	/** Whether one or more captured output fields were truncated. */
	truncated?: boolean

	/** UTF-8 bytes retained in the returned output fields. */
	capturedBytes?: number
}

/**
 * Interface that all command execution backends must implement.
 */
export interface CommandRunner {
	/**
	 * Execute a command according to the request.
	 *
	 * @returns A handle containing the execution results.
	 * @throws {SandboxError} on infrastructure failures.
	 * @throws {CommandFailedError} on non-zero exit codes.
	 * @throws {CommandTimeoutError} when timeout is exceeded.
	 * @throws {CommandCancelledError} when cancelled.
	 */
	run(request: CommandExecutionRequest): Promise<CommandExecutionHandle>

	/**
	 * Cancel a running execution by its ID.
	 */
	cancel(executionId: string): Promise<void>

	/**
	 * Release all resources associated with a task/session instance.
	 */
	disposeTask(resourceScopeId: string): Promise<void>
}
