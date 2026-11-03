import { describe, it, expect } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { resolvePreflightProject, cangjiePreflightCheck } from "../cangjiePreflightCheck"

describe("local dependency package preflight", () => {
	it("checks the target package instead of the application's root package", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "cj-preflight-"))
		try {
			await fs.writeFile(path.join(root, "cjpm.toml"), '[package]\nname = "orders"\n')
			await fs.mkdir(path.join(root, "libs/pricing/src"), { recursive: true })
			await fs.writeFile(path.join(root, "libs/pricing/cjpm.toml"), '[package]\nname = "pricing"\n')
			const project = await resolvePreflightProject(root, "libs/pricing/src/price.cj")
			expect(project.rootPackageName).toBe("pricing")
			expect(
				cangjiePreflightCheck("package pricing\n", project.path, project.cwd, project.rootPackageName).pass,
			).toBe(true)
			expect(
				cangjiePreflightCheck("package orders\n", project.path, project.cwd, project.rootPackageName).pass,
			).toBe(false)
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})
})
