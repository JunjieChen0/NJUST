import * as crypto from "crypto"
import * as path from "path"
import { quote } from "shell-quote"
import { BaseTerminal } from "../../integrations/terminal/BaseTerminal"
import { SandboxExecutionService } from "../../services/sandbox/SandboxExecutionService"
import { SandboxError, CommandFailedError } from "../../services/sandbox/SandboxErrors"
import { detectCangjieHome } from "../../services/cangjie-lsp/cangjieToolUtils"
import { logger } from "../../shared/logger"
import type { ProcessExecutor } from "./CangjieVerificationRunner"

const SDK_ENV_KEYS = new Set(["CANGJIE_HOME", "PATH", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH"])

/** Supply SDK additions only; the sandbox owns filtering and merging the host environment. */
export function buildVerificationSdkEnv(): Record<string, string> {
	const home = detectCangjieHome()
	if (!home) return {}
	const platform =
		process.platform === "win32"
			? "windows_x86_64_llvm"
			: process.platform === "darwin"
				? "darwin_aarch64_llvm"
				: "linux_x86_64_llvm"
	const dirs = [
		path.join(home, "bin"),
		path.join(home, "tools", "bin"),
		path.join(home, "tools", "lib"),
		path.join(home, "runtime", "lib", platform),
		path.join(home, "lib", platform),
	]
	const env = { CANGJIE_HOME: home, PATH: [...dirs, process.env.PATH ?? process.env.Path ?? ""].join(path.delimiter) }
	return process.platform === "win32" ? env : { ...env, LD_LIBRARY_PATH: dirs.join(path.delimiter) }
}

export function verificationCommand(file: string, args: string[], docker: boolean): string {
	if (docker || process.platform !== "win32") return quote([file, ...args])
	const shell = BaseTerminal.getExecaShellPath() ?? ""
	if (/powershell|pwsh/i.test(shell))
		return `& ${[file, ...args].map((value) => `'${value.replaceAll("'", "''")}'`).join(" ")}`
	// cmd expands these even inside quotes; refusing them is safer than guessing its expansion rules.
	if ([file, ...args].some((value) => /["%!\r\n]/.test(value)))
		throw new Error("Verification paths cannot contain cmd expansion or quote characters")
	return [file, ...args].map((value) => `"${value}"`).join(" ")
}

export function createSandboxProcessExecutor(service = SandboxExecutionService.getInstance()): ProcessExecutor {
	return async (file, args, options) => {
		const executionId = options.executionId ?? crypto.randomUUID()
		let timedOut = false
		let cancelled = options.signal.aborted
		let output = ""
		let stopping: Promise<void> | undefined
		const stop = () => {
			stopping ??= service
				.cancel(executionId)
				.catch((error) => logger.debug("VerificationExecutor", "Cannot cancel sandbox execution", error))
		}
		const onAbort = () => {
			cancelled = true
			stop()
		}
		options.signal.addEventListener("abort", onAbort, { once: true })
		const timer = setTimeout(() => {
			timedOut = true
			stop()
		}, options.timeoutMs)
		try {
			if (cancelled) {
				stop()
				return { exitCode: null, output, timedOut, cancelled }
			}
			const docker = service.getConfiguredBackend() === "docker"
			const environment = docker
				? {}
				: Object.fromEntries(Object.entries(options.env).filter(([key]) => SDK_ENV_KEYS.has(key.toUpperCase())))
			const handle = await service.run({
				executionId,
				taskId: options.taskId ?? "cangjie-sdk-probe",
				workspacePath: options.workspacePath ?? options.cwd,
				cwd: options.cwd,
				command: verificationCommand(docker ? "cjpm" : file, args, docker),
				timeoutMs: options.timeoutMs,
				environment,
				source: "local",
				signal: options.signal,
				onOutput: (chunk) => {
					output += chunk.text
				},
			})
			output = handle.output || output
			const missing =
				handle.exitCode === 127 ||
				handle.exitCode === 9009 ||
				/(?:cjpm|cjc).*?(?:not found|not recognized|ENOENT)/i.test(output)
			return {
				exitCode: handle.exitCode ?? null,
				output,
				timedOut: timedOut || handle.timedOut,
				cancelled: cancelled || (!timedOut && handle.cancelled),
				backend: handle.backend,
				imageDigest: handle.imageDigest,
				spawnError: missing ? output || "cjpm is unavailable in the selected sandbox" : undefined,
			}
		} catch (error) {
			logger.debug("VerificationExecutor", "Sandbox verification ended", error)
			if (error instanceof SandboxError && error.kind === "CommandTimeout") {
				timedOut = true
				stop()
			}
			if (error instanceof SandboxError && error.kind === "CommandCancelled") {
				cancelled = !timedOut
				stop()
			}
			const failure = error instanceof CommandFailedError
			return {
				exitCode: failure ? error.exitCode : null,
				output: output || (failure ? error.stderr : String(error)),
				timedOut,
				cancelled,
				spawnError:
					failure && (error.exitCode === 127 || error.exitCode === 9009)
						? error.stderr || "cjpm is unavailable in the selected sandbox"
						: undefined,
				sandboxDenied: !failure && !timedOut && !cancelled ? String(error) : undefined,
			}
		} finally {
			clearTimeout(timer)
			options.signal.removeEventListener("abort", onAbort)
			await stopping
		}
	}
}
