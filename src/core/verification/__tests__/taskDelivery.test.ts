import { describe, it, expect } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { computeProjectSnapshot } from "../projectFingerprint"
import { captureDeliveryBaseline, buildTaskDelivery } from "../taskDelivery"

async function fixture(run: (root: string, taskDir: string) => Promise<void>) {
	const base = await fs.mkdtemp(path.join(os.tmpdir(), "cj-delivery-"))
	try {
		const root = path.join(base, "project")
		await fs.mkdir(path.join(root, "src"), { recursive: true })
		await fs.writeFile(path.join(root, "cjpm.toml"), '[package]\nname = "demo"\n')
		await fs.writeFile(path.join(root, "src", "main.cj"), "package demo\nmain() { 1 }\n")
		await run(root, path.join(base, "task"))
	} finally {
		await fs.rm(base, { recursive: true, force: true })
	}
}

describe("task delivery evidence", () => {
	it("attributes tool edits through project aliases to the canonical delivery", async () =>
		fixture(async (root, taskDir) => {
			const alias = path.join(path.dirname(root), "project-alias")
			await fs.symlink(root, alias, process.platform === "win32" ? "junction" : "dir")
			await captureDeliveryBaseline(taskDir, root, await computeProjectSnapshot(root))
			await fs.writeFile(path.join(alias, "src/main.cj"), "main() { 42 }\n")
			const canonicalRoot = await fs.realpath(root)
			const delivery = await buildTaskDelivery(
				taskDir,
				canonicalRoot,
				await computeProjectSnapshot(canonicalRoot),
				[path.join(alias, "src/main.cj")],
				"alias",
				1,
			)
			expect(delivery.files).toEqual([{ path: "src/main.cj", change: "modified", source: "task_tool" }])
		}))
	it("keeps the initial inputs and a delivered diff after subsequent external edits", async () =>
		fixture(async (root, taskDir) => {
			const baseline = await computeProjectSnapshot(root)
			await captureDeliveryBaseline(taskDir, root, baseline)
			const file = path.join(root, "src", "main.cj")
			await fs.writeFile(file, "package demo\nmain() { 42 }\n")
			// A repeated preparation must not replace the task's starting point.
			const snapshot = await computeProjectSnapshot(root)
			await captureDeliveryBaseline(taskDir, root, snapshot)
			const delivery = await buildTaskDelivery(taskDir, root, snapshot, [file], "claim-1", 10)
			expect(delivery.baselineFingerprint).toBe(baseline.fingerprint)
			expect(delivery.files).toEqual([{ path: "src/main.cj", change: "modified", source: "task_tool" }])
			const patch = await fs.readFile(delivery.diffPath!, "utf8")
			expect(patch).toContain("-main() { 1 }")
			expect(patch).toContain("+main() { 42 }")
			await fs.writeFile(file, "package demo\nmain() { 99 }\n")
			expect((await computeProjectSnapshot(root)).fingerprint).not.toBe(delivery.fingerprint)
			expect(await fs.readFile(delivery.diffPath!, "utf8")).toBe(patch)
		}))

	it("lists sensitive, binary and large file changes without copying their contents into the diff", async () =>
		fixture(async (root, taskDir) => {
			await fs.writeFile(path.join(root, "credentials.json"), "sensitive-before")
			await fs.writeFile(path.join(root, "data.bin"), Buffer.from([0, 1]))
			await captureDeliveryBaseline(taskDir, root, await computeProjectSnapshot(root))
			await fs.writeFile(path.join(root, "credentials.json"), "sensitive-after")
			await fs.writeFile(path.join(root, "data.bin"), Buffer.from([0, 2]))
			await fs.writeFile(path.join(root, "large.txt"), "x".repeat(300_000))
			const delivery = await buildTaskDelivery(taskDir, root, await computeProjectSnapshot(root), [], "claim", 10)
			expect(delivery.diffOmittedPaths.sort()).toEqual(["credentials.json", "data.bin", "large.txt"])
			expect(delivery.files.every((file) => file.source === "other")).toBe(true)
			expect(await fs.readFile(delivery.diffPath!, "utf8")).not.toContain("sensitive")
		}))

	it("reports a missing baseline instead of claiming an empty diff", async () =>
		fixture(async (root, taskDir) => {
			const delivery = await buildTaskDelivery(taskDir, root, await computeProjectSnapshot(root), [], "claim", 10)
			expect(delivery.baselineFingerprint).toBeUndefined()
			expect(delivery.diffOmittedPaths).toHaveLength(1)
			expect(delivery.diffPath).toBeUndefined()
		}))

	it("does not capture content after cancellation", async () =>
		fixture(async (root, taskDir) => {
			const controller = new AbortController()
			controller.abort()
			await captureDeliveryBaseline(taskDir, root, await computeProjectSnapshot(root), true, controller.signal)
			await expect(fs.access(path.join(taskDir, "delivery-baseline.json"))).rejects.toMatchObject({
				code: "ENOENT",
			})
		}))
})
