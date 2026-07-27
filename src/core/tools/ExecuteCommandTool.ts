import fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import { z } from "zod"

import delay from "delay"

import {
	CommandExecutionStatus,
	DEFAULT_TERMINAL_OUTPUT_PREVIEW_SIZE,
	PersistedCommandOutput,
	TelemetryEventName,
} from "@njust-ai/types"
import { TelemetryService } from "@njust-ai/telemetry"

import { Task } from "../task/Task"

import { ToolUse, ToolResponse } from "../../shared/tools"
import { formatResponse } from "../prompts/responses"
import { buildCangjieExecuteCommandErrorAppendix } from "../prompts/sections/cangjie-context"
import { unescapeHtmlEntities } from "../../utils/text-normalization"
import {
	ExitCodeDetails,
	RooTerminalCallbacks,
	RooTerminalProcess,
	RooTerminalProcessResultPromise,
} from "../../integrations/terminal/types"
import { TerminalRegistry } from "../../integrations/terminal/TerminalRegistry"
import { Terminal } from "../../integrations/terminal/Terminal"
import { OutputInterceptor } from "../../integrations/terminal/OutputInterceptor"
import { Package } from "../../shared/package"
import { t } from "../../i18n"
import { ignoreAbortError } from "../../utils/errorHandling"
import { getTaskDirectoryPath } from "../../utils/storage"
import { normalizeDotSlashCommandForWindowsShell } from "../../utils/hostShellCommand"
import { BaseTerminal } from "../../integrations/terminal/BaseTerminal"
import { wrapAsError } from "../../shared/error-utils"
import { BaseTool, ToolCallbacks, type ValidationResult } from "./BaseTool"
import { recordSecurityMetric } from "../security/metrics"
import { checkCommandSafety } from "./helpers/commandSafety"
import { logger } from "../../shared/logger"
import { TIMING } from "../../shared/constants"
import { resolveWithinWorkspaceAsync } from "../../utils/resolveWithinWorkspace"
import {
	SandboxExecutionService,
	SandboxError,
	createTaskResourceScopeId,
	type CommandAuditContext,
	type CommandExecutionRequest,
} from "../../services/sandbox"

/** Uses {@link checkCommandSafety} so high-risk detection stays aligned with permission classifiers. */
function _isHighRiskShellCommand(command: string): boolean {
	const { riskLevel } = checkCommandSafety(command)
	return riskLevel === "forbidden" || riskLevel === "dangerous"
}

/**
 * Patterns for commands whose effects are effectively irreversible (destroying
 * local work, shared history, or deleting user data). These require explicit
 * confirmation even when the task is running in bypass mode — bypass is an
 * opt-in "skip routine confirmations" mode, not a license to silently run
 * catastrophic commands. Forbidden commands are already hard-blocked above;
 * this list covers the destructive-but-not-forbidden tier.
 *
 * NOTE: these intentionally err toward matching. The consequence of a false
 * positive is an extra confirmation click; the consequence of a false negative
 * is silent data loss / force-push in bypass mode.
 */
// Exported for direct unit testing (the full tool pipeline requires heavy
// mocking of terminals/approval); see __tests__/ExecuteCommandTool.bypass.spec.ts.
export const BYPASS_PROTECTED_PATTERNS: RegExp[] = [
	// Recursive/forced deletion. Covers `-rf`, `-fr`, `-r`, `-R`, combined short
	// flags like `-rvf`, and the GNU long options `--recursive` / `--force`.
	/\brm\s+(-[a-z]*r[a-z]*f?|-[a-z]*f[a-z]*r?|-[a-z]*R|--recursive|--force)\b/,
	// Destructive force push to a shared remote. The `.*` allows a refspec
	// between `push` and the flag (e.g. `git push origin --force`). Negative
	// lookahead exempts the safe variants `--force-with-lease` and
	// `--force-if-includes` (which refuse to push if the remote has moved).
	/\bgit\s+push\s+.*--force(?!(?:-with-lease|-if-includes))(?![a-z-])\b/,
	// Short-form force push, including a refspec in the middle:
	// `git push -f`, `git push origin -f`, `git push origin -f main`.
	// `(?:\s.*)?` optionally consumes intervening args before `-f`.
	/\bgit\s+push\s+(?:.*\s)?-f\b/,
	/\bgit\s+reset\s+--hard\b/, // discard all local changes
	/\bgit\s+clean\s+-[a-z]*[fdx]/, // delete untracked/ignored files
	/\btruncate\s+-s\s*0\b/, // wipe file contents
	// Fork bomb shapes. `:` is a non-word char so no `\b` anchor is valid
	// before it; the body is matched loosely to cover spacing variants like
	// `:(){ :|:& }`, `: () { : | : & }`, and `:(){:|:&}`.
	/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,
]

export function isSuccessfulCommandResult(result: unknown, rejected: boolean): boolean {
	if (rejected) return false
	const text = String(result)
	const exitCodeMatch = text.match(/Exit code:\s*(-?\d+)/i)
	if (exitCodeMatch) return Number(exitCodeMatch[1]) === 0
	return !/(?:^Command execution failed|Command execution was not successful|\bcjpm\s+build\s+failed\b)/im.test(text)
}

import { NamedError } from "@njust-ai/core/shared"

class ShellIntegrationError extends NamedError {}

interface ExecuteCommandParams {
	command: string
	cwd?: string
	timeout?: number | null
}

const MIN_CLI_TIMEOUT_MS = TIMING.MIN_CLI_TIMEOUT_MS
const CANGJIE_TOOLCHAIN_SEGMENT_RE = /^\s*(?:cjpm|cjc|cjlint|cjfmt|cjdb|cjprof)\b/i
const CANGJIE_TOOLCHAIN_COMMAND_RE = /\b(?:cjpm|cjc|cjlint|cjfmt|cjdb|cjprof)\b/i

