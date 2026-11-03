import { describe, it, expect, beforeEach, afterEach } from "vitest"

import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

import { resolveVerificationProjectRoot } from "../projectRoot"

async function makeProject(dir: string): Promise<string> {
	await fs.mkdir(path.join(dir, "src"), { recursive: true })
	await fs.writeFile(path.join(dir, "cjpm.toml"), '[package]\nname = "p"\n', "utf8")
	return dir
}

describe("resolveVerificationProjectRoot", () => {
	let ws: string
	let appA: string
	let appB: string

	beforeEach(async () => {
		ws = await fs.mkdtemp(path.join(os.tmpdir(), "cj-root-"))
		appA = await makeProject(path.join(ws, "appA"))
		appB = await makeProject(path.join(ws, "appB"))
	})

	afterEach(async () => {
		await fs.rm(ws, { recursive: true, force: true })
	})

	it("uses the project that contains the files the task wrote, not the first workspace folder", async () => {
		const result = await resolveVerificationProjectRoot({
			writtenPaths: [path.join(appB, "src", "main.cj")],
			cwd: ws,
			workspaceFolders: [appA, appB],
		})

		expect(result).toEqual({ kind: "resolved", root: appB })
	})

	it("blocks when written files span several projects", async () => {
		const result = await resolveVerificationProjectRoot({
			writtenPaths: [path.join(appA, "src", "a.cj"), path.join(appB, "src", "b.cj")],
			cwd: ws,
			workspaceFolders: [],
		})

		expect(result.kind).toBe("blocked")
		if (result.kind === "blocked") expect(result.candidates.sort()).toEqual([appA, appB].sort())
	})

	it("falls back to the project containing the task cwd", async () => {
		const result = await resolveVerificationProjectRoot({
			writtenPaths: [],
			cwd: path.join(appA, "src"),
			workspaceFolders: [appA, appB],
		})

		expect(result).toEqual({ kind: "resolved", root: appA })
	})

	it("uses a single workspace project when nothing else identifies one", async () => {
		const result = await resolveVerificationProjectRoot({ writtenPaths: [], cwd: ws, workspaceFolders: [appA, ws] })

		expect(result).toEqual({ kind: "resolved", root: appA })
	})

	it("blocks instead of guessing between several workspace projects", async () => {
		const result = await resolveVerificationProjectRoot({
			writtenPaths: [],
			cwd: ws,
			workspaceFolders: [appA, appB],
		})

		expect(result).toMatchObject({ kind: "blocked" })
	})

	it("blocks when no cjpm project exists", async () => {
		const empty = await fs.mkdtemp(path.join(os.tmpdir(), "cj-empty-"))
		try {
			const result = await resolveVerificationProjectRoot({ writtenPaths: [], cwd: empty, workspaceFolders: [] })

			expect(result).toMatchObject({ kind: "blocked", candidates: [] })
		} finally {
			await fs.rm(empty, { recursive: true, force: true })
		}
	})
})
