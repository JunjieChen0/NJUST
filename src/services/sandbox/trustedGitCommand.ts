import { constants as fsConstants, existsSync } from "fs"
import { promises as fs } from "fs"
import * as path from "path"

import { parse } from "shell-quote"

import { logger } from "../../shared/logger"
import { CommandFailedError } from "./SandboxErrors"

export interface TrustedGitCommand {
	executable: string
	args: string[]
	ceilingDirectory: string
}

type ResolveGitExecutable = (workspacePath: string) => Promise<string>

export interface ValidatedGitRepository {
	repositoryRoot: string
	gitDirectory: string
	commonGitDirectory: string
	ceilingDirectory: string
}

type ValidateGitRepository = (workspacePath: string, cwd: string) => Promise<ValidatedGitRepository>

export interface TrustedGitPreparationOptions {
	cwd?: string
	resolveGit?: ResolveGitExecutable
	validateRepository?: ValidateGitRepository
}

const READ_ONLY_SUBCOMMANDS = new Set(["diff", "log", "show"])

const FORBIDDEN_OPTIONS = new Set(["--ext-diff", "--no-index", "--output", "--show-signature", "--textconv"])

const SAFE_STANDALONE_OPTIONS = new Set([
	"--abbrev-commit",
	"--all",
	"--ancestry-path",
	"--author-date-order",
	"--binary",
	"--boundary",
	"--branches",
	"--cached",
	"--check",
	"--cherry-mark",
	"--cherry-pick",
	"--compact-summary",
	"--date-order",
	"--decorate",
	"--exit-code",
	"--find-copies",
	"--find-renames",
	"--first-parent",
	"--full-diff",
	"--full-history",
	"--graph",
	"--histogram",
	"--left-only",
	"--merge-base",
	"--merges",
	"--minimal",
	"--name-only",
	"--name-status",
	"--no-abbrev-commit",
	"--no-decorate",
	"--no-merges",
	"--no-patch",
	"--no-renames",
	"--not",
	"--numstat",
	"--oneline",
	"--patch",
	"--patience",
	"--quiet",
	"--raw",
	"--remotes",
	"--reverse",
	"--right-only",
	"--shortstat",
	"--simplify-merges",
	"--source",
	"--staged",
	"--stat",
	"--summary",
	"--tags",
	"--topo-order",
	"--word-diff",
	"-b",
	"-p",
	"-s",
	"-w",
])

const SAFE_VALUE_OPTIONS = new Set([
	"--abbrev",
	"--after",
	"--author",
	"--before",
	"--committer",
	"--date",
	"--diff-algorithm",
	"--diff-filter",
	"--encoding",
	"--format",
	"--grep",
	"--inter-hunk-context",
	"--max-count",
	"--max-parents",
	"--min-parents",
	"--pretty",
	"--since",
	"--skip",
	"--unified",
	"--until",
	"--word-diff-regex",
])

const SAFE_OPTIONAL_VALUE_OPTIONS = new Set([
	"--branches",
	"--color",
	"--color-moved",
	"--color-moved-ws",
	"--decorate",
	"--exclude",
	"--find-copies",
	"--find-renames",
	"--glob",
	"--ignore-submodules",
	"--relative",
	"--remotes",
	"--tags",
	"--word-diff",
])

const SAFE_GLOBAL_OPTIONS = new Set(["--no-pager", "--no-lazy-fetch", "--no-optional-locks"])