export function isCangjieToolchainCommand(command: string): boolean {
	const segments = command
		.split(/&&|\|\||;|\|/)
		.map((segment) => segment.trim())
		.filter(Boolean)

	return (
		segments.some((segment) => CANGJIE_TOOLCHAIN_SEGMENT_RE.test(segment)) ||
		CANGJIE_TOOLCHAIN_COMMAND_RE.test(command)
	)
}

export function validateCangjieImplementCommand(agentType: string | undefined, command: string): string | null {
	if (agentType !== "CangjieImplement") return null
	if (/^\s*cjpm\s+init(?:\s|$)/i.test(command) && !/[;&|]/.test(command)) return null
	return "CangjieImplement may execute only one direct cjpm init command. Delegate build/check/lint verification to CangjieVerify."
}

export function resolveAgentTimeoutMs(timeoutSeconds: number | null | undefined): number {
	const requestedAgentTimeout = typeof timeoutSeconds === "number" && timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0

	// In CLI runtime, apply a minimum timeout to prevent permanent blocking
	// from malicious or malformed commands. User settings can extend but not
	// reduce below the floor.
	if (process.env.NJUST_AI_CLI_RUNTIME === "1") {
		return requestedAgentTimeout > 0 ? Math.max(requestedAgentTimeout, MIN_CLI_TIMEOUT_MS) : MIN_CLI_TIMEOUT_MS
	}
	return requestedAgentTimeout
}

export class ExecuteCommandTool extends BaseTool<"execute_command"> {
	readonly name = "execute_command" as const
	override readonly maxResultSizeChars = 100_000

	protected override get inputSchema() {
		return z.object({
			command: z.string().min(1, "command is required"),
			cwd: z.string().optional().nullable(),
			timeout: z.number().optional().nullable(),
		})
	}

	override validateInput(params: ExecuteCommandParams): ValidationResult {
		if (!params.command || params.command.trim() === "") {
			return { valid: false, error: "Command is required and cannot be empty." }
		}
		return { valid: true }
	}

