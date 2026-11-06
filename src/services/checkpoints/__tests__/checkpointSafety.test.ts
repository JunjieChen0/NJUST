import { describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { RepoPerTaskCheckpointService } from "../RepoPerTaskCheckpointService"

const capture = vi.hoisted(() => ({ logs: [] as string[] }))
vi.mock("../../../shared/logger", () => ({
	logger: Object.fromEntries(
		["info", "warn", "error", "debug"].map((level) => [
			level,
			(...args: unknown[]) => capture.logs.push(args.map(String).join(" ")),
		]),
	),
}))
vi.mock("@njust-ai/telemetry", () => ({ TelemetryService: { reportError() {} } }))
vi.mock("../../../i18n", () => ({ t: (key: string) => key }))
vi.mock("../../search/file-search", () => ({
	executeRipgrep: async ({ args, workspacePath }: { args: string[]; workspacePath: string }) => {
		const { execFileSync } = await import("node:child_process")
		const path = await import("node:path")
		try {
			const output = execFileSync("rg", args, { cwd: workspacePath, encoding: "utf8", windowsHide: true })
			return output
				.trim()
				.split(/\r?\n/)
				.filter(Boolean)
				.map((file) => ({ type: "file", path: path.relative(workspacePath, file) }))
		} catch (error: any) {
			if (error.status === 1) return []
			throw error
		}
	},
}))

const root = os.tmpdir()
const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", windowsHide: true }).trim()
async function fixture(name: string, files: Record<string, string> = { "main.ts": "before\n" }) {
	const dir = await fs.mkdtemp(path.join(root, "njust-checkpoint-" + name + "-"))
	const workspace = path.join(dir, "workspace"),
		shadow = path.join(dir, "shadow")
	await fs.mkdir(workspace)
	for (const [file, content] of Object.entries(files)) {
		await fs.mkdir(path.dirname(path.join(workspace, file)), { recursive: true })
		await fs.writeFile(path.join(workspace, file), content)
	}
	const events: any[] = []
	const service = RepoPerTaskCheckpointService.create({
		taskId: "probe",
		workspaceDir: workspace,
		shadowDir: shadow,
		log() {},
	})
	service.on("checkpoint", (event) => events.push(event))
	service.on("error", () => {})
	await service.initShadowGit()
	return { dir, workspace, shadow, service, events, repo: service.checkpointsDir }
}

describe("checkpoint safety regressions (real Git; fixtures retained)", () => {
	it("control: save and restore existing content without changing the user's Git index", async () => {
		const f = await fixture("index-isolation")
		git(f.workspace, "init", "--template=")
		git(f.workspace, "config", "user.name", "Checkpoint Probe")
		git(f.workspace, "config", "user.email", "probe@example.invalid")
		git(f.workspace, "add", "main.ts")
		git(f.workspace, "-c", "commit.gpgSign=false", "commit", "-m", "initial")
		await fs.writeFile(path.join(f.workspace, "main.ts"), "staged\n")
		git(f.workspace, "add", "main.ts")
		const indexHash = () =>
			fs
				.readFile(path.join(f.workspace, ".git/index"))
				.then((bytes) => createHash("sha256").update(bytes).digest("hex"))
		const beforeIndex = await indexHash()
		await fs.writeFile(path.join(f.workspace, "main.ts"), "unstaged\n")
		await f.service.saveCheckpoint("checkpoint")
		expect(await indexHash()).toBe(beforeIndex)
		await f.service.restoreCheckpoint(f.service.baseHash!)
		const restored = await fs.readFile(path.join(f.workspace, "main.ts"), "utf8")
		expect(restored.replace(/\r\n/g, "\n")).toBe("before\n")
		expect(await indexHash()).toBe(beforeIndex)
	})

	it("rejects incomplete snapshots and emits no success after a staging failure", async () => {
		const f = await fixture("staging-failure")
		await fs.writeFile(path.join(f.workspace, ".gitattributes"), "main.ts filter=checkpoint-audit\n")
		git(f.repo, "config", "filter.checkpoint-audit.clean", "checkpoint-audit-missing-filter-executable")
		git(f.repo, "config", "filter.checkpoint-audit.required", "true")
		await fs.writeFile(path.join(f.workspace, "main.ts"), "must-be-backed-up\n")
		const before = git(f.repo, "rev-parse", "HEAD")
		await expect(f.service.saveCheckpoint("forced snapshot", { allowEmpty: true })).rejects.toThrow()
		expect(git(f.repo, "rev-parse", "HEAD")).toBe(before)
		expect(f.events).toHaveLength(0)
	})

	it("restores SQL migrations, dependency locks and CSV sources", async () => {
		const files = {
			"main.ts": "before\n",
			"migration.sql": "before\n",
			"cjpm.lock": "before\n",
			"data.csv": "before\n",
		}
		const f = await fixture("excluded-source", files)
		for (const file of Object.keys(files)) await fs.writeFile(path.join(f.workspace, file), "after\n")
		await f.service.saveCheckpoint("changes")
		await f.service.restoreCheckpoint(f.service.baseHash!)
		const content = Object.fromEntries(
			await Promise.all(
				Object.keys(files).map(async (file) => [
					file,
					(await fs.readFile(path.join(f.workspace, file), "utf8")).trim(),
				]),
			),
		)
		expect(content).toEqual({
			"main.ts": "before",
			"migration.sql": "before",
			"cjpm.lock": "before",
			"data.csv": "before",
		})
	})

	it("shows untracked files without changing either restore contents or the index", async () => {
		const f = await fixture("untracked-preview")
		await fs.writeFile(path.join(f.workspace, "new.ts"), "new user file\n")
		await f.service.restoreCheckpoint(f.service.baseHash!)
		expect(await fs.readFile(path.join(f.workspace, "new.ts"), "utf8")).toBe("new user file\n")
		const indexBefore = git(f.repo, "ls-files")
		const diff = await f.service.getDiff({ from: f.service.baseHash! })
		expect(diff.some((entry) => entry.paths.relative === "new.ts")).toBe(true)
		const indexAfter = git(f.repo, "ls-files")
		expect(indexBefore).not.toContain("new.ts")
		expect(indexAfter).toBe(indexBefore)
		await f.service.restoreCheckpoint(f.service.baseHash!)
		expect(await fs.readFile(path.join(f.workspace, "new.ts"), "utf8")).toBe("new user file\n")
	})

	it("preserves both contents and the new path for historical renames", async () => {
		const f = await fixture("rename-diff", { "old.ts": "export const example = 123\n" })
		await fs.writeFile(path.join(f.workspace, "new.ts"), "export const example = 123\n")
		git(f.repo, "add", "new.ts")
		git(f.repo, "update-index", "--force-remove", "old.ts")
		git(f.repo, "commit", "-m", "index-only rename; files retained")
		const to = git(f.repo, "rev-parse", "HEAD")
		const diff = await f.service.getDiff({ from: f.service.baseHash!, to })
		expect(diff.length).toBe(1)
		expect(diff[0].paths.relative).toBe("new.ts")
		expect(diff[0].content.before).toContain("export const example = 123")
		expect(diff[0].content.after).toContain("export const example = 123")
	})

	it("preserves Chinese filenames and contents in working tree diffs", async () => {
		const f = await fixture("unicode-diff", { "文本.cj": "before\n" })
		await fs.writeFile(path.join(f.workspace, "文本.cj"), "after\n")
		const diff = await f.service.getDiff({ from: f.service.baseHash! })
		expect(diff.length).toBe(1)
		expect(diff[0].paths.relative).toBe("文本.cj")
		expect(diff[0].content).toEqual({ before: "before\n", after: "after\n" })
	})

	it("rejects nested repositories represented by .git files", async () => {
		const f = await fixture("nested-git-file")
		const nested = path.join(f.workspace, "nested")
		await fs.mkdir(nested)
		git(nested, "init", "--template=", "--separate-git-dir=" + path.join(f.dir, "nested-metadata"))
		git(nested, "config", "user.name", "Checkpoint Probe")
		git(nested, "config", "user.email", "probe@example.invalid")
		await fs.writeFile(path.join(nested, "source.ts"), "nested before\n")
		git(nested, "add", "source.ts")
		git(nested, "-c", "commit.gpgSign=false", "commit", "-m", "nested initial")
		const service = RepoPerTaskCheckpointService.create({
			taskId: "nested-probe",
			workspaceDir: f.workspace,
			shadowDir: f.shadow,
			log() {},
		})
		service.on("error", () => {})
		await expect(service.initShadowGit()).rejects.toThrow("nested git repository")
		expect(service.isInitialized).toBe(false)
	})

	it("logs removed environment variable names without their values", async () => {
		const previous = process.env.GIT_CHECKPOINT_AUDIT_TOKEN
		process.env.GIT_CHECKPOINT_AUDIT_TOKEN = "CHECKPOINT_AUDIT_SYNTHETIC_SECRET" // gitleaks:allow -- synthetic regression fixture
		try {
			capture.logs.length = 0
			await fixture("env-log")
			const exposed = capture.logs.some((message) => message.includes("CHECKPOINT_AUDIT_SYNTHETIC_SECRET"))
			expect(exposed).toBe(false)
			expect(capture.logs.some((message) => message.includes("GIT_CHECKPOINT_AUDIT_TOKEN"))).toBe(true)
		} finally {
			if (previous === undefined) delete process.env.GIT_CHECKPOINT_AUDIT_TOKEN
			else process.env.GIT_CHECKPOINT_AUDIT_TOKEN = previous
		}
	})
})
