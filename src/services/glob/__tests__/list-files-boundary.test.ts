import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { getBinPath } from "../../ripgrep"
import { listFiles } from "../list-files"

vi.mock("../../ripgrep", () => ({ getBinPath: vi.fn() }))

it("lists source files inside an ignored ancestor while excluding generated children", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "list-files-boundary-"))
	const workspace = path.join(root, "bin", "project")
	await fs.mkdir(path.join(workspace, "src"), { recursive: true })
	await fs.mkdir(path.join(workspace, "node_modules"), { recursive: true })
	await fs.writeFile(path.join(workspace, "src", "main.cj"), "main() {}")
	await fs.writeFile(path.join(workspace, "node_modules", "generated.js"), "generated")
	await promisify(execFile)("git", ["init", "--quiet"], { cwd: workspace })
	const actual = await vi.importActual<typeof import("../../ripgrep")>("../../ripgrep")
	const rg = await actual.getBinPath(path.resolve(__dirname, "../../../../apps/cli"))
	expect(rg).toBeDefined()
	vi.mocked(getBinPath).mockResolvedValue(rg)
	try {
		const [files] = await listFiles(workspace, true, 100)
		expect(files).toContain(path.join(workspace, "src", "main.cj"))
		expect(files.some((file) => file.includes("node_modules"))).toBe(false)
	} finally {
		await fs.rm(root, { recursive: true, force: true })
	}
})
