import * as fs from "fs/promises"
import * as fsSync from "fs"
import * as path from "path"
import * as crypto from "crypto"
import * as childProcess from "child_process"
import * as readline from "readline"

import { createDirectoriesForFile, fileExistsAtPath } from "../../utils/fs"
import { regexSearchFiles } from "../../services/ripgrep"
import { listFiles } from "../../services/glob/list-files"
import { checkCommandSafety } from "../../core/tools/helpers/commandSafety"
import { filterSensitiveEnv } from "../../utils/env"
import { getCommandDecision } from "../../core/auto-approval"
import { parseCommand } from "../../shared/parse-command"
import { detectCangjieHome } from "../cangjie-lsp/cangjieToolUtils"
import type { IPathValidator, IWriteProtector } from "../cloud-agent/interfaces/IPathAccessController"
import { logSecurityEvent } from "../../shared/security-audit"
import type { ResourceLimitsService } from "./ResourceLimitsService"
import { logger } from "../../shared/logger"

const MAX_READ_FILE_BYTES = 10 * 1024 * 1024
const MAX_SCAN_BYTES = 50 * 1024 * 1024
const MAX_RESPONSE_LINES = 50_000
const MAX_WRITE_TARGET_BYTES = 20 * 1024 * 1024
const MAX_DIFF_SIZE_BYTES = 1 * 1024 * 1024
const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_LINE_LENGTH = 1000
const BINARY_CHECK_BYTES = 8192

function isBinaryContent(buffer: Buffer): boolean {
	const checkLen = Math.min(buffer.length, BINARY_CHECK_BYTES)
	for (let i = 0; i < checkLen; i++) {
		if (buffer[i] === 0) return true
	}
	return false
}

function extractFirstCommandToken(command: string): string {
	const trimmed = command.trim()
	if (trimmed.startsWith('"')) {
		const endQuote = trimmed.indexOf('"', 1)
		return endQuote > 0 ? trimmed.slice(1, endQuote) : trimmed
	}
	if (trimmed.startsWith("'")) {
		const endQuote = trimmed.indexOf("'", 1)
		return endQuote > 0 ? trimmed.slice(1, endQuote) : trimmed
	}
	const spaceIdx = trimmed.search(/\s/)
	return spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed
}

const COMMAND_CHAIN_RE = /(?:^|\s)(?:&&|\|\||[;&|])(?:\s|$)|[\r\n]/

/**
 * Hard defense against command injection via subshell and command substitution.
 * Catches $(), backtick-based substitution, process substitution (<() and >()),
 * and null byte injection. This check is unconditional — it runs regardless of
 * allowlist/denylist/cangjie SDK path.
 */
