import { afterEach, describe, expect, it, vi } from "vitest"
import { execFile } from "child_process"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises"
import { tmpdir } from "os"
import * as path from "path"
import { promisify } from "util"

import { CommandFailedError } from "../SandboxErrors"
import { prepareTrustedReadOnlyGitCommand, validateGitRepositoryContainment } from "../trustedGitCommand"

const trustedGitPath = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git"
const resolveGit = vi.fn(async () => trustedGitPath)
const validateRepository = vi.fn(async (workspacePath: string) => ({
	repositoryRoot: workspacePath,
	gitDirectory: path.join(workspacePath, ".git"),
	commonGitDirectory: path.join(workspacePath, ".git"),
	ceilingDirectory: path.dirname(workspacePath),
}))
const hardenedArgs = (workspacePath: string) => [
	"--no-pager",
	`--git-dir=${path.join(workspacePath, ".git")}`,
	`--work-tree=${workspacePath}`,
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
]

describe("prepareTrustedReadOnlyGitCommand", () => {
	it.each([
		[
			"git log --oneline -n 5 -- src/index.ts",
			[
				...hardenedArgs(process.cwd()),
				"log",
				"--no-ext-diff",
				"--no-textconv",
				"--oneline",
				"-n",
				"5",
				"--",
				"src/index.ts",
			],
		],
		[
			"git diff --stat HEAD~1 HEAD",
			[...hardenedArgs(process.cwd()), "diff", "--no-ext-diff", "--no-textconv", "--stat", "HEAD~1", "HEAD"],
		],
		[
			'git show --format="format:%H %s" HEAD',
			[...hardenedArgs(process.cwd()), "show", "--no-ext-diff", "--no-textconv", "--format=format:%H %s", "HEAD"],
		],
	] as const)("builds a shell-free invocation for %s", async (command, expectedArgs) => {
		await expect(
			prepareTrustedReadOnlyGitCommand(command, process.cwd(), { resolveGit, validateRepository }),
		).resolves.toEqual({
			executable: trustedGitPath,
			ceilingDirectory: path.dirname(process.cwd()),
			args: expectedArgs,
		})
	})

	it.each([
		"git log --pretty=custom HEAD",
		"git log --format=custom HEAD",
		"git log --format=%H HEAD",
		"git log --pretty=tformat:%GS HEAD",
	])("rejects indirect or signature-verifying pretty formats: %s", async (command) => {
		await expect(
			prepareTrustedReadOnlyGitCommand(command, process.cwd(), { resolveGit, validateRepository }),
		).rejects.toBeInstanceOf(CommandFailedError)
	})

	it.each(["git log --pretty=oneline HEAD", "git log --pretty=format:%H HEAD", "git show --format=tformat:%H HEAD"])(
		"allows built-in and explicit literal pretty formats: %s",
		async (command) => {
			await expect(
				prepareTrustedReadOnlyGitCommand(command, process.cwd(), { resolveGit, validateRepository }),
			).resolves.toBeDefined()
		},
	)

	it.each([
		"git diff --no-index ../../.ssh/id_rsa NUL",
		"git diff --output=../outside.txt HEAD",
		"git diff -O ../../order.txt HEAD",
		"git diff --ext-diff HEAD",
		"git log --textconv HEAD",
		"git show --show-signature HEAD",
		'git log --format="%GS" HEAD',
		"git diff C:/Users/Public/secret.txt",
		"git diff ../../.ssh/id_rsa",
		"git diff $HOME/.ssh/id_rsa",
		"git diff %USERPROFILE%/.ssh/id_rsa",
	])("rejects unsafe host Git arguments: %s", async (command) => {
		const error = await prepareTrustedReadOnlyGitCommand(command, process.cwd(), {
			resolveGit,
			validateRepository,
		}).catch((caught) => caught)

		expect(error).toBeInstanceOf(CommandFailedError)
		expect(error.stderr).toContain("Remote Git command blocked")
	})

	it.each([
		"git -c core.pager=cat log",
		"git -C .. log",
		"git --git-dir=.git log",
		"git --work-tree=. log",
		"git --no-pager=1 log",
	])("rejects Git global options that bypass the trusted invocation: %s", async (command) => {
		const error = await prepareTrustedReadOnlyGitCommand(command, process.cwd(), {
			resolveGit,
			validateRepository,
		}).catch((caught) => caught)

		expect(error).toBeInstanceOf(CommandFailedError)
		expect(error.stderr).toContain("unsupported Git global option")
	})

	it.each(["git --no-pager log", "git --no-lazy-fetch log", "git --no-optional-locks log"])(
		"allows fixed Git global option: %s",
		async (command) => {
			await expect(
				prepareTrustedReadOnlyGitCommand(command, process.cwd(), { resolveGit, validateRepository }),
			).resolves.toBeDefined()
		},
	)

	it.each(["git status --short", "node -e \"console.log('git log')\""])(
		"leaves non-default commands on the existing policy path: %s",
		async (command) => {
			await expect(
				prepareTrustedReadOnlyGitCommand(command, process.cwd(), { resolveGit, validateRepository }),
			).resolves.toBeUndefined()
		},
	)
})