const ENV_EXPANSION_RE = /\$(?:[A-Za-z_][A-Za-z0-9_]*|\{)|%[A-Za-z_][A-Za-z0-9_]*%/
const SIGNATURE_FORMAT_RE = /%G[A-Z]?/
const MAILMAP_FORMAT_RE = /%(?:a|c)[NELL]/
const BUILTIN_PRETTY_FORMATS = new Set([
	"oneline",
	"short",
	"medium",
	"full",
	"fuller",
	"reference",
	"email",
	"mboxrd",
	"raw",
])

function blocked(reason: string): never {
	const error = new CommandFailedError(1, `Remote Git command blocked: ${reason}`)
	error.message = error.stderr
	throw error
}

function isWorkspacePath(workspacePath: string, candidatePath: string): boolean {
	const relative = path.relative(
		process.platform === "win32" ? workspacePath.toLowerCase() : workspacePath,
		process.platform === "win32" ? candidatePath.toLowerCase() : candidatePath,
	)
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

async function readSmallMetadataFile(filePath: string, maxBytes = 64 * 1024): Promise<string> {
	const stat = await fs.lstat(filePath)
	if (stat.isSymbolicLink()) blocked(`Git metadata symbolic links are not permitted: ${filePath}`)
	if (!stat.isFile() || stat.size > maxBytes) blocked(`Git metadata file is invalid: ${filePath}`)
	return fs.readFile(filePath, "utf8")
}

async function assertNoSymlinkComponents(workspacePath: string, candidatePath: string): Promise<void> {
	const relative = path.relative(workspacePath, candidatePath)
	if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
		blocked("Git metadata path escapes the workspace")
	}

	let current = workspacePath
	for (const segment of relative.split(path.sep).filter(Boolean)) {
		current = path.join(current, segment)
		const stat = await fs.lstat(current)
		if (stat.isSymbolicLink()) blocked(`Git metadata symbolic links are not permitted: ${current}`)
	}
}

async function resolveGitDirectory(
	dotGitPath: string,
	repositoryRoot: string,
	workspacePath: string,
	strict: boolean,
): Promise<string> {
	const stat = await fs.lstat(dotGitPath)
	if (stat.isSymbolicLink()) {
		if (strict) blocked(".git symbolic links are not permitted")
		const lexicalTarget = await fs
			.readlink(dotGitPath)
			.then((target) => path.resolve(path.dirname(dotGitPath), target))
		if (!isWorkspacePath(workspacePath, lexicalTarget))
			return blocked("Git metadata directory escapes the workspace")
		return fs.realpath(dotGitPath)
	}
	if (stat.isDirectory()) return fs.realpath(dotGitPath)
	if (!stat.isFile()) blocked(`unsupported .git metadata type at ${dotGitPath}`)

	const pointer = await readSmallMetadataFile(dotGitPath, 4 * 1024)
	const match = /^gitdir:\s*(.+?)\s*$/im.exec(pointer)
	if (!match?.[1]) blocked(`invalid .git pointer at ${dotGitPath}`)
	const lexicalTarget = path.resolve(repositoryRoot, match[1])
	if (!isWorkspacePath(workspacePath, lexicalTarget)) blocked("Git metadata directory escapes the workspace")
	if (strict) await assertNoSymlinkComponents(workspacePath, lexicalTarget)
	return fs.realpath(lexicalTarget)
}

async function resolveCommonGitDirectory(
	gitDirectory: string,
	workspacePath: string,
	strict: boolean,
): Promise<string> {
	const commonDirFile = path.join(gitDirectory, "commondir")
	if (!existsSync(commonDirFile)) return gitDirectory

	const relativeCommonDir = (await readSmallMetadataFile(commonDirFile, 4 * 1024)).trim()
	if (!relativeCommonDir) blocked(`invalid Git commondir file at ${commonDirFile}`)
	const lexicalTarget = path.resolve(gitDirectory, relativeCommonDir)
	if (!isWorkspacePath(workspacePath, lexicalTarget)) blocked("Git common metadata directory escapes the workspace")
	if (strict) await assertNoSymlinkComponents(workspacePath, lexicalTarget)
	return fs.realpath(lexicalTarget)
}

async function validateObjectDirectory(workspacePath: string, gitDirectory: string): Promise<void> {
	const objectsPath = path.join(gitDirectory, "objects")
	if (!existsSync(objectsPath)) return

	const realObjectsPath = await fs.realpath(objectsPath)
	if (!isWorkspacePath(workspacePath, realObjectsPath)) blocked("Git object directory escapes the workspace")

	const alternatesFile = path.join(realObjectsPath, "info", "alternates")
	if (!existsSync(alternatesFile)) return

	const alternates = await readSmallMetadataFile(alternatesFile)
	for (const entry of alternates
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)) {
		const resolvedEntry = path.resolve(realObjectsPath, entry)
		if (!isWorkspacePath(workspacePath, resolvedEntry)) blocked("Git object alternates escape the workspace")
		const realEntry = await fs.realpath(resolvedEntry)
		if (!isWorkspacePath(workspacePath, realEntry)) blocked("Git object alternates escape the workspace")
	}
}