const COMMAND_INJECTION_RE = /\$\(|`|<\(|>\(|\0/

/**
 * Resolves the real path of a file, handling non-existent files by
 * finding the nearest existing parent directory and resolving symlinks.
 */
async function resolveRealPath(filePath: string): Promise<string> {
	try {
		return await fs.realpath(filePath)
	} catch {
		// File doesn't exist - find nearest existing parent and resolve its real path
		let current = filePath
		const missingParts: string[] = []

		while (true) {
			const parent = path.dirname(current)
			if (parent === current) {
				// Reached root, return original
				return filePath
			}

			try {
				const realParent = await fs.realpath(parent)
				// Found existing parent, reconstruct path with real parent.
				// current is the first missing segment below realParent;
				// missingParts are the segments below current (in original order).
				return path.join(realParent, path.basename(current), ...missingParts)
			} catch {
				missingParts.unshift(path.basename(current))
				current = parent
			}
		}
	}
}

/**
 * Ensures a resolved path stays within the workspace boundary (after realpath, to reduce symlink escape).
 * Throws if the path attempts to escape.
 */
async function ensureWithinWorkspace(cwd: string, relPath: string): Promise<string> {
	// ── Pre-flight path validation ─────────────────────────────────────
	// Reject dangerous path patterns before any filesystem interaction.

	// Null byte injection — can truncate paths in some OS/filesystem layers
	if (relPath.includes("\0")) {
		throw new Error(`Path contains null byte: ${relPath.slice(0, 50)}`)
	}

	// Windows device paths: \\.\device, \\?\device
	if (/^\\[\\?][.\\]/.test(relPath) || /^\\[\\?][?\\]/.test(relPath)) {
		throw new Error(`Windows device path not allowed: ${relPath.slice(0, 100)}`)
	}

	// Windows UNC paths (network shares): \\server\share
	if (/^\\\\[^\\]/.test(relPath)) {
		throw new Error(`UNC network path not allowed: ${relPath.slice(0, 100)}`)
	}

	// Unix device paths
	const normalized = relPath.replace(/\\/g, "/")
	if (normalized === "/dev" || normalized.startsWith("/dev/") || normalized.includes("/../dev/")) {
		throw new Error(`Device path not allowed: ${relPath.slice(0, 100)}`)
	}

	const resolved = path.resolve(cwd, relPath)
	const base = await resolveRealPath(path.resolve(cwd))

	// Validate the resolved path stays within the workspace boundary.
	// On Unix, path.relative is the canonical check since filesystems are case-sensitive.
	// On Windows, NTFS/FAT are case-insensitive so we normalize case before comparing,
	// as path.relative only compares character-by-character.
	const isWithin = (parent: string, child: string): boolean => {
		if (process.platform === "win32") {
			const p = parent.toLowerCase()
			const c = child.toLowerCase()
			return c.startsWith(p + path.sep) || c === p
		}
		const rel = path.relative(parent, child)
		return !rel.startsWith("..") && !path.isAbsolute(rel)
	}

	const target = await resolveRealPath(resolved)
	if (!isWithin(base, target)) {
		throw new Error(`Path escapes workspace boundary: ${relPath}`)
	}
	return target
}

export interface ReadFileParams {
	path: string
	start_line?: number
	end_line?: number
}

/**
 * Validate that a path points to a regular file (not a symlink, FIFO, socket,
 * block device, or character device). Uses lstat to avoid following symlinks.
 */
async function assertSafeRegularFile(absPath: string): Promise<fsSync.Stats> {
	const stat = await fs.lstat(absPath)
	if (stat.isSymbolicLink()) {
		throw new Error(`Path is a symbolic link, not allowed: ${absPath}`)
	}
	if (stat.isFIFO()) {
		throw new Error(`Path is a FIFO, not a regular file: ${absPath}`)
	}
	if (stat.isSocket()) {
		throw new Error(`Path is a socket, not a regular file: ${absPath}`)
	}
	if (stat.isBlockDevice()) {
		throw new Error(`Path is a block device, not a regular file: ${absPath}`)
	}
	if (stat.isCharacterDevice()) {
		throw new Error(`Path is a character device, not a regular file: ${absPath}`)
	}
	if (!stat.isFile()) {
		throw new Error(`Path is not a regular file: ${absPath}`)
	}
	return stat
}

export async function execReadFile(
	cwd: string,
	params: ReadFileParams,
	resourceLimits?: ResourceLimitsService,
): Promise<string> {
	const absPath = await ensureWithinWorkspace(cwd, params.path)

	if (!(await fileExistsAtPath(absPath))) {
		throw new Error(`File not found: ${params.path}`)
	}

	// Reject symlinks, FIFOs, sockets, block/char devices via lstat
	const stat = await assertSafeRegularFile(absPath)

	if (resourceLimits) {
		if (!resourceLimits.acquireFileHandle()) {
			throw new Error("Resource limit exceeded: too many open file handles")
		}
	}

	try {
		const hasLineRange = params.start_line !== undefined || params.end_line !== undefined

		if (hasLineRange) {
			// ── Streaming line-range read with byte budget tracking ──────
			return await readLinesStreaming(absPath, params, resourceLimits)
		}

		// ── Full file read (no line range) ────────────────────────────────
		if (stat.size > MAX_READ_FILE_BYTES) {
			throw new Error(
				`File too large (${(stat.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_READ_FILE_BYTES / 1024 / 1024} MB: ${params.path}`,
			)
		}

		const fd = await fs.open(absPath, "r")
		try {
			const checkBuffer = Buffer.alloc(Math.min(BINARY_CHECK_BYTES, stat.size))
			if (stat.size > 0) {
				await fd.read(checkBuffer, 0, checkBuffer.length, 0)
			}
			if (isBinaryContent(checkBuffer)) {
				throw new Error(`File appears to be binary and cannot be read as text: ${params.path}`)
			}
		} finally {
			await fd.close()
		}

		const content = await fs.readFile(absPath, "utf-8")
		const lines = content.split("\n")

		const startLine = 1
		const endLine = Math.min(lines.length, MAX_RESPONSE_LINES)
		const selectedLines = lines.slice(startLine - 1, endLine)
		let numbered = selectedLines.map((line, i) => `${startLine + i} | ${line}`).join("\n")

		if (lines.length > MAX_RESPONSE_LINES) {
			numbered += `\n\n[Output truncated at ${MAX_RESPONSE_LINES} lines]`
		}

		if (resourceLimits) {
			const contentBytes = Buffer.byteLength(numbered, "utf-8")
			const granted = resourceLimits.acquireReadBytes(contentBytes)
			if (granted < contentBytes) {
				numbered = truncateByUtf8Bytes(numbered, granted)
				numbered += `\n\n[Resource limit: read truncated at ${granted} bytes]`
			}
		}

		return numbered
	} finally {
		if (resourceLimits) {
			resourceLimits.releaseFileHandle()
		}
	}
}

/**
 * Truncate a string to a maximum number of UTF-8 bytes, breaking at a safe
 * boundary (last newline before the byte limit).
 */
function truncateByUtf8Bytes(str: string, maxBytes: number): string {
	const buf = Buffer.from(str, "utf-8")
	if (buf.length <= maxBytes) return str

	// Find last newline before the byte limit for clean truncation
	let cutPoint = maxBytes
	for (let i = maxBytes; i > Math.max(0, maxBytes - 200); i--) {
		if (buf[i] === 0x0a) { // newline
			cutPoint = i
			break
		}
	}

	return buf.subarray(0, cutPoint).toString("utf-8")
}

/**
 * Streaming line-range read. Reads line by line, tracking scanned bytes.
 * Aborts if scanned bytes exceed MAX_SCAN_BYTES or the resource budget.
 */
async function readLinesStreaming(
	absPath: string,
	params: ReadFileParams,
	resourceLimits?: ResourceLimitsService,
): Promise<string> {
	const startLine = Math.max(1, params.start_line ?? 1)
	const endLine = params.end_line ?? Infinity

	if (startLine > endLine) {
		return "(No lines in requested range)"
	}

	const fd = await fs.open(absPath, "r")
	try {
		// Binary check on first bytes
		const stat = await fd.stat()
		const checkBuffer = Buffer.alloc(Math.min(BINARY_CHECK_BYTES, stat.size))
		if (stat.size > 0) {
			await fd.read(checkBuffer, 0, checkBuffer.length, 0)
		}
		if (isBinaryContent(checkBuffer)) {
			throw new Error(`File appears to be binary and cannot be read as text: ${params.path}`)
		}

		// Reuse the same fd to avoid TOCTOU: file cannot be swapped between check and read
		const stream = fsSync.createReadStream(absPath, { encoding: "utf-8", fd: fd.fd, autoClose: false })
		const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

		const outputLines: string[] = []
		let lineNumber = 0
		let scannedBytes = 0
		let aborted = false

		for await (const line of rl) {
			lineNumber++
			const lineBytes = Buffer.byteLength(line, "utf-8") + 1 // +1 for newline
			scannedBytes += lineBytes

			// Check scan budget
			if (scannedBytes > MAX_SCAN_BYTES) {
				outputLines.push(`\n[Scan budget exceeded at line ${lineNumber} (${MAX_SCAN_BYTES / 1024 / 1024} MB)]`)
				aborted = true
				break
			}

			if (lineNumber >= startLine && lineNumber <= endLine) {
				outputLines.push(`${lineNumber} | ${line}`)
			}

			if (lineNumber > endLine) break
			if (outputLines.length >= MAX_RESPONSE_LINES) {
				outputLines.push(`\n[Output truncated at ${MAX_RESPONSE_LINES} lines]`)
				break
			}
		}

		stream.destroy()
		rl.close()

		let result = outputLines.join("\n")

		if (resourceLimits) {
			const resultBytes = Buffer.byteLength(result, "utf-8")
			const granted = resourceLimits.acquireReadBytes(resultBytes)
			if (granted < resultBytes) {
				result = truncateByUtf8Bytes(result, granted)
				result += `\n\n[Resource limit: read truncated at ${granted} bytes]`
			}
		}

		if (!aborted && lineNumber === 0) {
			return "(Empty file)"
		}

		return result
	} finally {
		await fd.close()
	}
}

export interface WriteFileParams {
	path: string
	content: string
}

export async function execWriteFile(
	cwd: string,
	params: WriteFileParams,
	writeProtector?: IWriteProtector,
	resourceLimits?: ResourceLimitsService,
): Promise<string> {
	const absPath = await ensureWithinWorkspace(cwd, params.path)
	if (writeProtector && (await writeProtector.isWriteProtected(params.path))) {
		throw new Error(`File is write-protected: ${params.path}`)
	}

	const contentBytes = Buffer.byteLength(params.content, "utf-8")
	if (resourceLimits) {
		const granted = resourceLimits.acquireWriteBytes(contentBytes)
		if (granted < contentBytes) {
			throw new Error(
				`Resource limit exceeded: write budget insufficient (needed ${contentBytes} bytes, granted ${granted})`,
			)
		}
	}

	const isNew = !(await fileExistsAtPath(absPath))
	if (isNew) {
		await createDirectoriesForFile(absPath)
	} else {
		// Check target file size before overwriting
		const existingStat = await fs.stat(absPath)
		if (existingStat.size > MAX_WRITE_TARGET_BYTES) {
			throw new Error(
				`Target file too large (${(existingStat.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_WRITE_TARGET_BYTES / 1024 / 1024} MB: ${params.path}`,
			)
		}
	}

	await atomicWriteFile(absPath, params.content)

	return isNew ? `Created new file: ${params.path}` : `Updated file: ${params.path}`
}

/**
 * Atomically write a file by writing to a temp file in the same directory,
 * then renaming. Preserves the original file mode if it exists.
 * Flushes to disk (fsync) before rename to ensure durability.
 * On Windows, handles EBUSY/EACCES from file locks with a controlled error.
 * Never deletes the original file — if rename fails, the temp file is cleaned up.
 */
async function atomicWriteFile(absPath: string, content: string): Promise<void> {
	const dir = path.dirname(absPath)
	const tmpName = `.${path.basename(absPath)}.${crypto.randomUUID()}.tmp`
	const tmpPath = path.join(dir, tmpName)

	// Preserve original file mode if it exists
	let originalMode: number | undefined
	try {
		const existingStat = await fs.stat(absPath)
		originalMode = existingStat.mode
	} catch (err) {
		logger.debug("ToolExecutors", "stat file for mode", err)
	}

	let fd: fs.FileHandle | undefined
	try {
		fd = await fs.open(tmpPath, "w", originalMode ?? 0o644)
		await fd.write(content, 0, "utf-8")
		await fd.sync() // Flush to disk before rename
		await fd.close()
		fd = undefined

		try {
			await fs.rename(tmpPath, absPath)
		} catch (renameErr: unknown) {
			// Windows: EBUSY/EACCES when file is locked by another process
			const code = (renameErr as NodeJS.ErrnoException)?.code
			if (code === "EBUSY" || code === "EACCES" || code === "EPERM") {
				throw new Error(
					`Cannot write to ${absPath}: file is locked by another process (${code}). Please close the file and try again.`,
				)
			}
			throw renameErr
		}
	} catch (err) {
		if (fd) {
			await fd.close().catch((err) => logger.debug("ToolExecutors", "close fd on error", err))
		}
		await fs.unlink(tmpPath).catch((err) => logger.debug("ToolExecutors", "unlink tmp file", err))
		throw err
	}
}

export interface ListFilesParams {
	path: string
	recursive?: boolean
}

export async function execListFiles(
	cwd: string,
	params: ListFilesParams,
	pathValidator?: IPathValidator,
	resourceLimits?: ResourceLimitsService,
): Promise<string> {
	const absPath = await ensureWithinWorkspace(cwd, params.path)

	if (!(await fileExistsAtPath(absPath))) {
		throw new Error(`Directory not found: ${params.path}`)
	}

	const [files, didHitLimit] = await listFiles(absPath, params.recursive ?? false, 500)

	const relFiles = files
		.map((f) => path.relative(cwd, f).replace(/\\/g, "/"))
		.filter((relPath) => !pathValidator || pathValidator.validateAccess(relPath))
	let result = relFiles.join("\n")

	if (didHitLimit) {
		result += "\n\n(Results truncated — limit reached)"
	}

	let output = result || "(Empty directory)"

	if (resourceLimits) {
		const outputBytes = Buffer.byteLength(output, "utf-8")
		const granted = resourceLimits.acquireReadBytes(outputBytes)
		if (granted < outputBytes) {
			const truncated = output.slice(0, granted)
			const lastNewline = truncated.lastIndexOf("\n")
			output = (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) +
				"\n\n[Resource limit: listing truncated]"
		}
	}

	return output
}

export interface SearchFilesParams {
	path: string
	regex: string
	file_pattern?: string
}

export async function execSearchFiles(
	cwd: string,
	params: SearchFilesParams,
	pathValidator?: IPathValidator,
	resourceLimits?: ResourceLimitsService,
): Promise<string> {
	const absPath = await ensureWithinWorkspace(cwd, params.path)

	if (!(await fileExistsAtPath(absPath))) {
		throw new Error(`Directory not found: ${params.path}`)
	}

	const rawResult = await regexSearchFiles(cwd, absPath, params.regex, params.file_pattern, pathValidator)
	let result = truncateSearchResults(rawResult)

	if (resourceLimits) {
		const resultBytes = Buffer.byteLength(result, "utf-8")
		const granted = resourceLimits.acquireReadBytes(resultBytes)
		if (granted < resultBytes) {
			const truncated = result.slice(0, granted)
			const lastNewline = truncated.lastIndexOf("\n")
			result = (lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated) +
				"\n\n[Resource limit: search results truncated]"
		}
	}

	return result
}

function truncateSearchResults(rawResult: string): string {
	const lines = rawResult.split("\n")
	const truncated: string[] = []
	let resultCount = 0

	for (const line of lines) {
		if (line.trim() === "" || line.startsWith("(") || line.includes("Results truncated")) {
			truncated.push(line)
			continue
		}
		if (resultCount >= MAX_SEARCH_RESULTS) {
			truncated.push(`\n(Search results truncated at ${MAX_SEARCH_RESULTS} matches)`)
			break
		}
		if (line.length > MAX_SEARCH_LINE_LENGTH) {
			truncated.push(line.slice(0, MAX_SEARCH_LINE_LENGTH) + " ... [truncated]")
		} else {
			truncated.push(line)
		}
		resultCount++
	}

	return truncated.join("\n")
}

export interface ExecuteCommandParams {
	command: string
	cwd?: string
	timeout?: number
}

export async function execCommand(
	workspaceCwd: string,
	params: ExecuteCommandParams,
	allowedCommands?: string[],
	deniedCommands?: string[],
): Promise<string> {
	let execCwd = workspaceCwd
	if (params.cwd) {
		const resolvedCwd = path.isAbsolute(params.cwd) ? params.cwd : path.resolve(workspaceCwd, params.cwd)
		execCwd = await ensureWithinWorkspace(workspaceCwd, resolvedCwd)
	}

	// Unconditional command injection guard: reject $(), backtick-based
	// command substitution, process substitution (<() and >()), and null bytes
	// regardless of allowlist, denylist, or cangjie SDK path checks.
	// This is the first line of defense.
	if (COMMAND_INJECTION_RE.test(params.command)) {
		logSecurityEvent({
			action: "mcp.command.execute",
			resource: params.command.slice(0, 200),
			result: "denied",
			reason: "command_injection_detected",
		})
		throw new Error(
			`Command injection detected in MCP context: command substitution via $(), backticks, <(), >(), or null bytes is not allowed`,
		)
	}

	// Reject env variable injection: `env VAR=val cmd` can override PATH,
	// LD_PRELOAD, or other security-critical environment variables.
	if (/^\s*env\s+[A-Za-z_][A-Za-z0-9_]*=/.test(params.command)) {
		logSecurityEvent({
			action: "mcp.command.execute",
			resource: params.command.slice(0, 200),
			result: "denied",
			reason: "env_injection_detected",
		})
		throw new Error(
			`Environment variable injection detected: 'env VAR=val cmd' is not allowed in MCP context`,
		)
	}

	// Use the full command decision logic that properly handles:
	// - Command chaining (&&, ||, ;, |, &)
	// - Longest prefix match for allow/deny lists
	// - Conflict resolution between allowed and denied commands
	if (allowedCommands?.length || deniedCommands?.length) {
		const decision = getCommandDecision(params.command, allowedCommands ?? [], deniedCommands ?? [])

		if (decision === "auto_deny") {
			logSecurityEvent({
				action: "mcp.command.execute",
				resource: params.command.slice(0, 200),
				result: "denied",
				reason: "policy_auto_deny",
			})
			throw new Error(`Command denied by policy: ${params.command}`)
		}

		if (decision === "ask_user") {
			const cangjieHome = detectCangjieHome()
			if (cangjieHome) {
				// 逐命令验证：解析子命令，拒绝多命令链
				const subCommands = parseCommand(params.command)
				if (subCommands.length > 1) {
					throw new Error(`Command requires explicit approval: ${params.command}`)
				}
				if (subCommands.length === 0 || COMMAND_CHAIN_RE.test(params.command)) {
					throw new Error(`Command requires explicit approval: ${params.command}`)
				}
				const firstToken = extractFirstCommandToken(subCommands[0]!)
				const normalizedHome = path.normalize(cangjieHome) + path.sep
				const normalizedToken = path.normalize(firstToken)
				const isSdkCommand =
					process.platform === "win32"
						? normalizedToken.toLowerCase().startsWith(normalizedHome.toLowerCase())
						: normalizedToken.startsWith(normalizedHome)
				if (!isSdkCommand) {
					throw new Error(`Command requires explicit approval: ${params.command}`)
				}
			} else {
				throw new Error(`Command requires explicit approval: ${params.command}`)
			}
		}
	}

	// Run the same security analysis used by the interactive execute_command tool.
	// In MCP context, both forbidden AND dangerous patterns are rejected —
	// there is no interactive user to confirm the risk.
	const safetyCheck = checkCommandSafety(params.command)
	if (safetyCheck.riskLevel === "forbidden" || safetyCheck.riskLevel === "dangerous") {
		logSecurityEvent({
			action: "mcp.command.execute",
			resource: params.command.slice(0, 200),
			result: "denied",
			reason: `safety_${safetyCheck.riskLevel}`,
		})
		throw new Error(`Command blocked for safety (${safetyCheck.riskLevel}): ${safetyCheck.reasons.join("; ")}`)
	}

	// Hard defense: reject command chains even if previous checks were bypassed
	if (COMMAND_CHAIN_RE.test(params.command)) {
		logSecurityEvent({
			action: "mcp.command.execute",
			resource: params.command.slice(0, 200),
			result: "denied",
			reason: "command_chain_detected",
		})
		throw new Error(
			`Command contains shell chaining operators (&&, ||, ;, |, &) which are not allowed in MCP context: ${params.command}`,
		)
	}

	const timeoutMs = Math.max(1, Math.min(300, params.timeout ?? 30)) * 1000
	/** Hard cap on accumulated stdout/stderr to prevent memory exhaustion from runaway commands. */
	const MAX_OUTPUT_BYTES = 100_000

	return new Promise<string>((resolve, reject) => {
		const isWindows = process.platform === "win32"
		const shell = isWindows ? "cmd.exe" : "/bin/sh"
		const shellArgs = isWindows ? ["/c", params.command] : ["-c", params.command]

		const proc = childProcess.spawn(shell, shellArgs, {
			cwd: execCwd,
			env: filterSensitiveEnv(),
			stdio: ["ignore", "pipe", "pipe"],
		})

		let stdout = ""
		let stderr = ""
		let stdoutBytes = 0
		let stderrBytes = 0
		let outputTruncated = false
		let settled = false

		const appendWithLimit = (target: "stdout" | "stderr", chunk: string): void => {
			const byteLen = Buffer.byteLength(chunk, "utf-8")
			if (target === "stdout") {
				if (stdoutBytes >= MAX_OUTPUT_BYTES) {
					outputTruncated = true
					return
				}
				if (stdoutBytes + byteLen > MAX_OUTPUT_BYTES) {
					outputTruncated = true
					stdout += chunk.slice(0, MAX_OUTPUT_BYTES - stdoutBytes)
					stdoutBytes = MAX_OUTPUT_BYTES
				} else {
					stdout += chunk
					stdoutBytes += byteLen
				}
			} else {
				if (stderrBytes >= MAX_OUTPUT_BYTES) {
					outputTruncated = true
					return
				}
				if (stderrBytes + byteLen > MAX_OUTPUT_BYTES) {
					outputTruncated = true
					stderr += chunk.slice(0, MAX_OUTPUT_BYTES - stderrBytes)
					stderrBytes = MAX_OUTPUT_BYTES
				} else {
					stderr += chunk
					stderrBytes += byteLen
				}
			}
		}

		proc.stdout.on("data", (data: Buffer) => {
			appendWithLimit("stdout", data.toString())
		})
		proc.stderr.on("data", (data: Buffer) => {
			appendWithLimit("stderr", data.toString())
		})

		const timer = setTimeout(() => {
			if (settled) return
			settled = true
			proc.kill("SIGTERM")
			reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s`))
		}, timeoutMs)

		proc.on("close", (code) => {
			clearTimeout(timer)
			if (settled) return
			settled = true
			const truncNote = outputTruncated
				? `\n\n[Output truncated at ${MAX_OUTPUT_BYTES / 1024}KB. Use a more specific command to reduce output.]`
				: ""
			const output = [
				`Exit code: ${code ?? "unknown"}`,
				stdout ? `\nSTDOUT:\n${stdout}` : "",
				stderr ? `\nSTDERR:\n${stderr}` : "",
				truncNote,
			].join("")

			resolve(output)
		})

		proc.on("error", (err) => {
			clearTimeout(timer)
			if (settled) return
			settled = true
			reject(new Error(`Failed to execute command: ${err.message}`))
		})
	})
}