describe("validateGitRepositoryContainment", () => {
	let tempDir: string | undefined

	afterEach(async () => {
		if (tempDir) await rm(tempDir, { recursive: true, force: true })
		tempDir = undefined
	})

	it("accepts Git metadata and objects contained by the workspace", async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "trusted-git-contained-"))
		const workspacePath = path.join(tempDir, "workspace")
		await mkdir(path.join(workspacePath, ".git", "objects"), { recursive: true })

		await expect(validateGitRepositoryContainment(workspacePath, workspacePath)).resolves.toEqual({
			repositoryRoot: workspacePath,
			gitDirectory: path.join(workspacePath, ".git"),
			commonGitDirectory: path.join(workspacePath, ".git"),
			ceilingDirectory: tempDir,
		})
	})

	it("rejects a .git directory symlink even when its target is inside the workspace", async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "trusted-git-symlink-"))
		const workspacePath = path.join(tempDir, "workspace")
		const metadataPath = path.join(workspacePath, "git-metadata")
		await mkdir(path.join(metadataPath, "objects"), { recursive: true })
		await symlink(metadataPath, path.join(workspacePath, ".git"), process.platform === "win32" ? "junction" : "dir")

		await expect(validateGitRepositoryContainment(workspacePath, workspacePath)).rejects.toThrow(
			".git symbolic links are not permitted",
		)
	})

	it("accepts a contained .git pointer", async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "trusted-git-pointer-contained-"))
		const workspacePath = path.join(tempDir, "workspace")
		const metadataPath = path.join(workspacePath, "git-metadata")
		await mkdir(path.join(metadataPath, "objects"), { recursive: true })
		await writeFile(path.join(workspacePath, ".git"), "gitdir: git-metadata\n")

		await expect(validateGitRepositoryContainment(workspacePath, workspacePath)).resolves.toEqual(
			expect.objectContaining({
				repositoryRoot: workspacePath,
				gitDirectory: metadataPath,
				commonGitDirectory: metadataPath,
			}),
		)
	})

	it("rejects a .git pointer to metadata outside the workspace", async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "trusted-git-pointer-"))
		const workspacePath = path.join(tempDir, "workspace")
		const outsideGitDir = path.join(tempDir, "outside.git")
		await mkdir(workspacePath, { recursive: true })
		await mkdir(outsideGitDir, { recursive: true })
		await writeFile(path.join(workspacePath, ".git"), `gitdir: ${outsideGitDir}\n`)

		const error = await validateGitRepositoryContainment(workspacePath, workspacePath).catch((caught) => caught)
		expect(error).toBeInstanceOf(CommandFailedError)
		expect(error.stderr).toContain("Git metadata directory escapes the workspace")
	})

	it("rejects an object alternate outside the workspace", async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "trusted-git-alternate-"))
		const workspacePath = path.join(tempDir, "workspace")
		const infoPath = path.join(workspacePath, ".git", "objects", "info")
		const outsideObjects = path.join(tempDir, "outside-objects")
		await mkdir(infoPath, { recursive: true })
		await mkdir(outsideObjects, { recursive: true })
		await writeFile(path.join(infoPath, "alternates"), `${outsideObjects}\n`)

		const error = await validateGitRepositoryContainment(workspacePath, workspacePath).catch((caught) => caught)
		expect(error).toBeInstanceOf(CommandFailedError)
		expect(error.stderr).toContain("Git object alternates escape the workspace")
	})

	it("rejects a commondir outside the workspace", async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "trusted-git-commondir-"))
		const workspacePath = path.join(tempDir, "workspace")
		const outsideCommonDir = path.join(tempDir, "common.git")
		await mkdir(path.join(workspacePath, ".git", "objects"), { recursive: true })
		await mkdir(outsideCommonDir, { recursive: true })
		await writeFile(path.join(workspacePath, ".git", "commondir"), outsideCommonDir)

		await expect(validateGitRepositoryContainment(workspacePath, workspacePath)).rejects.toThrow(
			"Git common metadata directory escapes the workspace",
		)
	})

	it("rejects symbolic links inside Git metadata", async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "trusted-git-metadata-link-"))
		const workspacePath = path.join(tempDir, "workspace")
		const outsideRefs = path.join(tempDir, "outside-refs")
		await mkdir(path.join(workspacePath, ".git", "objects"), { recursive: true })
		await mkdir(outsideRefs, { recursive: true })
		await symlink(
			outsideRefs,
			path.join(workspacePath, ".git", "refs"),
			process.platform === "win32" ? "junction" : "dir",
		)

		await expect(validateGitRepositoryContainment(workspacePath, workspacePath)).rejects.toThrow(
			"Git metadata symbolic links are not permitted",
		)
	})

	it.each([
		["include", "[include]\n\tpath = ../outside-config\n"],
		["conditional include", '[includeIf "gitdir:work/"]\n\tpath = ../outside-config\n'],
		["external worktree", "[core]\n\tworktree = ../../outside\n"],
		["fsmonitor hook", "[core]\n\tfsmonitor = ./helper\n"],
		["clean filter", '[filter "evil"]\n\tclean = ./helper\n'],
		["smudge filter", '[filter "evil"]\n\tsmudge = ./helper\n'],
		["process filter", '[filter "evil"]\n\tprocess = ./helper\n'],
		["partial clone", "[extensions]\n\tpartialClone = origin\n"],
		["promisor remote", '[remote "origin"]\n\tpromisor = true\n'],
		["custom pretty format", "[pretty]\n\tevil = format:%GS\n"],
	] as const)("rejects dangerous repository-local %s configuration", async (_name, config) => {
		tempDir = await mkdtemp(path.join(tmpdir(), "trusted-git-config-"))
		const workspacePath = path.join(tempDir, "workspace")
		await mkdir(path.join(workspacePath, ".git", "objects"), { recursive: true })
		await writeFile(path.join(workspacePath, ".git", "config"), config)

		await expect(validateGitRepositoryContainment(workspacePath, workspacePath)).rejects.toThrow(
			"unsafe repository-local Git configuration",
		)
	})

	it("runs ordinary log, show, and diff commands in a real contained repository", async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "trusted-git-smoke-"))
		const workspacePath = path.join(tempDir, "workspace")
		await mkdir(workspacePath, { recursive: true })
		const gitExecutable = await import("../trustedGitCommand").then((module) =>
			module.resolveTrustedGitExecutable(workspacePath),
		)
		const runGit = promisify(execFile)
		await runGit(gitExecutable, ["init"], { cwd: workspacePath })
		await runGit(gitExecutable, ["config", "user.email", "test@example.com"], { cwd: workspacePath })
		await runGit(gitExecutable, ["config", "user.name", "Trusted Git Test"], { cwd: workspacePath })
		await writeFile(path.join(workspacePath, "file.txt"), "before\n")
		await runGit(gitExecutable, ["add", "file.txt"], { cwd: workspacePath })
		await runGit(gitExecutable, ["commit", "-m", "initial"], { cwd: workspacePath })
		await writeFile(path.join(workspacePath, "file.txt"), "after\n")

		for (const command of ["git log --oneline", "git show --stat HEAD", "git diff -- file.txt"]) {
			const prepared = await prepareTrustedReadOnlyGitCommand(command, workspacePath)
			expect(prepared).toBeDefined()
			const result = await runGit(prepared!.executable, prepared!.args, {
				cwd: workspacePath,
				env: {
					...process.env,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
					GIT_NO_LAZY_FETCH: "1",
					GIT_OPTIONAL_LOCKS: "0",
				},
			})
			expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0)
		}
	}, 30_000)
})
