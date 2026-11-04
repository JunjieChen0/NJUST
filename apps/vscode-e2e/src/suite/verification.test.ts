import * as assert from "assert"
import * as fs from "fs/promises"
import * as path from "path"
import * as vscode from "vscode"
import {
	NJUST_AIEventName,
	type ClineMessage,
	type NJUST_AIAPI,
	type VerificationSummary,
	type WebviewMessage,
} from "@njust-ai/types"
import { waitFor } from "./utils"
import { verificationTestControl } from "./test-utils"

type CurrentTask = {
	taskId: string
	clineMessages: ClineMessage[]
	memrlIntent: string
	handleWebviewAskResponse(
		response: "yesButtonClicked" | "noButtonClicked" | "messageResponse",
		text?: string,
		images?: string[],
	): void
	persistMemrlEpisode(): Promise<void>
	waitForTaskLoopIdle(): Promise<void>
}
type TestProvider = {
	context: vscode.ExtensionContext
	getCurrentTask(): CurrentTask | undefined
	_memoryManager?: unknown
	messageRouter: { setWebviewMessageListener(webview: vscode.Webview): void }
}
type VerificationRecord = {
	runs: {
		kind: string
		status: string
		exitCode?: number
		abortReason?: string
		inputFingerprint?: string
		inputFingerprintAfter?: string
	}[]
	claims: { claimId: string }[]
	acceptances: { decision: string }[]
}

