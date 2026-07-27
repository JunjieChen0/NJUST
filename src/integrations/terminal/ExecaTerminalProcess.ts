import { execa, ExecaError } from "execa"
import process from "process"
import { StringDecoder } from "string_decoder"

import { logger } from "../../shared/logger"
import { getProcessTree } from "../../utils/processTree"

import type { RooTerminal } from "./types"
import { BaseTerminal } from "./BaseTerminal"
import { BaseTerminalProcess } from "./BaseTerminalProcess"
import { normalizeDotSlashCommandForWindowsShell } from "../../utils/hostShellCommand"
import { filterSensitiveEnv, mergeSafeEnv } from "../../utils/env"
import { getErrorMessage } from "../../shared/error-utils"
import { TelemetryService } from "@njust-ai/telemetry"
import { TelemetryEventName } from "@njust-ai/types"

function buildExecutionEnvironment(): Record<string, string | undefined> {
	const environment = mergeSafeEnv({}, filterSensitiveEnv(), "ExecaTerminalProcess environment")
	environment.LANG = "en_US.UTF-8"
	environment.LC_ALL = "en_US.UTF-8"
	return environment
}

export class ExecaTerminalProcess extends BaseTerminalProcess {
	private terminalRef: WeakRef<RooTerminal>
	private aborted = false
	private pid?: number
	private subprocess?: ReturnType<typeof execa>
	private pidUpdatePromise?: Promise<void>

	constructor(terminal: RooTerminal) {
		super()

		this.terminalRef = new WeakRef(terminal)

		this.once("completed", () => {
			this.terminal.busy = false
		})
	}

	public get terminal(): RooTerminal {
		const terminal = this.terminalRef.deref()

		if (!terminal) {
			throw new Error("Unable to dereference terminal")
		}

		return terminal
	}

	public override async run(command: string) {
		const shellPath = BaseTerminal.getExecaShellPath()
		const normalizedCommand = normalizeStderrRedirectForExeca(
			normalizeDotSlashCommandForWindowsShell(command, shellPath),
		)
		this.command = normalizedCommand

		// Security: block command substitution which allows nested execution that
		// bypasses higher-level approval (BashCommandAnalyzer, PermissionRuleEngine).
		// Shell chaining (;, &, |) is allowed here — approved local commands commonly
		// use && and pipes. Remote-source chaining is blocked in GuardedHostRunner.
		const COMMAND_SUBSTITUTION = /\$\(|`|\$\{/
		if (COMMAND_SUBSTITUTION.test(normalizedCommand)) {
			logger.error(
				"ExecaTerminalProcess",
				"Command blocked: contains command substitution operators:",
				normalizedCommand,
			)
			this.emit(
				"error",
				new Error(
					"Command blocked for security: contains command substitution operators ($(), ``, ${}). Please use simple commands only.",
				),
			)
			return
		}

		try {
			this.isHot = true

			this.subprocess = execa({
				shell: shellPath || true,
				cwd: this.terminal.getCurrentWorkingDirectory(),
				all: true,
				// Ignore stdin to ensure non-interactive mode and prevent hanging
				stdin: "ignore",
				env: buildExecutionEnvironment(),
				extendEnv: false,
				buffer: false,
			})`${normalizedCommand}`

			this.pid = this.subprocess.pid

			// When using shell: true, the PID is for the shell, not the actual command
			// Find the actual command PID after a small delay
			if (this.pid) {
				this.pidUpdatePromise = new Promise<void>((resolve) => {
					setTimeout(() => {
						getProcessTree(this.pid!, (err, children) => {
							if (!err && children.length > 0) {
								// Update PID to the first child (the actual command)
								const actualPid = parseInt(children[0]!.PID)
								if (!isNaN(actualPid)) {
									this.pid = actualPid
								}
							}
							resolve()
						})
					}, 100)
				})
			}

			const rawStream = this.subprocess.iterable({ from: "all", preserveNewlines: true })
			const decoder = new StringDecoder("utf8")

			// Wrap the stream to ensure all chunks are strings (execa can return Uint8Array)
			const stream = (async function* () {
				for await (const chunk of rawStream) {
					const text = decoder.write(Buffer.from(chunk))
					if (text.length > 0) {
						yield text
					}
				}

				const remainder = decoder.end()
				if (remainder.length > 0) {
					yield remainder
				}
			})()

			this.terminal.setActiveStream(stream, this.pid)

			for await (const line of stream) {
				if (this.aborted) {
					break
				}

				this.fullOutput += line

				const now = Date.now()

				if (this.isListening && (now - this.lastEmitTime_ms > 500 || this.lastEmitTime_ms === 0)) {
					this.emitRemainingBufferIfListening()
					this.lastEmitTime_ms = now
				}

				this.startHotTimer(line)
			}

			if (this.aborted) {
				let timeoutId: NodeJS.Timeout | undefined

				const kill = new Promise<void>((resolve) => {
					logger.info("ExecaTerminalProcess", `[ExecaTerminalProcess#run] SIGKILL -> ${this.pid}`)

					timeoutId = setTimeout(() => {
						try {
							this.subprocess?.kill("SIGKILL")
						} catch (error) {
							logger.debug(
								"ExecaTerminalProcess",
								"[ExecaTerminalProcess#run] SIGKILL failed; process may have already exited",
								error,
							)
						}

						resolve()
					}, 5_000)
				})

				try {
					await Promise.race([this.subprocess, kill])
				} catch (error) {
					logger.info(
						"ExecaTerminalProcess",
						`[ExecaTerminalProcess#run] subprocess termination error: ${getErrorMessage(error)}`,
					)
				}

				if (timeoutId) {
					clearTimeout(timeoutId)
				}
			}

