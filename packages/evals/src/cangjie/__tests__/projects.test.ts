import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, expect, it } from "vitest"
import { addOracle, copyEvaluationProject, prepareCase } from "../projects.js"
import type { CangjieTaskCase } from "../suite.js"

let base: string
let workspace: string
let outside: string
const task: CangjieTaskCase = {
	id: "boundary",
	project: "sample",
	category: "feature",
	prompt: "",
	startingPoint: "clean",
	allowedChanges: [],
	requiredAssertions: [],
}
beforeEach(async () => {
	base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "eval-boundary-")))
	workspace = path.join(base, "workspace")
	outside = path.join(base, "outside")
	await fs.mkdir(workspace)
	await fs.mkdir(outside)
	await fs.writeFile(path.join(outside, "victim.cj"), "unchanged")
})
afterEach(async () => {
	await fs.rm(base, { recursive: true, force: true })
})

it.each(["initialFiles", "oracleFiles"] as const)("rejects a directory link before writing %s", async (kind) => {
	await fs.symlink(outside, path.join(workspace, "src"), process.platform === "win32" ? "junction" : "dir")
	const write = kind === "initialFiles" ? prepareCase : addOracle
	await expect(write({ ...task, [kind]: { "src/victim.cj": "overwritten" } }, workspace)).rejects.toThrow(
		/link|reparse/i,
	)
	expect(await fs.readFile(path.join(outside, "victim.cj"), "utf8")).toBe("unchanged")
})

it.each(["../outside/victim.cj", "..\\outside\\victim.cj", "C:\\outside\\victim.cj", "/outside/victim.cj"])(
	"rejects an escaping path %s",
	async (file) => {
		await expect(prepareCase({ ...task, initialFiles: { [file]: "overwritten" } }, workspace)).rejects.toThrow(
			/path/i,
		)
		expect(await fs.readFile(path.join(outside, "victim.cj"), "utf8")).toBe("unchanged")
	},
)

it("writes normal initial and oracle files within the project", async () => {
	await prepareCase({ ...task, initialFiles: { "src/main.cj": "initial" } }, workspace)
	await addOracle({ ...task, oracleFiles: { "src/oracle_test.cj": "oracle" } }, workspace)
	expect(await fs.readFile(path.join(workspace, "src/main.cj"), "utf8")).toBe("initial")
	expect(await fs.readFile(path.join(workspace, "src/oracle_test.cj"), "utf8")).toBe("oracle")
})

it("rejects external fixture links before copying any files", async () => {
	await fs.symlink(outside, path.join(workspace, "src"), process.platform === "win32" ? "junction" : "dir")
	const destination = path.join(base, "copy")
	await expect(copyEvaluationProject(workspace, destination)).rejects.toThrow(/link/i)
	await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" })
	expect(await fs.readFile(path.join(outside, "victim.cj"), "utf8")).toBe("unchanged")
})

it("copies a normal project before applying initial and oracle files", async () => {
	await fs.writeFile(path.join(workspace, "cjpm.toml"), "[package]")
	const destination = path.join(base, "copy")
	await copyEvaluationProject(workspace, destination)
	await prepareCase({ ...task, initialFiles: { "src/main.cj": "initial" } }, destination)
	await addOracle({ ...task, oracleFiles: { "src/test.cj": "oracle" } }, destination)
	expect(await fs.readFile(path.join(destination, "cjpm.toml"), "utf8")).toBe("[package]")
})