export interface ApplyDiffParams {
	path: string
	diff: string
}

export async function execApplyDiff(
	cwd: string,
	params: ApplyDiffParams,
	writeProtector?: IWriteProtector,
	resourceLimits?: ResourceLimitsService,
): Promise<string> {
	const absPath = await ensureWithinWorkspace(cwd, params.path)
	if (writeProtector && (await writeProtector.isWriteProtected(params.path))) {
		throw new Error(`File is write-protected: ${params.path}`)
	}

	if (Buffer.byteLength(params.diff, "utf-8") > MAX_DIFF_SIZE_BYTES) {
		throw new Error(
			`Diff too large (${(Buffer.byteLength(params.diff, "utf-8") / 1024).toFixed(1)} KB). Maximum is ${MAX_DIFF_SIZE_BYTES / 1024} KB`,
		)
	}

	if (!(await fileExistsAtPath(absPath))) {
		throw new Error(`File not found: ${params.path}`)
	}

	// Check target file size before reading
	const targetStat = await fs.stat(absPath)
	if (targetStat.size > MAX_WRITE_TARGET_BYTES) {
		throw new Error(
			`Target file too large (${(targetStat.size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_WRITE_TARGET_BYTES / 1024 / 1024} MB: ${params.path}`,
		)
	}

	const originalContent = await fs.readFile(absPath, "utf-8")

	const { MultiSearchReplaceDiffStrategy } = await import("../../core/diff/strategies/multi-search-replace")
	const strategy = new MultiSearchReplaceDiffStrategy()
	const result = await strategy.applyDiff(originalContent, params.diff)

	if (!result.success) {
		const errorMsg = "error" in result ? result.error : "Diff application failed"
		throw new Error(`Failed to apply diff to ${params.path}: ${errorMsg}`)
	}

	const resultContent = result.content
	if (resourceLimits) {
		const writeBytes = Buffer.byteLength(resultContent, "utf-8")
		const granted = resourceLimits.acquireWriteBytes(writeBytes)
		if (granted < writeBytes) {
			throw new Error(
				`Resource limit exceeded: write budget insufficient for diff result (needed ${writeBytes} bytes, granted ${granted})`,
			)
		}
	}

	await atomicWriteFile(absPath, resultContent)
	return `Successfully applied diff to ${params.path}`
}
