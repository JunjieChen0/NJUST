import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { CangjieTaskSuite } from "../../../../packages/evals/src/cangjie/suite.js"

/** The elevated local helper only authorizes these exact generated runners on loopback TCP. */
export async function prepareWindowsTestEnvironment(root: string, suite: CangjieTaskSuite) {
	const queue = process.env.NJUST_CANGJIE_EVAL_FIREWALL_QUEUE
	if (process.platform !== "win32" || !queue) return { policy: "unconfigured", intervention: undefined }
	const programs = new Set<string>()
	const add = (project: string) => programs.add(path.join(project, "target/release/unittest_bin/std.testrunner.exe"))
	const selected = process.env.NJUST_CANGJIE_EVAL_CASES?.split(",")
	for (const task of suite.cases) {
		const scopes = task.testProjects ?? (task.project === "orders" ? [".", "libs/pricing"] : ["."])
		add(path.join(root, "sdk-check", task.project))
		if (selected && !selected.includes(task.id)) continue
		for (const variant of task.variants ? Object.keys(task.variants) : [undefined]) {
			const label = `${task.id}${variant ? `-${variant}` : ""}`
			for (const scope of scopes) {
				add(path.join(root, "workspaces", label, scope))
				if (task.category === "feature" || task.category === "repair")
					add(path.join(root, label, "oracle-project", scope))
			}
		}
	}
	await fs.mkdir(queue, { recursive: true })
	const request = path.join(queue, `${path.basename(root)}.json`)
	await fs.writeFile(request, JSON.stringify({ runRoot: root, programs: [...programs] }, null, 2))
	const deadline = Date.now() + 60_000
	while (Date.now() < deadline) {
		const response = await fs.readFile(`${request}.ack`, "utf8").then(
			(text) => JSON.parse(text.replace(/^\uFEFF/, "")),
			(error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? undefined : Promise.reject(error)),
		)
		if (response) {
			const authorized = new Set<string>(
				Array.isArray(response.rules)
					? response.rules
							.filter(
								(rule: { program?: string; protocol?: string; remoteAddress?: string }) =>
									typeof rule.program === "string" &&
									rule.protocol === "TCP" &&
									rule.remoteAddress === "127.0.0.1",
							)
							.map((rule: { program: string }) => path.normalize(rule.program).toLowerCase())
					: [],
			)
			if (
				response.error ||
				authorized.size !== programs.size ||
				![...programs].every((program) => authorized.has(path.normalize(program).toLowerCase()))
			)
				throw new Error(`Test communication setup failed: ${response.error ?? "incomplete rules"}`)
			return { policy: "loopback-tcp-exact-program", intervention: response }
		}
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	throw new Error("Test communication setup is not ready; start the reviewed elevated helper before evaluation")
}
