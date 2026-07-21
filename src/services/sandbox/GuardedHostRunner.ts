/**
 * Guarded host runner — executes commands on the host OS using execa.
 *
 * Preserves all existing safety layers:
 * - `filterSensitiveEnv()` filters credential env vars
 * - Shell metacharacter blocking (dangerous chaining operators)
 * - Output streaming, exit code handling, timeout, and cancellation
 *
 * This runner does NOT use TerminalRegistry — it uses execa directly,
 * making it a standalone command execution backend that satisfies the
 * CommandRunner interface.
 *
 * For interactive terminal display (ExecuteCommandTool), the
 * SandboxExecutionService exposes evaluateAndAuditExecution() which
 * allows the tool to use its own terminal pipeline while still
 * going through policy evaluation and audit.
 */

import { StringDecoder } from "string_decoder"
import { execa, ExecaError } from "execa"

import { logger } from "../../shared/logger"
import { filterSensitiveEnv, isSensitiveEnvKey, mergeSafeEnv } from "../../utils/env"
import { normalizeDotSlashCommandForWindowsShell } from "../../utils/hostShellCommand"
import { BaseTerminal } from "../../integrations/terminal/BaseTerminal"

import type { CommandRunner, CommandExecutionRequest, CommandExecutionHandle, ExecutionBackend } from "./CommandRunner"
import { CommandFailedError, CommandTimeoutError, CommandCancelledError } from "./SandboxErrors"
import { BoundedOutput } from "./BoundedOutput"
import { containsShellIoRedirection } from "./commandSecurity"
import { prepareTrustedReadOnlyGitCommand } from "./trustedGitCommand"

/** Tracks an active execution for cancellation support. */
interface ActiveExecution {
	executionId: string
	taskId: string
	resourceScopeId: string
	abortController: AbortController
	timedOut: boolean
	settled: Promise<void>
}

/**
 * Command substitution operators — always blocked regardless of source.
 * These allow arbitrary nested command execution that bypasses approval.
 */