	async execute(params: ExecuteCommandParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { command, cwd: customCwd, timeout: timeoutSeconds } = params
		const { handleError, pushToolResult, askApproval, reportProgress } = callbacks

		try {
			const canonicalCommand = unescapeHtmlEntities(command)
			await reportProgress?.({ icon: "terminal", text: "Preparing command execution" })

			const implementCommandError = validateCangjieImplementCommand(task.agentType, canonicalCommand)
			if (implementCommandError) {
				task.recordToolError("execute_command", implementCommandError)
				pushToolResult(formatResponse.toolError(implementCommandError))
				return
			}

			if (task.taskMode === "cangjie" || isCangjieToolchainCommand(canonicalCommand)) {
				const cangjieCommandError = task.cangjieRuntimePolicy.validateCommandSurface(canonicalCommand)
				if (cangjieCommandError) {
					task.recordToolError("execute_command", cangjieCommandError)
					pushToolResult(formatResponse.toolError(cangjieCommandError))
					return
				}
			}

			{
				const earlyState = await task.providerRef.deref()?.getState()
				if (earlyState?.enableWebSearch && isHttpCommand(canonicalCommand)) {
					pushToolResult(
						"This command attempts to make an HTTP request (curl/wget/etc.), which is blocked. " +
							"Use the web_search tool instead to retrieve information from the internet. " +
							'Example: { "search_query": "your query here", "count": 5 }',
					)
					return
				}
			}

			const ignoredFileAttemptedToAccess = task.rooIgnoreController?.validateCommand(canonicalCommand)

			if (ignoredFileAttemptedToAccess) {
				await task.say("rooignore_error", ignoredFileAttemptedToAccess)
				pushToolResult(formatResponse.rooIgnoreError(ignoredFileAttemptedToAccess))
				return
			}

			task.consecutiveMistakeCount = 0

			const safetyCheck = checkCommandSafety(canonicalCommand)
			const permissionRuleEngine = (task as Task & { permissionRuleEngine?: { getMode(): string } })
				.permissionRuleEngine
			const isBypassMode = permissionRuleEngine?.getMode?.() === "bypass"

			// Always block forbidden commands, even in bypass mode
			if (safetyCheck.riskLevel === "forbidden") {
				logger.warn("ExecuteCommandTool", "execute_command: forbidden command blocked:", canonicalCommand)
				recordSecurityMetric("execute_command_high_risk", {
					cmd: canonicalCommand.slice(0, 240),
					riskLevel: safetyCheck.riskLevel,
					reasons: safetyCheck.reasons.slice(0, 5).join(", "),
				})
				pushToolResult(formatResponse.toolError(`Forbidden command blocked: ${safetyCheck.reasons.join("; ")}`))
				return
			}

			// A small set of catastrophic, effectively irreversible patterns that
			// demand explicit confirmation even in bypass mode. Bypass mode is an
			// opt-in "skip routine confirmations" mode, not a license to silently
			// run commands that destroy work or shared state. When matched we keep
			// the normal approval flow regardless of bypass.
			const requiresConfirmationEvenInBypass = BYPASS_PROTECTED_PATTERNS.some((p) => p.test(canonicalCommand))

			if (safetyCheck.requiresConfirmation) {
				if (!isBypassMode) {
					logger.warn(
						"ExecuteCommandTool",
						"execute_command: high-risk pattern; user must approve in UI:",
						canonicalCommand,
					)
				} else if (requiresConfirmationEvenInBypass) {
					logger.warn(
						"ExecuteCommandTool",
						"execute_command: catastrophic pattern; confirmation enforced despite bypass mode:",
						canonicalCommand,
					)
				} else {
					// In bypass mode, user confirmation is skipped but the
					// dangerous command is still executed. Record a separate
					// audit metric so security review can find bypassed
					// high-risk executions.
					logger.warn(
						"ExecuteCommandTool",
						"execute_command: high-risk pattern; bypass mode, user confirmation skipped:",
						canonicalCommand,
					)
				}
				recordSecurityMetric(isBypassMode ? "execute_command_high_risk_bypass" : "execute_command_high_risk", {
					cmd: canonicalCommand.slice(0, 240),
					riskLevel: safetyCheck.riskLevel,
					reasons: safetyCheck.reasons.slice(0, 5).join(", "),
				})
			}

			await reportProgress?.({ icon: "terminal", text: "Waiting for command approval" } as UnsafeAny)
			const approvalMessage =
				safetyCheck.requiresConfirmation && (!isBypassMode || requiresConfirmationEvenInBypass)
					? `[High risk] This command may destroy data. Confirm to run:\n${canonicalCommand}\n\nReasons: ${safetyCheck.reasons.join("; ")}`
					: canonicalCommand

			if (!isBypassMode || requiresConfirmationEvenInBypass) {
				const didApprove = await askApproval("command", approvalMessage)
				if (!didApprove) {
					return
				}
			}

			const saveAllBeforeExecute = vscode.workspace
				.getConfiguration(Package.name)
				.get<boolean>("saveAllBeforeExecuteCommand", true)
			if (saveAllBeforeExecute) {
				await vscode.workspace.saveAll(false)
			}

			await reportProgress?.({ icon: "terminal", text: "Starting command execution" } as UnsafeAny)
			const executionId = task.lastMessageTs?.toString() ?? Date.now().toString()
			const provider = await task.providerRef.deref()
			const providerState = await provider?.getState()

			const { terminalShellIntegrationDisabled: configuredTerminalShellIntegrationDisabled = true } =
				providerState ?? {}
			const terminalShellIntegrationDisabled =
				configuredTerminalShellIntegrationDisabled || isCangjieToolchainCommand(canonicalCommand)

			// Get command execution timeout from VSCode configuration (in seconds)
			const commandExecutionTimeoutSeconds = vscode.workspace
				.getConfiguration(Package.name)
				.get<number>("commandExecutionTimeout", 0)

			// Get command timeout allowlist from VSCode configuration
			const commandTimeoutAllowlist = vscode.workspace
				.getConfiguration(Package.name)
				.get<string[]>("commandTimeoutAllowlist", [])

			// Check if command matches any prefix in the allowlist
			const isCommandAllowlisted = commandTimeoutAllowlist.some((prefix) => {
				const trimmed = prefix.trim()
				return canonicalCommand === trimmed || canonicalCommand.startsWith(trimmed + " ")
			})

			// Convert seconds to milliseconds for internal use, but skip timeout if command is allowlisted
			const commandExecutionTimeout = isCommandAllowlisted ? 0 : commandExecutionTimeoutSeconds * 1000

			// Convert agent-specified timeout from seconds to milliseconds
			const agentTimeout = resolveAgentTimeoutMs(timeoutSeconds)

			const options: ExecuteCommandOptions = {
				executionId,
				command: canonicalCommand,
				customCwd,
				terminalShellIntegrationDisabled,
				commandExecutionTimeout,
				agentTimeout,
				audit: {
					approvalResult: isBypassMode && !requiresConfirmationEvenInBypass ? "bypass" : "approved",
					commandSafety: safetyCheck.riskLevel === "safe" ? "safe" : "unsafe",
					interactive: !isBypassMode || requiresConfirmationEvenInBypass,
					bypass: isBypassMode && !requiresConfirmationEvenInBypass,
				},
			}

			try {
				const [rejected, result] = await executeCommandInTerminal(task, options)

				if (rejected) {
					task.didRejectTool = true
				}

				if (task.taskMode === "cangjie") {
					task.cangjieRuntimePolicy.noteBuildResult(
						canonicalCommand,
						isSuccessfulCommandResult(result, rejected),
						String(result),
					)
				}

				pushToolResult(result)
			} catch (error: UnsafeAny) {
				if (!(error instanceof ShellIntegrationError)) {
					throw error
				}
				const status: CommandExecutionStatus = { executionId, status: "fallback" }
				void provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
				await task.say("shell_integration_warning")

				// Invalidate pending ask from first execution to prevent race condition
				task.supersedePendingAsk()

				const [rejected, result] = await executeCommandInTerminal(task, {
					...options,
					terminalShellIntegrationDisabled: true,
				})

				if (rejected) {
					task.didRejectTool = true
				}

				if (task.taskMode === "cangjie") {
					task.cangjieRuntimePolicy.noteBuildResult(
						canonicalCommand,
						!rejected && !/^Command execution failed/i.test(String(result)),
						String(result),
					)
				}

				pushToolResult(result)
			}

			return
		} catch (error) {
			await handleError("executing command", wrapAsError(error))
			return
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"execute_command">): Promise<void> {
		const command = block.params.command
		await task.ask("command", command ?? "", block.partial).catch(ignoreAbortError)
	}
}

export type ExecuteCommandOptions = {
	executionId: string
	command: string
	customCwd?: string
	terminalShellIntegrationDisabled?: boolean
	commandExecutionTimeout?: number
	agentTimeout?: number
	audit?: CommandAuditContext
}

export async function executeCommandInTerminal(
	task: Task,
	{
		executionId,
		command,
		customCwd,
		terminalShellIntegrationDisabled = true,
		commandExecutionTimeout = 0,
		agentTimeout = 0,
		audit,
	}: ExecuteCommandOptions,
): Promise<[boolean, ToolResponse]> {
	let workingDir: string

	if (!customCwd) {
		// Preserve the historical behaviour: if the agent did not supply a
		// custom cwd, run in `task.cwd` exactly as configured. No resolution
		// pass is needed because nothing untrusted is being honoured.
		workingDir = task.cwd
	} else {
		// Constrain customCwd to the task workspace. Absolute paths, '..'
		// traversal and symlink escapes must NOT be honoured. See
		// resolveWithinWorkspace.
		const cwdResolution = await resolveWithinWorkspaceAsync(task.cwd, customCwd)
		if (!cwdResolution.ok) {
			logger.warn("ExecuteCommandTool", "execute_command: rejected cwd outside workspace:", {
				cwd: customCwd,
				reason: cwdResolution.reason,
			})
			recordSecurityMetric("execute_command_cwd_escape", {
				cwd: typeof customCwd === "string" ? customCwd.slice(0, 240) : "",
				reason: cwdResolution.reason.slice(0, 240),
			})
			return [false, `Working directory '${customCwd}' is rejected: ${cwdResolution.reason}`]
		}
		workingDir = cwdResolution.resolved
	}

	const requireExactCwd = !customCwd && isCangjieToolchainCommand(command)

	if (requireExactCwd) {
		workingDir = await resolveCangjieToolchainWorkingDir(workingDir)
	}

	try {
		await fs.access(workingDir)
	} catch (err) {
		logger.error("ExecuteCommandTool", "Working directory access failed:", err)
		return [false, `Working directory '${workingDir}' does not exist.`]
	}

	const resolvedCommand = normalizeDotSlashCommandForWindowsShell(command.trim(), BaseTerminal.getExecaShellPath())

	let message: { text?: string; images?: string[] } | undefined
	let runInBackground = false
	let completed = false
	let result: string = ""
	let persistedResult: PersistedCommandOutput | undefined
	let exitDetails: ExitCodeDetails | undefined
	let shellIntegrationError: string | undefined
	let hasAskedForCommandOutput = false

	const terminalProvider = terminalShellIntegrationDisabled ? "execa" : "vscode"
	const provider = await task.providerRef.deref()

	// Get global storage path for persisted output artifacts
	const globalStoragePath = provider?.context?.globalStorageUri?.fsPath
	let interceptor: OutputInterceptor | undefined

	// Create OutputInterceptor if we have storage available
	if (globalStoragePath) {
		const taskDir = await getTaskDirectoryPath(globalStoragePath, task.taskId)
		const storageDir = path.join(taskDir, "command-output")
		const providerState = await provider?.getState()
		const terminalOutputPreviewSize =
			providerState?.terminalOutputPreviewSize ?? DEFAULT_TERMINAL_OUTPUT_PREVIEW_SIZE

		interceptor = new OutputInterceptor({
			executionId,
			taskId: task.taskId,
			command: resolvedCommand,
			storageDir,
			previewSize: terminalOutputPreviewSize,
		})
	}

	let accumulatedOutput = ""
	// Bound accumulated output buffer size to prevent unbounded memory growth for long-running commands.
	// The interceptor preserves full output; this buffer is only for UI display (100KB limit).
	const maxAccumulatedOutputSize = 100_000
	const commandOutputStreamThrottleMs = 150
	let latestCompressedOutput = ""
	let lastQueuedCommandOutput = ""
	let lastCommandOutputEmitAt = 0
	let pendingCommandOutputEmitTimer: NodeJS.Timeout | undefined
	let commandOutputSayChain: Promise<void> = Promise.resolve()

	const queueCommandOutputMessage = (text: string, partial: boolean, force = false): Promise<void> => {
		if (!force && text === lastQueuedCommandOutput) {
			return commandOutputSayChain
		}

		lastQueuedCommandOutput = text
		commandOutputSayChain = commandOutputSayChain
			.then(async () => {
				await task.say("command_output", text, undefined, partial, undefined, undefined, {
					isNonInteractive: true,
				})
			})
			.catch((error) => {
				logger.error("ExecuteCommandTool", "Failed to publish command output:", error)
				TelemetryService.reportError(error, TelemetryEventName.UTILITY_ERROR)
			})

		return commandOutputSayChain
	}

	const schedulePartialCommandOutputUpdate = () => {
		if (!latestCompressedOutput || completed) {
			return
		}

		const emitUpdate = () => {
			pendingCommandOutputEmitTimer = undefined
			lastCommandOutputEmitAt = Date.now()
			void queueCommandOutputMessage(latestCompressedOutput, true)
		}

		const elapsed = Date.now() - lastCommandOutputEmitAt
		if (elapsed >= commandOutputStreamThrottleMs) {
			emitUpdate()
			return
		}

		if (!pendingCommandOutputEmitTimer) {
			pendingCommandOutputEmitTimer = setTimeout(emitUpdate, commandOutputStreamThrottleMs - elapsed)
		}
	}

	// Track when onCompleted callback finishes to avoid race condition.
	// The callback is async but Terminal/ExecaTerminal don't await it, so we track completion
	// explicitly to ensure persistedResult is set before we use it.
	let resolveOnCompleted: (() => void) | undefined
	// Assigned only after runCommand returns so a synchronous callback cannot access uninitialized timeout state.
	// eslint-disable-next-line prefer-const
	let onBackgroundProcessCompleted: (() => void) | undefined
	const onCompletedPromise = new Promise<void>((resolve) => {
		resolveOnCompleted = resolve
	})

	const callbacks: RooTerminalCallbacks = {
		onLine: async (lines: string, process: RooTerminalProcess) => {
			accumulatedOutput += lines

			// Trim accumulated output to prevent unbounded memory growth
			if (accumulatedOutput.length > maxAccumulatedOutputSize) {
				accumulatedOutput = accumulatedOutput.slice(-maxAccumulatedOutputSize)
			}

			// Write to interceptor for persisted output
			interceptor?.write(lines)

			// Continue sending compressed output to webview for UI display (unchanged behavior)
			const compressedOutput = Terminal.compressTerminalOutput(accumulatedOutput)
			latestCompressedOutput = compressedOutput
			const status: CommandExecutionStatus = { executionId, status: "output", output: compressedOutput }
			void provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
			schedulePartialCommandOutputUpdate()

			if (runInBackground || hasAskedForCommandOutput) {
				return
			}

			// Mark that we've asked to prevent multiple concurrent asks
			hasAskedForCommandOutput = true

			try {
				const { response, text, images } = await task.ask("command_output", "")
				runInBackground = true

				if (response === "messageResponse") {
					message = { text, images }
					process.continue()
				}
			} catch (_error) {
				logger.warn("ExecuteCommandTool", "Ask promise was ignored or failed:", _error)
			}
		},
		onCompleted: async (output: string | undefined) => {
			try {
				clearTimeout(pendingCommandOutputEmitTimer)
				pendingCommandOutputEmitTimer = undefined

				// Finalize interceptor and get persisted result.
				// We await finalize() to ensure the artifact file is fully flushed
				// before we advertise the artifact_id to the LLM.
				if (interceptor) {
					persistedResult = await interceptor.finalize()
				}

				// Continue using compressed output for UI display
				result = Terminal.compressTerminalOutput(output ?? "")
				latestCompressedOutput = result

				// Preserve order: wait for queued partial updates, then emit the final
				// non-partial command_output update.
				await commandOutputSayChain
				await queueCommandOutputMessage(result, false, true)
				completed = true
			} finally {
				onBackgroundProcessCompleted?.()
				// Signal that onCompleted has finished, so the main code can safely use persistedResult
				resolveOnCompleted?.()
			}
		},
		onShellExecutionStarted: (pid: number | undefined) => {
			const status: CommandExecutionStatus = { executionId, status: "started", pid, command: resolvedCommand }
			void provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
		},
		onShellExecutionComplete: (details: ExitCodeDetails) => {
			const status: CommandExecutionStatus = { executionId, status: "exited", exitCode: details.exitCode }
			void provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
			exitDetails = details
		},
	}

	if (terminalProvider === "vscode") {
		callbacks.onNoShellIntegration = (error: string) => {
			TelemetryService.instance.captureShellIntegrationError(task.taskId)
			shellIntegrationError = error
		}
	}

	// ── Route through SandboxExecutionService ──────────────────────────────
	const sandboxService = SandboxExecutionService.getInstance()
	const sandboxExecId = SandboxExecutionService.generateExecutionId()
	const sandboxRequest: CommandExecutionRequest = {
		executionId: sandboxExecId,
		taskId: task.taskId,
		resourceScopeId: createTaskResourceScopeId(task.taskId, task.instanceId),
		command: resolvedCommand,
		workspacePath: task.cwd,
		cwd: workingDir,
		timeoutMs: commandExecutionTimeout,
		source: "local",
		onOutput: () => {},
		audit,
	}
	const sandboxBackend = await sandboxService.evaluatePolicyOnly("local", sandboxRequest)

	// ── Docker backend: execute in sandbox container ──────────────────────
	if (sandboxBackend === "docker") {
		let lastRetrievedIndex = 0
		const dockerProcess = {
			command: resolvedCommand,
			isHot: true,
			run: async () => {},
			continue: () => {},
			abort: () => {
				void sandboxService.cancel(sandboxExecId).catch((error) => {
					logger.warn("ExecuteCommandTool", "Failed to cancel Docker execution", error)
				})
			},
			hasUnretrievedOutput: () => accumulatedOutput.length > lastRetrievedIndex,
			getUnretrievedOutput: () => {
				const output = accumulatedOutput.slice(lastRetrievedIndex)
				lastRetrievedIndex = accumulatedOutput.length
				return output
			},
			trimRetrievedOutput: () => {
				if (lastRetrievedIndex >= accumulatedOutput.length) {
					accumulatedOutput = ""
					lastRetrievedIndex = 0
				}
			},
		} as unknown as RooTerminalProcess
		task.terminalProcess = dockerProcess

		const appendDockerOutput = (text: string): void => {
			accumulatedOutput += text
			if (accumulatedOutput.length > maxAccumulatedOutputSize) {
				accumulatedOutput = accumulatedOutput.slice(-maxAccumulatedOutputSize)
				lastRetrievedIndex = Math.min(lastRetrievedIndex, accumulatedOutput.length)
			}
			interceptor?.write(text)
			latestCompressedOutput = Terminal.compressTerminalOutput(accumulatedOutput)
			const status: CommandExecutionStatus = {
				executionId,
				status: "output",
				output: latestCompressedOutput,
			}
			void provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
			schedulePartialCommandOutputUpdate()
		}

		const finalizeDockerOutput = async (finalOutput: string): Promise<void> => {
			clearTimeout(pendingCommandOutputEmitTimer)
			pendingCommandOutputEmitTimer = undefined
			if (interceptor && !persistedResult) {
				try {
					persistedResult = await interceptor.finalize()
				} catch (error) {
					logger.warn("ExecuteCommandTool", "Failed to finalize Docker command output", error)
				}
			}
			result = Terminal.compressTerminalOutput(finalOutput || accumulatedOutput)
			latestCompressedOutput = result
			await commandOutputSayChain
			await queueCommandOutputMessage(result, false, true)
			completed = true
		}

		const startedStatus: CommandExecutionStatus = {
			executionId,
			status: "started",
			pid: undefined,
			command: resolvedCommand,
		}
		void provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(startedStatus) })