async function validateMetadataTree(rootPath: string): Promise<void> {
	const pending = [rootPath]
	let scannedEntries = 0
	const maxEntries = 100_000

	while (pending.length > 0) {
		const current = pending.pop()!
		let directory: import("fs").Dir
		try {
			directory = await fs.opendir(current)
		} catch {
			blocked(`Git metadata directory is not readable: ${current}`)
		}

		try {
			for await (const entry of directory) {
				scannedEntries++
				if (scannedEntries > maxEntries) blocked("Git metadata tree is too large to validate safely")
				const entryPath = path.join(current, entry.name)
				const stat = await fs.lstat(entryPath)
				if (stat.isSymbolicLink()) blocked(`Git metadata symbolic links are not permitted: ${entryPath}`)
				if (stat.isDirectory()) pending.push(entryPath)
			}
		} finally {
			await directory
				.close()
				.catch((error) => logger.debug("TrustedGitCommand", "Failed to close metadata directory", error))
		}
	}
}

function rejectUnsafeGitConfig(filePath: string, content: string): void {
	let section: string | undefined
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim()
		if (!line || line.startsWith("#") || line.startsWith(";")) continue

		if (line.startsWith("[")) {
			const sectionMatch = /^\[([^\]]+)\]\s*$/.exec(line)
			if (!sectionMatch) blocked(`unsafe repository-local Git configuration: ${filePath}`)
			section = sectionMatch![1]!.trim().split(/\s+/, 1)[0]!.toLowerCase()
			if (section === "include" || section === "includeif" || section === "pretty") {
				blocked(`unsafe repository-local Git configuration: ${filePath}`)
			}
			continue
		}

		const keyMatch = /^([A-Za-z0-9][A-Za-z0-9.-]*)\s*(?:=|\s)\s*(.*)$/.exec(line)
		if (!section || !keyMatch) blocked(`unsafe repository-local Git configuration: ${filePath}`)
		const key = keyMatch![1]!.toLowerCase()
		const configIsUnsafe =
			section === "include" ||
			section === "includeif" ||
			(section === "core" && ["worktree", "fsmonitor", "hookspath"].includes(key)) ||
			(section === "filter" && ["clean", "smudge", "process"].includes(key)) ||
			(section === "extensions" && key === "partialclone") ||
			(section === "remote" && ["promisor", "partialclonefilter"].includes(key)) ||
			(section === "diff" && ["external", "orderfile", "command", "textconv"].includes(key)) ||
			(section === "mailmap" && key === "file") ||
			(section === "credential" && key === "helper") ||
			(section === "gpg" && key === "program") ||
			(section === "ssh" && key === "command")
		if (configIsUnsafe) blocked(`unsafe repository-local Git configuration: ${filePath}`)
	}
}

async function validateRepositoryConfig(gitDirectory: string): Promise<void> {
	for (const fileName of ["config", "config.worktree"]) {
		const filePath = path.join(gitDirectory, fileName)
		if (!existsSync(filePath)) continue
		const content = await readSmallMetadataFile(filePath, 256 * 1024)
		rejectUnsafeGitConfig(filePath, content)
	}
}