const COMMAND_SUBSTITUTION = /\$\(|`|\$\{/

/**
 * Shell chaining operators — blocked only for untrusted remote sources (mcp, cloud-agent).
 * Local/user-approved commands may use &&, ||, |, ; for normal workflow.
 */
const SHELL_CHAINING = /[;&|]/

function buildExecutionEnvironment(environment?: Record<string, string>): Record<string, string | undefined> {
	const filteredHostEnv = mergeSafeEnv({}, filterSensitiveEnv(), "GuardedHostRunner host environment")
	const filteredRequestEnv = Object.fromEntries(
		Object.entries(environment ?? {}).filter(([key]) => !isSensitiveEnvKey(key)),
	)
	const merged = mergeSafeEnv(filteredHostEnv, filteredRequestEnv, "GuardedHostRunner request environment")

	merged.LANG = "en_US.UTF-8"
	merged.LC_ALL = "en_US.UTF-8"
	return merged
}

function buildTrustedGitEnvironment(
	environment: Record<string, string> | undefined,
	workspacePath: string,
): Record<string, string | undefined> {
	const merged = buildExecutionEnvironment(environment)
	for (const key of Object.keys(merged)) {
		if (key.toUpperCase().startsWith("GIT_")) delete merged[key]
	}
	merged.GIT_CEILING_DIRECTORIES = workspacePath
	merged.GIT_CONFIG_NOSYSTEM = "1"
	merged.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null"
	merged.GIT_NO_LAZY_FETCH = "1"
	merged.GIT_OPTIONAL_LOCKS = "0"
	merged.GIT_PAGER = ""
	merged.GIT_ATTR_NOSYSTEM = "1"
	merged.GIT_TERMINAL_PROMPT = "0"
	return merged
}

export class GuardedHostRunner implements CommandRunner {
	private readonly activeExecutions = new Map<string, ActiveExecution>()

	public async run(request: CommandExecutionRequest): Promise<CommandExecutionHandle> {
		const { executionId, taskId, command, workspacePath, timeoutMs } = request
		const cwd = request.cwd ?? workspacePath

		logger.info("GuardedHostRunner", "run", {
			executionId,
			taskId,
			cwd,
			timeoutMs,
		})

		// Phase 1: Command substitution is always dangerous — allows arbitrary
		// nested command execution that bypasses the approval gate.
		if (COMMAND_SUBSTITUTION.test(command)) {
			logger.error("GuardedHostRunner", "Command blocked: command substitution", {
				executionId,
				command: command.slice(0, 200),
			})
			throw new CommandFailedError(
				1,
				"Command blocked for security: contains command substitution operators ($(), ``, ${}).",
			)
		}

		// Phase 2: Shell chaining blocked for remote/untrusted sources only.
		// Local commands have been explicitly approved by the user.
		const isRemoteSource = request.source === "mcp" || request.source === "cloud-agent"
		if (isRemoteSource && SHELL_CHAINING.test(command)) {
			logger.error("GuardedHostRunner", "Remote command blocked: shell chaining", {
				executionId,
				command: command.slice(0, 200),
			})
			throw new CommandFailedError(
				1,
				"Command blocked for security: remote commands cannot use shell chaining operators (;, &, |).",
			)
		}

		if ((request.source === "mcp" || request.source === "cloud-agent") && containsShellIoRedirection(command)) {
			logger.error("GuardedHostRunner", "Remote command blocked: shell I/O redirection", {
				executionId,
				command: command.slice(0, 200),
			})
			throw new CommandFailedError(
				1,
				"Command blocked for security: shell I/O redirection is not allowed for remote commands.",
			)
		}

		const abortController = new AbortController()
		let resolveSettled!: () => void
		const settled = new Promise<void>((resolve) => {
			resolveSettled = resolve
		})
		const active: ActiveExecution = {
			executionId,
			taskId,
			resourceScopeId: request.resourceScopeId ?? taskId,
			abortController,
			timedOut: false,
			settled,
		}
		this.activeExecutions.set(executionId, active)

		// Handle external signal
		if (request.signal) {
			if (request.signal.aborted) {
				abortController.abort()
			} else {
				request.signal.addEventListener("abort", () => abortController.abort(), { once: true })
			}
		}

		// Handle timeout via AbortSignal
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined
		if (timeoutMs > 0) {
			timeoutHandle = setTimeout(() => {
				if (abortController.signal.aborted) return
				active.timedOut = true
				abortController.abort()
			}, timeoutMs)
		}

		try {
			const shellPath = BaseTerminal.getExecaShellPath()
			const normalizedCommand = normalizeDotSlashCommandForWindowsShell(command, shellPath)
			const trustedGitCommand =
				request.source === "mcp" || request.source === "cloud-agent"
					? await prepareTrustedReadOnlyGitCommand(command, workspacePath, { cwd })
					: undefined
			const stdoutOutput = new BoundedOutput()
			const stderrOutput = new BoundedOutput()
			const combinedOutput = new BoundedOutput()
			const stdoutDecoder = new StringDecoder("utf8")
			const stderrDecoder = new StringDecoder("utf8")

			const emitOutput = (text: string, isStderr: boolean) => {
				if (text.length === 0) {
					return
				}

				if (isStderr) {
					stderrOutput.append(text)
				} else {
					stdoutOutput.append(text)
				}
				combinedOutput.append(text)

				try {
					request.onOutput({ text, isStderr: isStderr || undefined, timestamp: Date.now() })
				} catch (error) {
					logger.debug("GuardedHostRunner", "onOutput callback failed", error)
				}
			}

			const execaOptions = {
				cwd,
				stdin: "ignore" as const,
				env: trustedGitCommand
					? buildTrustedGitEnvironment(request.environment, trustedGitCommand.ceilingDirectory)
					: buildExecutionEnvironment(request.environment),
				extendEnv: false,
				buffer: false,
				cancelSignal: abortController.signal,
				timeout: timeoutMs > 0 ? timeoutMs + 5000 : undefined,
			}
			const subprocess = trustedGitCommand
				? execa(trustedGitCommand.executable, trustedGitCommand.args, { ...execaOptions, shell: false })
				: execa({ ...execaOptions, shell: shellPath || true })`${normalizedCommand}`

			if (subprocess.stdout) {
				subprocess.stdout.on("data", (chunk: Buffer | string) => {
					emitOutput(stdoutDecoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk), false)
				})
			}

			if (subprocess.stderr) {
				subprocess.stderr.on("data", (chunk: Buffer | string) => {
					emitOutput(stderrDecoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk), true)
				})
			}

			let decodersFlushed = false
			const flushDecoders = () => {
				if (decodersFlushed) {
					return
				}
				decodersFlushed = true
				emitOutput(stdoutDecoder.end(), false)
				emitOutput(stderrDecoder.end(), true)
			}

			let result
			try {
				result = await subprocess
			} catch (execError: unknown) {
				flushDecoders()
				logger.debug("GuardedHostRunner", "subprocess failed", execError)

				if (active.timedOut) {
					throw new CommandTimeoutError(timeoutMs)
				}

				if (abortController.signal.aborted && !active.timedOut) {
					throw new CommandCancelledError(executionId)
				}

				if (execError instanceof ExecaError) {
					if (stderrOutput.value.length === 0 && typeof execError.stderr === "string") {
						stderrOutput.append(execError.stderr)
						if (combinedOutput.value.length === 0) {
							combinedOutput.append(execError.stderr)
						}
					}

					const fallbackOutput = new BoundedOutput()
					fallbackOutput.append(execError.message)
					const outputCapture = combinedOutput.value ? combinedOutput : fallbackOutput
					return {
						executionId,
						backend: "guarded-host" as ExecutionBackend,
						exitCode: execError.exitCode ?? 1,
						output: outputCapture.value,
						stdout: stdoutOutput.value || undefined,
						stderr: stderrOutput.value || undefined,
						cancelled: false,
						timedOut: false,
						truncated: outputCapture.truncated,
						capturedBytes: outputCapture.capturedBytes,
					}
				}

				throw execError
			}

			flushDecoders()

			const handle: CommandExecutionHandle = {
				executionId,
				backend: "guarded-host" as ExecutionBackend,
				exitCode: result.exitCode ?? 0,
				output: combinedOutput.value,
				stdout: stdoutOutput.value || undefined,
				stderr: stderrOutput.value || undefined,
				cancelled: false,
				timedOut: false,
				truncated: combinedOutput.truncated,
				capturedBytes: combinedOutput.capturedBytes,
			}

			return handle
		} catch (error) {
			logger.debug("GuardedHostRunner", "run failed", error)

			if (
				error instanceof CommandTimeoutError ||
				error instanceof CommandCancelledError ||
				error instanceof CommandFailedError
			) {
				throw error
			}

			const errMsg = error instanceof Error ? error.message : String(error)
			throw new CommandFailedError(1, errMsg)
		} finally {
			this.activeExecutions.delete(executionId)
			if (timeoutHandle) clearTimeout(timeoutHandle)
			resolveSettled()
		}
	}

	public cancel(executionId: string): Promise<void> {
		const active = this.activeExecutions.get(executionId)
		if (active) {
			active.abortController.abort()
			logger.info("GuardedHostRunner", "cancel", { executionId })
		} else {
			logger.warn("GuardedHostRunner", "cancel called for unknown execution", { executionId })
		}
		return Promise.resolve()
	}

	public async disposeTask(resourceScopeId: string): Promise<void> {
		const matchingExecutions = [...this.activeExecutions.values()].filter(
			(active) => active.resourceScopeId === resourceScopeId || active.taskId === resourceScopeId,
		)

		for (const active of matchingExecutions) {
			active.abortController.abort()
			logger.info("GuardedHostRunner", "disposeTask: cancelled execution", {
				resourceScopeId,
				executionId: active.executionId,
			})
		}

		await Promise.all(matchingExecutions.map((active) => active.settled))
	}
}