		const completion = sandboxService
			.run({
				...sandboxRequest,
				onOutput: (chunk) => appendDockerOutput(chunk.text),
			})
			.then(async (handle): Promise<[boolean, ToolResponse]> => {
				dockerProcess.isHot = false
				exitDetails = { exitCode: handle.exitCode }
				await finalizeDockerOutput(handle.output)
				const exitedStatus: CommandExecutionStatus = {
					executionId,
					status: "exited",
					exitCode: handle.exitCode,
				}
				void provider?.postMessageToWebview({
					type: "commandExecutionStatus",
					text: JSON.stringify(exitedStatus),
				})

				const currentWorkingDir = workingDir.toPosix()
				if (persistedResult?.truncated) {
					return [false, formatPersistedOutput(persistedResult, exitDetails, currentWorkingDir)]
				}

				let formattedResult =
					`Command executed in Docker sandbox within working directory '${currentWorkingDir}'. ` +
					`${formatExitStatus(exitDetails)}\nOutput:\n${result}`
				if (handle.truncated) {
					formattedResult += "\n[Output truncated at the sandbox capture limit.]"
				}
				if (handle.exitCode !== undefined && handle.exitCode !== 0 && /\b(cjpm|cjc)\b/i.test(resolvedCommand)) {
					const extensionPath = task.providerRef.deref()?.context.extensionPath
					const appendix = await buildCangjieExecuteCommandErrorAppendix(result, task.cwd, extensionPath)
					if (appendix) formattedResult += appendix
				}
				return [false, formattedResult]
			})
			.catch(async (error: unknown): Promise<[boolean, ToolResponse]> => {
				dockerProcess.isHot = false
				await finalizeDockerOutput(accumulatedOutput)
				const errorMessage = error instanceof Error ? error.message : String(error)
				if (error instanceof SandboxError && error.kind === "CommandTimeout") {
					const timeoutMs = sandboxService.getEffectiveTimeout(commandExecutionTimeout, "local")
					const status: CommandExecutionStatus = { executionId, status: "timeout" }
					void provider?.postMessageToWebview({
						type: "commandExecutionStatus",
						text: JSON.stringify(status),
					})
					await task.say("error", t("common:errors:command_timeout", { seconds: timeoutMs / 1000 }))
					task.didToolFailInCurrentTurn = true
					return [
						false,
						`The command was terminated after exceeding the ${timeoutMs / 1000}s sandbox hard timeout. Do not try to re-run the command.`,
					]
				}
				if (error instanceof SandboxError && error.kind === "CommandCancelled") {
					return [false, `Docker sandbox command was cancelled.\nOutput:\n${result}`]
				}
				task.didToolFailInCurrentTurn = true
				logger.warn("ExecuteCommandTool", "Docker sandbox execution failed", error)
				return [false, `Sandbox execution failed: ${errorMessage}\nOutput:\n${result}`]
			})
			.finally(() => {
				if (task.terminalProcess === dockerProcess) task.terminalProcess = undefined
			})