async function resolveGitRepositoryLayout(
	workspacePath: string,
	cwd: string,
	strict: boolean,
): Promise<ValidatedGitRepository | undefined> {
	const realWorkspacePath = await fs.realpath(workspacePath)
	let current = await fs.realpath(cwd)
	if (!isWorkspacePath(realWorkspacePath, current)) blocked("Git working directory escapes the workspace")

	while (isWorkspacePath(realWorkspacePath, current)) {
		const dotGitPath = path.join(current, ".git")
		if (existsSync(dotGitPath)) {
			const repositoryRoot = current
			const gitDirectory = await resolveGitDirectory(dotGitPath, repositoryRoot, realWorkspacePath, strict)
			if (!isWorkspacePath(realWorkspacePath, gitDirectory))
				blocked("Git metadata directory escapes the workspace")
			if (strict) await assertNoSymlinkComponents(realWorkspacePath, gitDirectory)

			const commonGitDirectory = await resolveCommonGitDirectory(gitDirectory, realWorkspacePath, strict)
			if (!isWorkspacePath(realWorkspacePath, commonGitDirectory)) {
				blocked("Git common metadata directory escapes the workspace")
			}

			if (strict) {
				await validateMetadataTree(gitDirectory)
				if (commonGitDirectory !== gitDirectory) await validateMetadataTree(commonGitDirectory)
				await validateRepositoryConfig(gitDirectory)
				if (commonGitDirectory !== gitDirectory) await validateRepositoryConfig(commonGitDirectory)
			}

			await validateObjectDirectory(realWorkspacePath, gitDirectory)
			if (commonGitDirectory !== gitDirectory) {
				await validateObjectDirectory(realWorkspacePath, commonGitDirectory)
			}
			return {
				repositoryRoot,
				gitDirectory,
				commonGitDirectory,
				ceilingDirectory: path.dirname(realWorkspacePath),
			}
		}

		if (current === realWorkspacePath) return undefined
		const parent = path.dirname(current)
		if (parent === current) return undefined
		current = parent
	}

	return undefined
}

async function resolveNearestExistingPath(candidatePath: string): Promise<string> {
	let current = candidatePath
	while (true) {
		try {
			return await fs.realpath(current)
		} catch {
			const parent = path.dirname(current)
			if (parent === current) throw new Error(`No existing parent for path: ${candidatePath}`)
			current = parent
		}
	}
}

async function hasGitMetadataMarker(workspacePath: string, cwd: string): Promise<boolean> {
	const realWorkspacePath = await fs.realpath(workspacePath)
	let current = await resolveNearestExistingPath(cwd)
	if (!isWorkspacePath(realWorkspacePath, current)) {
		throw new Error("Git working directory escapes the workspace")
	}

	while (isWorkspacePath(realWorkspacePath, current)) {
		const dotGitPath = path.join(current, ".git")
		try {
			await fs.lstat(dotGitPath)
			return true
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			// ENOENT: no .git here. ENOTDIR: `current` is a file, not a directory,
			// so it cannot contain a .git entry — treat both as "no marker found".
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error
		}
		if (current === realWorkspacePath) return false
		const parent = path.dirname(current)
		if (parent === current) return false
		current = parent
	}
	return false
}

export async function validateGitRepositoryContainment(
	workspacePath: string,
	cwd: string,
): Promise<ValidatedGitRepository> {
	const layout = await resolveGitRepositoryLayout(workspacePath, cwd, true)
	if (!layout) blocked("Git repository metadata was not found within the workspace")
	return layout
}