suite("Cangjie verification in Extension Host", function () {
	this.timeout(180_000)
	let provider: TestProvider
	let root: string
	let fixtureDir: string
	let api: NJUST_AIAPI
	let receive: (message: WebviewMessage) => Promise<void>
	let respond: (task: CurrentTask, message: ClineMessage) => void
	const completed = new Set<string>()
	const messages: { taskId: string; message: ClineMessage }[] = []
	const previousSettings = new Map<string, { value: unknown; target: vscode.ConfigurationTarget }>()
	const onCompleted = (id: string) => {
		completed.add(id)
	}
	const onMessage = ({ taskId, message }: { taskId: string; message: ClineMessage }) => {
		messages.push({ taskId, message })
		if (message.type === "ask" && message.ask === "command" && !message.partial) {
			const task = provider.getCurrentTask()
			if (task?.taskId === taskId) respond(task, message)
		}
	}
	const record = async (id: string): Promise<VerificationRecord> =>
		JSON.parse(
			await fs.readFile(
				path.join(provider.context.globalStorageUri.fsPath, "tasks", id, "verification.json"),
				"utf8",
			),
		)
	const delivery = (id: string): ClineMessage | undefined =>
		provider.getCurrentTask()?.taskId === id
			? [...provider.getCurrentTask()!.clineMessages]
					.reverse()
					.find((message) => message.verification?.claimId && !message.verification.terminal)
			: undefined
	const finish = async (id: string): Promise<VerificationSummary> => {
		await waitFor(() => completed.has(id), { timeout: 120_000 })
		const summary = delivery(id)?.verification
		assert.ok(summary, "completion must carry system evidence")
		return summary
	}
	const start = (modify = false) =>
		api.startNewTask({
			configuration: {
				mode: "cangjie",
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: true,
				alwaysAllowSubtasks: true,
				alwaysAllowExecute: false,
				enableCheckpoints: false,
			},
			text: `[cangjie-verification-e2e] ${modify ? "modify-feature: 修改已有仓颉工程，把 main 的返回值改成 42" : "只验证已有仓颉工程，运行构建和测试，不要修改代码。"}`,
		})

	suiteSetup(async function () {
		if (!process.env.MOCK_API_URL) this.skip()
		api = globalThis.api
		provider = (api as NJUST_AIAPI & { sidebarProvider: TestProvider }).sidebarProvider
		await api.clearCurrentTask()
		root = vscode.workspace.workspaceFolders![0]!.uri.fsPath
		fixtureDir = path.join(root, ".njust_ai", "verification-e2e")
		await fs.mkdir(fixtureDir, { recursive: true })
		await fs.copyFile(
			path.join(process.env.E2E_PACKAGE_ROOT!, "src/suite/fixtures/verification-cjpm.cjs"),
			path.join(fixtureDir, "cjpm.cjs"),
		)
		// The test runner supplies the real Node executable; Code.exe itself cannot run this fixture.
		const node = process.env.NODE_EXEC_PATH!
		const executable = path.join(fixtureDir, process.platform === "win32" ? "cjpm.cmd" : "cjpm")
		const script = path.join(fixtureDir, "cjpm.cjs")
		await fs.writeFile(
			executable,
			process.platform === "win32"
				? `@"${node}" "${script}" %*\r\n`
				: `#!/bin/sh\nexec '${node.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' "$@"\n`,
		)
		await fs.chmod(executable, 0o755)
		const config = vscode.workspace.getConfiguration("njust-ai")
		for (const [key, value] of Object.entries({
			"cangjieTools.cjpmPath": executable,
			"cangjieLsp.cjcPath": executable,
			"cangjieLsp.enabled": false,
			"sandbox.backend": "guarded-host",
		})) {
			const target = key.startsWith("sandbox.")
				? vscode.ConfigurationTarget.Global
				: vscode.ConfigurationTarget.Workspace
			const previous =
				target === vscode.ConfigurationTarget.Global
					? config.inspect(key)?.globalValue
					: config.inspect(key)?.workspaceValue
			await config.update(key, value, target)
			previousSettings.set(key, { value: previous, target })
		}
		// Feed the same validated router used by the webview, inside the real Extension Host.
		provider.messageRouter.setWebviewMessageListener({
			html: "",
			options: {},
			cspSource: "",
			asWebviewUri: (uri) => uri,
			postMessage: async () => true,
			onDidReceiveMessage: (listener) => {
				receive = async (message) => {
					await listener(message)
				}
				return new vscode.Disposable(() => {})
			},
		})
		verificationTestControl.manualApprovals = true
		api.on(NJUST_AIEventName.Message, onMessage)
		api.on(NJUST_AIEventName.TaskCompleted, onCompleted)
	})

	setup(async () => {
		await api.clearCurrentTask()
		messages.length = 0
		respond = (task) => task.handleWebviewAskResponse("yesButtonClicked")
		await fs.mkdir(path.join(root, "src"), { recursive: true })
		await fs.writeFile(
			path.join(root, "cjpm.toml"),
			'[package]\nname = "demo"\nversion = "1.0.0"\noutput-type = "executable"\n',
		)
		await fs.writeFile(path.join(root, "src/main.cj"), "package demo\n\nmain(): Int64 {\n    0\n}\n")
		await fs.writeFile(path.join(fixtureDir, "control.json"), JSON.stringify({ delayMs: 0 }))
		await fs.writeFile(path.join(fixtureDir, "commands.jsonl"), "")
	})
	teardown(async () => {
		await api.clearCurrentTask()
	})
	suiteTeardown(async () => {
		verificationTestControl.manualApprovals = false
		api?.off(NJUST_AIEventName.Message, onMessage)
		api?.off(NJUST_AIEventName.TaskCompleted, onCompleted)
		for (const [key, { value, target }] of previousSettings)
			await vscode.workspace.getConfiguration("njust-ai").update(key, value, target)
		// Archive the generated manifest so later generic suites do not inherit a Cangjie project.
		if (root && fixtureDir)
			await fs
				.rename(path.join(root, "cjpm.toml"), path.join(fixtureDir, `completed-${Date.now()}.toml`))
				.catch((error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT") throw error
				})
	})

	test("modifies an existing feature and delivers evidence after approving build and test", async () => {
		const approved: string[] = []
		respond = (task, message) => {
			approved.push(message.text!)
			task.handleWebviewAskResponse("yesButtonClicked")
		}
		const id = await start(true)
		const summary = await finish(id)
		assert.strictEqual(summary.overall, "verified")
		assert.strictEqual(summary.test.executed, 1)
		assert.ok(approved.includes("cjpm build") && approved.includes("cjpm test"))
		assert.match(await fs.readFile(path.join(root, "src/main.cj"), "utf8"), /42/)
		const facts = await record(id)
		assert.ok(facts.runs.filter((run) => run.status === "passed").length >= 2)
		for (const run of facts.runs.filter((run) => run.status === "passed")) {
			assert.strictEqual(run.exitCode, 0)
			assert.strictEqual(run.inputFingerprint, run.inputFingerprintAfter)
		}
	})

	test("refusing verification delivers an unverified summary and never writes source in check-only mode", async () => {
		respond = (task) => task.handleWebviewAskResponse("noButtonClicked")
		const source = await fs.readFile(path.join(root, "src/main.cj"), "utf8")
		const id = await start()
		const summary = await finish(id)
		assert.strictEqual(summary.build.state, "blocked")
		assert.notStrictEqual(summary.overall, "verified")
		assert.strictEqual((await record(id)).runs.at(-1)?.abortReason, "not_approved")
		assert.strictEqual(await fs.readFile(path.join(fixtureDir, "commands.jsonl"), "utf8"), "")
		assert.strictEqual(await fs.readFile(path.join(root, "src/main.cj"), "utf8"), source)
	})

	test("approval feedback reaches the model without recording a delivery", async () => {
		respond = (task) => task.handleWebviewAskResponse("messageResponse", "先修复边界问题，不要结束")
		const id = await start()
		await waitFor(
			() =>
				messages.some(
					(entry) =>
						entry.taskId === id &&
						entry.message.ask === "followup" &&
						entry.message.text?.includes("已收到：先修复边界问题"),
				),
			{ timeout: 120_000 },
		)
		assert.ok(!completed.has(id))
		assert.strictEqual(delivery(id), undefined)
		const taskFile = path.join(provider.context.globalStorageUri.fsPath, "tasks", id, "verification.json")
		const facts: VerificationRecord | undefined = await fs.readFile(taskFile, "utf8").then(
			(text) => JSON.parse(text),
			(error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error
				return undefined
			},
		)
		assert.strictEqual(facts?.claims.length ?? 0, 0)
	})

	test("an external input edit makes the delivered card stale", async () => {
		const id = await start()
		assert.strictEqual((await finish(id)).overall, "verified")
		await fs.appendFile(path.join(root, "src/main.cj"), "\n// external edit\n")
		await waitFor(() => delivery(id)?.verification?.build.state === "stale", { timeout: 30_000 })
		assert.strictEqual(delivery(id)?.verification?.acceptance, "pending")
		assert.notStrictEqual(delivery(id)?.verification?.overall, "verified")
	})

	test("restoring cjpm automatically refreshes the delivered card", async () => {
		const id = await start()
		assert.strictEqual((await finish(id)).overall, "verified")
		const config = vscode.workspace.getConfiguration("njust-ai")
		const original = config.get<string>("cangjieTools.cjpmPath")!
		const runs = (await record(id)).runs
		try {
			await config.update("cangjieTools.cjpmPath", `${original}.missing`, vscode.ConfigurationTarget.Workspace)
			await waitFor(() => delivery(id)?.verification?.overall === "incomplete", { timeout: 30_000 })
			await config.update("cangjieTools.cjpmPath", original, vscode.ConfigurationTarget.Workspace)
			await waitFor(() => delivery(id)?.verification?.overall === "verified", { timeout: 30_000 })
			assert.deepStrictEqual((await record(id)).runs, runs)
		} finally {
			await config.update("cangjieTools.cjpmPath", original, vscode.ConfigurationTarget.Workspace)
		}
	})

	test("cancelling an active verification preserves cancelled facts and existing source", async () => {
		await fs.writeFile(path.join(fixtureDir, "control.json"), JSON.stringify({ delayMs: 30_000 }))
		const id = await start()
		await waitFor(
			async () => (await fs.readFile(path.join(fixtureDir, "commands.jsonl"), "utf8")).includes('"build"'),
			{ timeout: 120_000 },
		)
		await api.cancelCurrentTask()
		await waitFor(async () => (await record(id)).runs.some((run) => run.status === "cancelled"))
		assert.ok(!completed.has(id))
		assert.ok(
			provider.getCurrentTask()?.clineMessages.some((message) => message.verification?.terminal === "cancelled"),
		)
		assert.match(await fs.readFile(path.join(root, "src/main.cj"), "utf8"), /main/)
	})

	test("history acceptance initializes cold memory and preserves intent, vector, summary and Q", async () => {
		const id = await start()
		await finish(id)
		const completedTask = provider.getCurrentTask()!
		await api.clearCurrentTask()
		// The loop's finally block can enqueue memory writes after the completion event.
		await completedTask.waitForTaskLoopIdle()
		await completedTask.persistMemrlEpisode()
		const memoryPath = path.join(root, ".njust_ai/memories/episodic.json")
		const entry = {
			id: "original",
			taskId: id,
			intent: "Original feature request",
			embedding: [0.2, 0.5],
			stmSummary: "Original summary",
			qValue: 0.8,
			updateCount: 2,
			createdAt: 1,
			updatedAt: 2,
			verification: { overall: "verified", acceptance: "pending" },
		}
		await fs.mkdir(path.dirname(memoryPath), { recursive: true })
		await fs.writeFile(
			memoryPath,
			JSON.stringify({ entries: [entry], totalWrites: 5, embedFingerprint: "fixture" }),
		)
		provider._memoryManager = undefined
		await api.resumeTask(id)
		await waitFor(
			() =>
				provider.getCurrentTask()?.taskId === id &&
				provider
					.getCurrentTask()
					?.clineMessages.some(
						(message) => message.ask === "resume_completed_task" || message.ask === "resume_task",
					) === true,
		)
		assert.strictEqual(provider.getCurrentTask()!.memrlIntent, "")
		const card = delivery(id)!
		await receive({
			type: "verificationDecision",
			verificationDecision: { ts: card.ts, claimId: card.verification!.claimId, decision: "accepted" },
		})
		const stored = JSON.parse(await fs.readFile(memoryPath, "utf8"))
		assert.deepStrictEqual(stored.entries, [
			{
				...entry,
				updatedAt: stored.entries[0].updatedAt,
				verification: { ...entry.verification, acceptance: "accepted" },
			},
		])
		assert.strictEqual(stored.totalWrites, 5)
		assert.strictEqual((await record(id)).acceptances.at(-1)?.decision, "accepted")
		await api.clearCurrentTask()
		assert.strictEqual(
			JSON.parse(await fs.readFile(memoryPath, "utf8")).entries[0].verification.acceptance,
			"accepted",
		)
	})
})