		if (agentTimeout <= 0) return completion

		let backgroundTimer: ReturnType<typeof setTimeout> | undefined
		const foreground = await Promise.race([
			completion.then((response) => ({ kind: "complete" as const, response })),
			new Promise<{ kind: "background" }>((resolve) => {
				backgroundTimer = setTimeout(() => resolve({ kind: "background" }), agentTimeout)
			}),
		])
		if (foreground.kind === "complete") {
			clearTimeout(backgroundTimer)
			return foreground.response
		}

		runInBackground = true
		task.supersedePendingAsk()

		// Client-side hard timeout for Docker background execution.
		// sandboxService.run() has its own internal timeout, but if the Docker CLI
		// hangs (e.g., daemon unresponsive), the internal timeout won't fire.
		const dockerHardCapMs = commandExecutionTimeout > 0 ? commandExecutionTimeout : 120_000
		const hardKillTimer = setTimeout(() => {
			logger.warn("ExecuteCommandTool", `Docker background command hard-killed after ${dockerHardCapMs}ms`)
			void sandboxService.disposeScope(sandboxRequest.resourceScopeId ?? sandboxRequest.taskId).catch((err) => {
				logger.debug("ExecuteCommandTool", "Failed to dispose Docker scope on hard timeout", err)
			})
			const status: CommandExecutionStatus = { executionId, status: "timeout" }
			void provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
		}, dockerHardCapMs)
		hardKillTimer.unref()
		void completion.finally(() => clearTimeout(hardKillTimer))