/** Resolve repository metadata roots for write protection without rejecting contained .git aliases. */
export async function resolveGitRepositoryLayoutForWrite(
	workspacePath: string,
	cwd: string,
): Promise<ValidatedGitRepository | undefined> {
	const markerFound = await hasGitMetadataMarker(workspacePath, cwd)
	if (!markerFound) return undefined

	try {
		const layout = await resolveGitRepositoryLayout(workspacePath, await resolveNearestExistingPath(cwd), false)
		if (!layout) throw new Error("Git repository metadata was not found after marker detection")
		await validateRepositoryConfig(layout.gitDirectory)
		if (layout.commonGitDirectory !== layout.gitDirectory) {
			await validateRepositoryConfig(layout.commonGitDirectory)
		}
		return layout
	} catch (error) {
		logger.debug("TrustedGitCommand", "Unable to resolve Git metadata for write protection", error)
		throw new Error("Git metadata could not be validated safely; write denied")
	}
}

function validateLiteral(value: string, context: string): void {
	if (value.includes("\0")) blocked(`${context} contains a null byte`)
	if (ENV_EXPANSION_RE.test(value)) blocked(`${context} contains environment expansion`)
	if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
		blocked(`${context} references the host home directory`)
	}
	if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
		blocked(`${context} contains an absolute host path`)
	}
	if (value.split(/[\\/]/).includes("..")) {
		blocked(`${context} escapes the workspace`)
	}
}

function validateOptionValue(option: string, value: string): void {
	if (!value) blocked(`${option} requires a value`)
	validateLiteral(value, `${option} value`)
	if (option === "--format" || option === "--pretty") {
		const lowerValue = value.toLowerCase()
		const isBuiltin = BUILTIN_PRETTY_FORMATS.has(lowerValue)
		const isExplicitFormat = lowerValue.startsWith("format:") || lowerValue.startsWith("tformat:")
		if (!isBuiltin && !isExplicitFormat) blocked(`${option} must use a built-in or explicit literal format`)
		if (SIGNATURE_FORMAT_RE.test(value) || MAILMAP_FORMAT_RE.test(value)) {
			blocked(`${option} may not request signature verification or mailmap placeholders`)
		}
	}
}

function validateArguments(args: string[]): void {
	for (let index = 0; index < args.length; index++) {
		const arg = args[index]!

		if (arg === "--") {
			for (const pathspec of args.slice(index + 1)) validateLiteral(pathspec, "pathspec")
			return
		}

		if (!arg.startsWith("-")) {
			validateLiteral(arg, "revision or path")
			continue
		}

		if (arg === "-O" || arg.startsWith("-O")) blocked("-O may read an order file outside the workspace")

		if (/^-(?:n|U|S|G)$/.test(arg)) {
			const value = args[++index]
			if (value === undefined) blocked(`${arg} requires a value`)
			validateOptionValue(arg, value)
			continue
		}

		if (/^(?:-\d+|-n\d+|-U\d+|-[SG].+)$/.test(arg)) {
			validateLiteral(arg.slice(2), `${arg.slice(0, 2)} value`)
			continue
		}

		const equalsIndex = arg.indexOf("=")
		const option = (equalsIndex >= 0 ? arg.slice(0, equalsIndex) : arg).toLowerCase()
		const inlineValue = equalsIndex >= 0 ? arg.slice(equalsIndex + 1) : undefined

		if (FORBIDDEN_OPTIONS.has(option)) blocked(`${option} is not permitted`)

		if (SAFE_STANDALONE_OPTIONS.has(option) && inlineValue === undefined) continue

		if (SAFE_OPTIONAL_VALUE_OPTIONS.has(option)) {
			if (inlineValue !== undefined) validateOptionValue(option, inlineValue)
			continue
		}

		if (SAFE_VALUE_OPTIONS.has(option)) {
			const value = inlineValue ?? args[++index]
			if (value === undefined) blocked(`${option} requires a value`)
			validateOptionValue(option, value)
			continue
		}

		blocked(`unsupported option ${option}`)
	}
}

