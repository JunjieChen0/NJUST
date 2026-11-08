import { afterEach, expect, it, vi } from "vitest"
import * as fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { prepareWindowsTestEnvironment } from "../../../apps/vscode-e2e/src/cangjie-eval/windowsTestEnvironment"
import { CANGJIE_TASK_SUITE } from "../../../packages/evals/src/cangjie/suite"

vi.mock("node:fs/promises", async (original) => ({ ...(await original<typeof fs>()) }))
const platform = process.platform
afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
	Object.defineProperty(process, "platform", { value: platform })
})

it("publishes a complete Windows environment request before the helper can scan it", async () => {
	Object.defineProperty(process, "platform", { value: "win32" })
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "environment-atomic-"))
	const queue = path.join(root, "queue")
	vi.stubEnv("NJUST_CANGJIE_EVAL_FIREWALL_QUEUE", queue)
	const actual = await vi.importActual<typeof fs>("node:fs/promises")
	vi.spyOn(fs, "writeFile").mockImplementation(async (file, data, options) => {
		await actual.writeFile(file, String(data).slice(0, 10), options)
		expect((await actual.readdir(queue)).filter((name) => name.endsWith(".json"))).toEqual([])
		await actual.writeFile(file, data)
	})
	vi.spyOn(fs, "readFile").mockImplementation(async (file) => {
		const request = JSON.parse(await actual.readFile(String(file).replace(/\.ack$/, ""), "utf8"))
		return JSON.stringify({
			rules: request.programs.map((program: string) => ({
				program,
				protocol: "TCP",
				remoteAddress: "127.0.0.1",
			})),
		})
	})
	await expect(prepareWindowsTestEnvironment(root, CANGJIE_TASK_SUITE)).resolves.toMatchObject({
		policy: "loopback-tcp-exact-program",
	})
})