		return [
			false,
			[
				`Command is still running in the Docker sandbox from '${workingDir.toPosix()}'.`,
				latestCompressedOutput ? `Here's the output so far:\n${latestCompressedOutput}\n` : "\n",
				"You will be updated on the command status and new output in the future.",
			].join("\n"),
		]
	}

	// ── Guarded-host backend: use existing terminal pipeline ───────────────
	// Apply sandbox timeout cap to terminal timeouts.
	// Agent timeout 0 stays 0 (no background transition).
	// Command timeout 0 stays 0 (no user-configured hard kill).
	// Sandbox cap only applies when user has set a positive command timeout;
	// timeout=0 means "no limit" — respect user intent, no hidden cap.
	const cappedCommandTimeout =
		commandExecutionTimeout > 0 ? sandboxService.getEffectiveTimeout(commandExecutionTimeout, "local") : 0
	const backgroundTimeout = agentTimeout
	const sandboxCapMs = cappedCommandTimeout

	sandboxService.evaluateAndAuditExecution({ ...sandboxRequest, timeoutMs: cappedCommandTimeout || 0 })

	let terminal: Awaited<ReturnType<typeof TerminalRegistry.getOrCreateTerminal>>
	let process: RooTerminalProcessResultPromise
	let startedProcess: RooTerminalProcessResultPromise | undefined
	let unregisterScopedProcess: (() => void) | undefined
	try {
		terminal = requireExactCwd
			? await TerminalRegistry.getOrCreateTerminal(workingDir, task.taskId, terminalProvider, { exactCwd: true })
			: await TerminalRegistry.getOrCreateTerminal(workingDir, task.taskId, terminalProvider)

		if (terminal instanceof Terminal) {
			terminal.terminal.show(true)

			// Update the working directory in case the terminal we asked for has
			// a different working directory so that the model will know where the
			// command actually executed.
			workingDir = terminal.getCurrentWorkingDirectory()
		}

		process = terminal.runCommand(resolvedCommand, callbacks)
		startedProcess = process
		unregisterScopedProcess = sandboxService.registerExternalProcess(
			sandboxRequest.resourceScopeId ?? sandboxRequest.taskId,
			process,
		)
	} catch (error) {
		try {
			unregisterScopedProcess?.()
		} catch (cleanupError) {
			logger.debug("ExecuteCommandTool", "Failed to unregister terminal after startup error", cleanupError)
		}
		try {
			startedProcess?.abort()
		} catch (abortError) {
			logger.debug("ExecuteCommandTool", "Failed to abort terminal after startup error", abortError)
		}
		try {
			sandboxService.recordExecutionComplete(
				sandboxExecId,
				{
					executionId: sandboxExecId,
					backend: sandboxBackend,
					exitCode: undefined,
					output: "",
					cancelled: false,
					timedOut: false,
				},
				wrapAsError(error),
			)
		} catch (auditError) {
			logger.warn("ExecuteCommandTool", "Failed to record terminal startup failure", auditError)
		}
		throw error
	}
	task.terminalProcess = process

	// Track command execution for persistent shell session metrics
	if ("commandCount" in terminal) {
		;(terminal as Record<string, UnsafeAny>).commandCount++
	}

	// Triple-timeout logic:
	// - Agent timeout: transitions the command to background (continues running)
	// - User timeout: aborts the command (kills it)
	// - Sandbox cap: independent hard kill that survives agent background transition
	// Agent and user timers are optional (0 = disabled). Sandbox cap always applies.
	let agentTimeoutId: NodeJS.Timeout | undefined
	let userTimeoutId: NodeJS.Timeout | undefined
	let sandboxCapTimeoutId: NodeJS.Timeout | undefined
	let isUserTimedOut = false
	let timedOutBy: "user" | "sandbox" | undefined
	let sandboxAuditCompleted = false

	const recordSandboxCompletion = (error?: Error): void => {
		if (sandboxAuditCompleted) return
		sandboxAuditCompleted = true
		try {
			sandboxService.recordExecutionComplete(
				sandboxExecId,
				{
					executionId: sandboxExecId,
					backend: sandboxBackend,
					exitCode: exitDetails?.exitCode,
					output: "",
					cancelled: false,
					timedOut: isUserTimedOut,
				},
				error,
			)
		} catch (auditError) {
			logger.warn("ExecuteCommandTool", "Failed to record terminal completion", auditError)
		}
	}

	const handleBackgroundHardTimeout = (kind: "user" | "sandbox", timeoutMs: number): void => {
		isUserTimedOut = true
		timedOutBy = kind
		process.abort()
		if (!runInBackground) return

		clearTimeout(kind === "user" ? sandboxCapTimeoutId : userTimeoutId)
		const status: CommandExecutionStatus = { executionId, status: "timeout" }
		void provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
		void task
			.say("error", t("common:errors:command_timeout", { seconds: timeoutMs / 1000 }))
			.catch((error) => logger.warn("ExecuteCommandTool", "Failed to publish background timeout", error))
		task.didToolFailInCurrentTurn = true
		recordSandboxCompletion()
		if (task.terminalProcess === process) task.terminalProcess = undefined
	}

	onBackgroundProcessCompleted = () => {
		if (!runInBackground) return
		clearTimeout(userTimeoutId)
		clearTimeout(sandboxCapTimeoutId)
		recordSandboxCompletion()
		if (task.terminalProcess === process) {
			task.terminalProcess = undefined
		}
	}

	try {
		const racers: Promise<void>[] = [process]

		// Agent timeout: transition to background (command keeps running)
		if (backgroundTimeout > 0) {
			racers.push(
				new Promise<void>((resolve) => {
					agentTimeoutId = setTimeout(() => {
						runInBackground = true
						process.continue()
						task.supersedePendingAsk()
						resolve()
					}, backgroundTimeout)
				}),
			)
		}

		// User timeout: abort the command (existing behavior)
		if (cappedCommandTimeout > 0) {
			racers.push(
				new Promise<void>((_, reject) => {
					userTimeoutId = setTimeout(() => {
						handleBackgroundHardTimeout("user", cappedCommandTimeout)
						reject(new Error(`Command execution timed out after ${cappedCommandTimeout}ms`))
					}, cappedCommandTimeout)
				}),
			)
		}

		// Sandbox cap: independent hard kill, not cleared by agent background
		if (sandboxCapMs > 0) {
			racers.push(
				new Promise<void>((_, reject) => {
					sandboxCapTimeoutId = setTimeout(() => {
						handleBackgroundHardTimeout("sandbox", sandboxCapMs)
						reject(new Error(`Command execution timed out after sandbox cap of ${sandboxCapMs}ms`))
					}, sandboxCapMs)
				}),
			)
		}

		await Promise.race(racers)
	} catch (error) {
		if (isUserTimedOut) {
			const timeoutMs = timedOutBy === "sandbox" ? sandboxCapMs : cappedCommandTimeout
			const timeoutSeconds = timeoutMs / 1000
			const status: CommandExecutionStatus = { executionId, status: "timeout" }
			void provider?.postMessageToWebview({ type: "commandExecutionStatus", text: JSON.stringify(status) })
			await task.say("error", t("common:errors:command_timeout", { seconds: timeoutSeconds }))
			task.didToolFailInCurrentTurn = true
			task.terminalProcess = undefined

			return [
				false,
				`The command was terminated after exceeding the ${timeoutSeconds}s ${timedOutBy === "sandbox" ? "sandbox" : "user-configured"} timeout. Do not try to re-run the command.`,
			]
		}
		recordSandboxCompletion(wrapAsError(error))
		throw error
	} finally {
		clearTimeout(agentTimeoutId)
		// Only clear hard-kill timers if the process actually ended (not backgrounded)
		if (!runInBackground) {
			clearTimeout(userTimeoutId)
			clearTimeout(sandboxCapTimeoutId)
		} else {
			// User and sandbox hard timeouts remain active after backgrounding.
			// sandboxCapTimeoutId intentionally NOT cleared — it will kill the process at cap
		}
		clearTimeout(pendingCommandOutputEmitTimer)
		if (!runInBackground) {
			task.terminalProcess = undefined
			recordSandboxCompletion()
		}
	}

	if (shellIntegrationError) {
		throw new ShellIntegrationError(shellIntegrationError)
	}

	// Wait for a short delay to ensure all messages are sent to the webview.
	// This delay allows time for non-awaited promises to be created and
	// for their associated messages to be sent to the webview, maintaining
	// the correct order of messages (although the webview is smart about
	// grouping command_output messages despite any gaps anyways).
	await delay(50)

	// Wait for onCompleted callback to finish if shell execution completed.
	// This ensures persistedResult is set before we try to use it, fixing the race
	// condition where exitDetails is set (sync) before the async onCompleted finishes.
	if (exitDetails && onCompletedPromise) {
		await onCompletedPromise
	}

	if (message) {
		const { text, images } = message
		await task.say("user_feedback", text, images)

		return [
			true,
			formatResponse.toolResult(
				[
					`Command is still running in terminal from '${terminal.getCurrentWorkingDirectory().toPosix()}'.`,
					result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
					`[USER-MESSAGE]\n${text}\n[END USER-MESSAGE]`,
				].join("\n"),
				images,
			),
		]
	} else if (completed || exitDetails) {
		const currentWorkingDir = terminal.getCurrentWorkingDirectory().toPosix()

		// Use persisted output format when output was truncated and spilled to disk
		if (persistedResult?.truncated) {
			return [false, formatPersistedOutput(persistedResult, exitDetails, currentWorkingDir)]
		}

		// Use inline format for small outputs (original behavior with exit status)
		let exitStatus: string = ""

		if (exitDetails !== undefined) {
			if (exitDetails.signalName) {
				exitStatus = `Process terminated by signal ${exitDetails.signalName}`

				if (exitDetails.coreDumpPossible) {
					exitStatus += " - core dump possible"
				}
			} else if (exitDetails.exitCode === undefined) {
				result += "<VSCE exit code is undefined: terminal output and command execution status is UnsafeAny.>"
				exitStatus = `Exit code: <undefined, notify user>`
			} else {
				if (exitDetails.exitCode !== 0) {
					exitStatus += "Command execution was not successful, inspect the cause and adjust as needed.\n"
				}

				exitStatus += `Exit code: ${exitDetails.exitCode}`
			}
		} else {
			result += "<VSCE exitDetails == undefined: terminal output and command execution status is UnsafeAny.>"
			exitStatus = `Exit code: <undefined, notify user>`
		}

		let formattedResult = `Command executed in terminal within working directory '${currentWorkingDir}'. ${exitStatus}\nOutput:\n${result}`

		if (exitDetails?.exitCode !== undefined && exitDetails.exitCode !== 0) {
			const extensionPath = task.providerRef.deref()?.context.extensionPath
			if (/\b(cjpm|cjc)\b/i.test(resolvedCommand)) {
				const appendix = await buildCangjieExecuteCommandErrorAppendix(result, task.cwd, extensionPath)
				if (appendix) {
					formattedResult += appendix
				}
			}
		}

		return [false, formattedResult]
	} else {
		return [
			false,
			[
				`Command is still running in terminal ${workingDir ? ` from '${workingDir.toPosix()}'` : ""}.`,
				result.length > 0 ? `Here's the output so far:\n${result}\n` : "\n",
				"You will be updated on the terminal status and new output in the future.",
			].join("\n"),
		]
	}
}

