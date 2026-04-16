import * as fs from "fs/promises"
import * as path from "path"
import * as childProcess from "child_process"

import { createDirectoriesForFile, fileExistsAtPath } from "../../utils/fs"
import { regexSearchFiles } from "../../services/ripgrep"
import { listFiles } from "../../services/glob/list-files"

/**
 * Ensures a resolved path stays within the workspace boundary (after realpath, to reduce symlink escape).
 * Throws if the path attempts to escape.
 */
async function ensureWithinWorkspace(cwd: string, relPath: string): Promise<string> {
	const resolved = path.resolve(cwd, relPath)
	let base = path.resolve(cwd)
	try {
		base = await fs.realpath(base)
	} catch {
		/* use logical cwd if missing */
	}
	let target = resolved
	try {
		target = await fs.realpath(resolved)
	} catch {
		if (!resolved.startsWith(base + path.sep) && resolved !== base) {
			throw new Error(`Path escapes workspace boundary: ${relPath}`)
		}
		return resolved
	}
	if (!target.startsWith(base + path.sep) && target !== base) {
		throw new Error(`Path escapes workspace boundary: ${relPath}`)
	}
	return target
}

export interface ReadFileParams {
	path: string
	start_line?: number
	end_line?: number
}

export async function execReadFile(cwd: string, params: ReadFileParams): Promise<string> {
	const absPath = await ensureWithinWorkspace(cwd, params.path)

	if (!(await fileExistsAtPath(absPath))) {
		throw new Error(`File not found: ${params.path}`)
	}

	const stat = await fs.stat(absPath)
	if (stat.isDirectory()) {
		throw new Error(`Path is a directory, not a file: ${params.path}`)
	}

	const content = await fs.readFile(absPath, "utf-8")
	const lines = content.split("\n")

	const startLine = Math.max(1, params.start_line ?? 1)
	const endLine = Math.min(lines.length, params.end_line ?? lines.length)

	const selectedLines = lines.slice(startLine - 1, endLine)
	const numbered = selectedLines.map((line, i) => `${startLine + i} | ${line}`).join("\n")

	return numbered
}

export interface WriteFileParams {
	path: string
	content: string
}

export async function execWriteFile(cwd: string, params: WriteFileParams): Promise<string> {
	const absPath = await ensureWithinWorkspace(cwd, params.path)

	const isNew = !(await fileExistsAtPath(absPath))
	if (isNew) {
		await createDirectoriesForFile(absPath)
	}

	await fs.writeFile(absPath, params.content, "utf-8")

	return isNew ? `Created new file: ${params.path}` : `Updated file: ${params.path}`
}

export interface ListFilesParams {
	path: string
	recursive?: boolean
}

export async function execListFiles(cwd: string, params: ListFilesParams): Promise<string> {
	const absPath = await ensureWithinWorkspace(cwd, params.path)

	if (!(await fileExistsAtPath(absPath))) {
		throw new Error(`Directory not found: ${params.path}`)
	}

	const [files, didHitLimit] = await listFiles(absPath, params.recursive ?? false, 500)

	const relFiles = files.map((f) => path.relative(cwd, f).replace(/\\/g, "/"))
	let result = relFiles.join("\n")

	if (didHitLimit) {
		result += "\n\n(Results truncated — limit reached)"
	}

	return result || "(Empty directory)"
}

export interface SearchFilesParams {
	path: string
	regex: string
	file_pattern?: string
}

export async function execSearchFiles(cwd: string, params: SearchFilesParams): Promise<string> {
	const absPath = await ensureWithinWorkspace(cwd, params.path)

	if (!(await fileExistsAtPath(absPath))) {
		throw new Error(`Directory not found: ${params.path}`)
	}

	return await regexSearchFiles(cwd, absPath, params.regex, params.file_pattern)
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
		execCwd = path.isAbsolute(params.cwd) ? params.cwd : path.resolve(workspaceCwd, params.cwd)
	}

	if (deniedCommands?.length) {
		const cmd = params.command.trim()
		for (const denied of deniedCommands) {
			if (cmd.startsWith(denied)) {
				throw new Error(`Command denied by policy: ${denied}`)
			}
		}
	}

	const timeoutMs = (params.timeout ?? 30) * 1000

	return new Promise<string>((resolve, reject) => {
		const isWindows = process.platform === "win32"
		const shell = isWindows ? "cmd.exe" : "/bin/sh"
		const shellArgs = isWindows ? ["/c", params.command] : ["-c", params.command]

		const proc = childProcess.spawn(shell, shellArgs, {
			cwd: execCwd,
			env: { ...process.env },
			stdio: ["ignore", "pipe", "pipe"],
		})

		let stdout = ""
		let stderr = ""

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString()
		})
		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString()
		})

		const timer = setTimeout(() => {
			proc.kill("SIGTERM")
			reject(new Error(`Command timed out after ${params.timeout ?? 30}s`))
		}, timeoutMs)

		proc.on("close", (code) => {
			clearTimeout(timer)
			const output = [
				`Exit code: ${code ?? "unknown"}`,
				stdout ? `\nSTDOUT:\n${stdout}` : "",
				stderr ? `\nSTDERR:\n${stderr}` : "",
			].join("")

			resolve(output)
		})

		proc.on("error", (err) => {
			clearTimeout(timer)
			reject(new Error(`Failed to execute command: ${err.message}`))
		})
	})
}

export interface ApplyDiffParams {
	path: string
	diff: string
}

export async function execApplyDiff(cwd: string, params: ApplyDiffParams): Promise<string> {
	const absPath = await ensureWithinWorkspace(cwd, params.path)

	if (!(await fileExistsAtPath(absPath))) {
		throw new Error(`File not found: ${params.path}`)
	}

	const originalContent = await fs.readFile(absPath, "utf-8")

	const { MultiSearchReplaceDiffStrategy } = await import("../../core/diff/strategies/multi-search-replace")
	const strategy = new MultiSearchReplaceDiffStrategy()
	const result = await strategy.applyDiff(originalContent, params.diff)

	if (!result.success) {
		const errorMsg = "error" in result ? result.error : "Diff application failed"
		throw new Error(`Failed to apply diff to ${params.path}: ${errorMsg}`)
	}

	await fs.writeFile(absPath, result.content, "utf-8")
	return `Successfully applied diff to ${params.path}`
}