			this.emit("shell_execution_complete", { exitCode: 0 })
		} catch (error) {
			if (error instanceof ExecaError) {
				logger.error(
					"ExecaTerminalProcess",
					`[ExecaTerminalProcess#run] shell execution error: ${error.message}`,
				)
				TelemetryService.reportError(error, TelemetryEventName.UTILITY_ERROR)
				this.emit("shell_execution_complete", { exitCode: error.exitCode ?? 0, signalName: error.signal })
			} else {
				logger.error(
					"ExecaTerminalProcess",
					`[ExecaTerminalProcess#run] shell execution error: ${getErrorMessage(error)}`,
				)
				TelemetryService.reportError(
					error instanceof Error ? error : new Error(getErrorMessage(error)),
					TelemetryEventName.UTILITY_ERROR,
				)

				this.emit("shell_execution_complete", { exitCode: 1 })
			}
			this.subprocess = undefined
		}

		this.terminal.setActiveStream(undefined)
		this.emitRemainingBufferIfListening()
		this.stopHotTimer()
		this.emit("completed", this.fullOutput)
		this.emit("continue")
		this.subprocess = undefined
	}

	public override continue() {
		this.isListening = false
		this.removeAllListeners("line")
		this.emit("continue")
	}

	public override abort() {
		this.aborted = true

		// Function to perform the kill operations
		const performKill = () => {
			// Try to kill using the subprocess object: SIGTERM first, SIGKILL after 5s grace
			if (this.subprocess) {
				try {
					this.subprocess.kill("SIGTERM")
					const timer = setTimeout(() => {
						try {
							this.subprocess?.kill("SIGKILL")
						} catch (error) {
							logger.debug(
								"ExecaTerminalProcess",
								"[ExecaTerminalProcess#abort] delayed subprocess SIGKILL failed",
								error,
							)
						}
					}, 5_000)
					timer.unref() // Don't block Node.js exit
				} catch (e) {
					logger.warn(
						"ExecaTerminalProcess",
						`[ExecaTerminalProcess#abort] Failed to kill subprocess: ${getErrorMessage(e)}`,
					)
				}
			}

			// Kill the stored PID: SIGTERM first, SIGKILL after 5s grace
			if (this.pid) {
				try {
					process.kill(this.pid, "SIGTERM")
					const timer = setTimeout(() => {
						try {
							process.kill(this.pid!, "SIGKILL")
						} catch (error) {
							logger.debug(
								"ExecaTerminalProcess",
								`[ExecaTerminalProcess#abort] delayed process SIGKILL failed for ${this.pid}`,
								error,
							)
						}
					}, 5_000)
					timer.unref()
				} catch (e) {
					logger.warn(
						"ExecaTerminalProcess",
						`[ExecaTerminalProcess#abort] Failed to kill process ${this.pid}: ${getErrorMessage(e)}`,
					)
				}
			}
		}

		// If PID update is in progress, wait for it before killing
		if (this.pidUpdatePromise) {
			this.pidUpdatePromise.then(performKill).catch((error) => {
				logger.debug("ExecaTerminalProcess", "[ExecaTerminalProcess#abort] PID update failed", error)
				performKill()
			})
		} else {
			performKill()
		}

		// Continue with the rest of the abort logic
		if (this.pid) {
			// Also check for any child processes
			getProcessTree(this.pid, (err, children) => {
				if (!err) {
					const pids = children.map((p) => parseInt(p.PID))

					for (const pid of pids) {
						try {
							process.kill(pid, "SIGKILL")
						} catch (e) {
							logger.warn(
								"ExecaTerminalProcess",
								`[ExecaTerminalProcess#abort] Failed to send SIGKILL to child PID ${pid}: ${getErrorMessage(e)}`,
							)
							TelemetryService.reportError(
								e instanceof Error ? e : new Error(getErrorMessage(e)),
								TelemetryEventName.UTILITY_ERROR,
							)
						}
					}
				} else {
					logger.error(
						"ExecaTerminalProcess",
						`[ExecaTerminalProcess#abort] Failed to get process tree for PID ${this.pid}: ${getErrorMessage(err)}`,
					)
					TelemetryService.reportError(
						err instanceof Error ? err : new Error(getErrorMessage(err)),
						TelemetryEventName.UTILITY_ERROR,
					)
				}
			})
		}
	}

	public override hasUnretrievedOutput() {
		return this.lastRetrievedIndex < this.fullOutput.length
	}

	public override getUnretrievedOutput() {
		const output = this.fullOutput.slice(this.lastRetrievedIndex)
		let index = output.lastIndexOf("\n")

		if (index === -1) {
			return ""
		}

		index++
		this.lastRetrievedIndex += index

		return output.slice(0, index)
	}

	private emitRemainingBufferIfListening() {
		if (!this.isListening) {
			return
		}

		const output = this.getUnretrievedOutput()

		if (output !== "") {
			this.emit("line", output)
		}
	}
}

function normalizeStderrRedirectForExeca(command: string): string {
	// Execa uses all: true, so stderr is already merged into captured output.
	// Keep the security check strict while accepting the common cmd syntax
	// users request explicitly for diagnostics.
	return command.replace(/\s+2>\s*&\s*1\s*$/i, "")
}