async function resolveCangjieToolchainWorkingDir(defaultCwd: string): Promise<string> {
	if (await pathExists(path.join(defaultCwd, "cjpm.toml"))) {
		return defaultCwd
	}

	for (const candidateDir of getVisibleCangjieCandidateDirs()) {
		const projectDir = await findNearestCjpmProjectDir(candidateDir)
		if (projectDir) {
			return projectDir
		}
	}

	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const folderPath = folder.uri.fsPath
		if (await pathExists(path.join(folderPath, "cjpm.toml"))) {
			return folderPath
		}
	}

	return defaultCwd
}

function getVisibleCangjieCandidateDirs(): string[] {
	const filePaths = [
		vscode.window.activeTextEditor?.document.uri.fsPath,
		...(vscode.window.visibleTextEditors ?? []).map((editor) => editor.document.uri.fsPath),
	].filter((filePath): filePath is string => Boolean(filePath))

	return [...new Set(filePaths.map((filePath) => path.dirname(filePath)))]
}

async function findNearestCjpmProjectDir(startDir: string): Promise<string | undefined> {
	let currentDir = startDir

	while (true) {
		if (await pathExists(path.join(currentDir, "cjpm.toml"))) {
			return currentDir
		}

		const parentDir = path.dirname(currentDir)
		if (parentDir === currentDir) {
			return undefined
		}
		currentDir = parentDir
	}
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath)
		return true
	} catch {
		return false
	}
}