function parseWords(command: string): string[] | undefined {
	let parsed: ReturnType<typeof parse>
	try {
		parsed = parse(command, (key) => `$${key}`)
	} catch (error) {
		logger.debug("TrustedGitCommand", "Failed to parse candidate Git command", error)
		if (/^\s*git(?:\.exe)?\s+(?:diff|log|show)\b/i.test(command))
			blocked("command syntax could not be parsed safely")
		return undefined
	}

	if (typeof parsed[0] !== "string" || !/^git(?:\.exe)?$/i.test(parsed[0])) return undefined

	// Git accepts global options before the subcommand. Strip only the options
	// whose behavior is already fixed by this wrapper and reject all others so
	// `git -c/-C/--git-dir ... log` cannot fall back to the shell policy path.
	let subcommandIndex = 1
	while (subcommandIndex < parsed.length) {
		const token = parsed[subcommandIndex]
		if (typeof token !== "string") blocked("shell operators and comments are not permitted")
		if (!token.startsWith("-")) break

		if (!SAFE_GLOBAL_OPTIONS.has(token)) {
			blocked(`unsupported Git global option ${token}`)
		}
		subcommandIndex++
	}

	const subcommand = parsed[subcommandIndex]
	if (typeof subcommand !== "string" || !READ_ONLY_SUBCOMMANDS.has(subcommand.toLowerCase())) {
		return undefined
	}

	return [parsed[0] as string, subcommand, ...parsed.slice(subcommandIndex + 1)].map((token) => {
		if (typeof token === "string") return token
		if (
			typeof token === "object" &&
			token !== null &&
			"op" in token &&
			(token as { op?: unknown }).op === "glob" &&
			"pattern" in token &&
			typeof (token as { pattern?: unknown }).pattern === "string"
		) {
			return (token as { pattern: string }).pattern
		}
		return blocked("shell operators and comments are not permitted")
	})
}

export async function resolveTrustedGitExecutable(workspacePath: string): Promise<string> {
	const workspaceRealPath = await fs.realpath(workspacePath)
	const searchPath = process.env.PATH ?? process.env.Path ?? ""
	const executableName = process.platform === "win32" ? "git.exe" : "git"

	for (const rawEntry of searchPath.split(path.delimiter)) {
		const entry = rawEntry.trim().replace(/^"|"$/g, "")
		if (!entry) continue

		const candidate = path.resolve(entry, executableName)
		if (!existsSync(candidate)) continue

		try {
			const realCandidate = await fs.realpath(candidate)
			const stat = await fs.stat(realCandidate)
			if (!stat.isFile()) continue
			await fs.access(realCandidate, fsConstants.X_OK)
			if (isWorkspacePath(workspaceRealPath, realCandidate)) {
				logger.warn("TrustedGitCommand", "Ignoring Git executable inside workspace", { realCandidate })
				continue
			}
			return realCandidate
		} catch (error) {
			logger.debug("TrustedGitCommand", "Git executable candidate is unusable", { candidate, error })
		}
	}

	return blocked("no trusted Git executable was found outside the workspace")
}

export async function prepareTrustedReadOnlyGitCommand(
	command: string,
	workspacePath: string,
	options: TrustedGitPreparationOptions = {},
): Promise<TrustedGitCommand | undefined> {
	const words = parseWords(command)
	if (!words) return undefined

	const subcommand = words[1]!.toLowerCase()
	const userArgs = words.slice(2)
	validateArguments(userArgs)
	const repository = await (options.validateRepository ?? validateGitRepositoryContainment)(
		workspacePath,
		options.cwd ?? workspacePath,
	)

	return {
		executable: await (options.resolveGit ?? resolveTrustedGitExecutable)(workspacePath),
		ceilingDirectory: repository.ceilingDirectory,
		args: [
			"--no-pager",
			`--git-dir=${repository.gitDirectory}`,
			`--work-tree=${repository.repositoryRoot}`,
			"-c",
			"core.attributesFile=",
			"-c",
			"diff.external=",
			"-c",
			"log.showSignature=false",
			"-c",
			"log.mailmap=false",
			"-c",
			"mailmap.file=",
			subcommand,
			"--no-ext-diff",
			"--no-textconv",
			...userArgs,
		],
	}
}