/**
 * Format exit status from ExitCodeDetails
 */
function formatExitStatus(exitDetails: ExitCodeDetails | undefined): string {
	if (exitDetails === undefined) {
		return "Exit code: <undefined, notify user>"
	}

	if (exitDetails.signalName) {
		let status = `Process terminated by signal ${exitDetails.signalName}`
		if (exitDetails.coreDumpPossible) {
			status += " - core dump possible"
		}
		return status
	}

	if (exitDetails.exitCode === undefined) {
		return "Exit code: <undefined, notify user>"
	}

	let status = ""
	if (exitDetails.exitCode !== 0) {
		status += "Command execution was not successful, inspect the cause and adjust as needed.\n"
	}
	status += `Exit code: ${exitDetails.exitCode}`
	return status
}

/**
 * Format persisted output result for tool response when output was truncated
 */
function formatPersistedOutput(
	result: PersistedCommandOutput,
	exitDetails: ExitCodeDetails | undefined,
	workingDir: string,
): string {
	const exitStatus = formatExitStatus(exitDetails)
	const sizeStr = formatBytes(result.totalBytes)
	const artifactId = result.artifactPath ? path.basename(result.artifactPath) : ""

	return [
		`Command executed in '${workingDir}'. ${exitStatus}`,
		"",
		`Output (${sizeStr}) persisted. Artifact ID: ${artifactId}`,
		"",
		"Preview:",
		result.preview,
		"",
		"Use read_command_output tool to view full output if needed.",
	].join("\n")
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes}B`
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)}KB`
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const HTTP_COMMAND_PATTERNS = [
	/\bcurl\s/i,
	/\bwget\s/i,
	/\bhttpie\b/i,
	/\bhttp\s+(GET|POST|PUT|DELETE|PATCH|HEAD)\b/i,
	/\bInvoke-WebRequest\b/i,
	/\bInvoke-RestMethod\b/i,
	/\biwr\s/i,
	/\birm\s/i,
	/\bfetch\b.*https?:/i,
]

function isHttpCommand(command: string): boolean {
	return HTTP_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
}

export const executeCommandTool = new ExecuteCommandTool()
