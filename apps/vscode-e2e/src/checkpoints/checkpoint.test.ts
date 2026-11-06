import * as assert from "node:assert/strict"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createHash } from "node:crypto"
import * as vscode from "vscode"
import { NJUST_AIEventName, type ClineMessage, type NJUST_AIAPI, type WebviewMessage } from "@njust-ai/types"

type TestTask = {
	taskId: string
	instanceId: string
	clineMessages: ClineMessage[]
	isInitialized: boolean
	checkpointService?: {
		checkpointsDir: string
		getDiff(options: {
			from: string
		}): Promise<{ paths: { relative: string }; content: { before: string; after: string } }[]>
	}
	checkpointSave(force?: boolean): Promise<unknown>
	checkpointRestore(options: { ts: number; commitHash: string; mode: "preview" | "restore" }): Promise<void>
	waitForTaskLoopIdle(): Promise<void>
	handleWebviewAskResponse(response: "yesButtonClicked" | "noButtonClicked"): void
}
type TestProvider = {
	getCurrentTask(): TestTask | undefined
	messageRouter: { setWebviewMessageListener(webview: vscode.Webview): void }
}

async function waitFor(condition: () => boolean | Promise<boolean>, timeout = 30_000): Promise<void> {
	const deadline = Date.now() + timeout
	while (!(await condition())) {
		if (Date.now() >= deadline) throw new Error("Checkpoint Extension Host test timed out")
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
}

/** Explicit real-API entrypoint. Run in a fresh workspace/profile; retain all fixtures and evidence. */
export async function run(): Promise<void> {
	const output = process.env.NJUST_CHECKPOINT_E2E_OUTPUT!
	const apiKey = process.env.NJUST_CHECKPOINT_E2E_API_KEY!
	const baseUrl = process.env.NJUST_CHECKPOINT_E2E_BASE_URL!
	const model = process.env.NJUST_CHECKPOINT_E2E_MODEL!
	assert.ok(
		output && apiKey && baseUrl && model,
		"VS Code Volcengine configuration must be supplied by the local runner",
	)
	assert.equal(new URL(baseUrl).hostname, "ark.cn-beijing.volces.com")
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
	assert.ok(root)
	const extension = vscode.extensions.getExtension<NJUST_AIAPI>("JunjieChen-YuyaoJiang.njust-ai")
	assert.ok(extension)
	const api = extension.isActive ? extension.exports : await extension.activate()
	const provider = (api as NJUST_AIAPI & { sidebarProvider: TestProvider }).sidebarProvider
	assert.ok(provider)
	const messages: { taskId: string; message: ClineMessage }[] = []
	const completed = new Set<string>()
	const checks: string[] = []
	const onMessage = ({ taskId, message }: { taskId: string; message: ClineMessage }) => {
		messages.push({ taskId, message })
		if (
			message.type === "ask" &&
			!message.partial &&
			["tool", "completion_result", "command"].includes(message.ask ?? "")
		) {
			setTimeout(() => {
				const task = provider.getCurrentTask()
				if (task?.taskId === taskId)
					task.handleWebviewAskResponse(message.ask === "command" ? "noButtonClicked" : "yesButtonClicked")
			}, 100)
		}
	}
	const onCompleted = (id: string) => completed.add(id)
	api.on(NJUST_AIEventName.Message, onMessage)
	api.on(NJUST_AIEventName.TaskCompleted, onCompleted)
	let receive!: (message: WebviewMessage) => Promise<void>
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
	let failure: string | undefined
	try {
		for (const [name, content] of Object.entries({
			"checkpoint-main.ts": "export const value = 1\n",
			"文本.cj": "before\n",
			"cjpm.lock": "before\n",
			"migration.sql": "before\n",
			"data.csv": "before\n",
		})) {
			await fs.writeFile(path.join(root, name), content)
		}
		const taskId = await api.startNewTask({
			configuration: {
				apiProvider: "doubao",
				doubaoApiKey: apiKey,
				doubaoBaseUrl: baseUrl,
				apiModelId: model,
				mode: "code",
				enableCheckpoints: true,
				checkpointTimeout: 30,
				autoApprovalEnabled: true,
				alwaysAllowReadOnly: true,
				alwaysAllowWrite: true,
				alwaysAllowExecute: false,
			},
			text: "Edit the existing checkpoint-main.ts file: change export const value = 1 to export const value = 2. Use a file editing tool. Change only that file, do not execute commands or delegate tasks. This is a checkpoint smoke test and needs no build or tests. Finish after the edit.",
		})
		await waitFor(() => completed.has(taskId), 240_000)
		const task = provider.getCurrentTask()!
		await task.waitForTaskLoopIdle()
		assert.match(await fs.readFile(path.join(root, "checkpoint-main.ts"), "utf8"), /value = 2/)
		const checkpoint = task.clineMessages.find((message) => message.say === "checkpoint_saved" && message.text)
		assert.ok(checkpoint?.text, "The real model edit must have a checkpoint")
		checks.push("real-volcengine-agent-edit-with-checkpoint")
		assert.ok(task.checkpointService)
		const indexPath = path.join(task.checkpointService.checkpointsDir, ".git/index")
		const indexHash = async () =>
			createHash("sha256")
				.update(await fs.readFile(indexPath))
				.digest("hex")
		const indexBefore = await indexHash()
		// These are explicit harness changes for restore coverage, not independent Agent work.
		await fs.writeFile(path.join(root, "untracked-user-file.ts"), "retain me\n")
		for (const name of ["文本.cj", "cjpm.lock", "migration.sql", "data.csv"])
			await fs.writeFile(path.join(root, name), "after\n")
		const diff = await task.checkpointService.getDiff({ from: checkpoint.text })
		assert.equal(await indexHash(), indexBefore, "Viewing a diff must not change the restore index")
		assert.equal(diff.find((entry) => entry.paths.relative === "文本.cj")?.content.after, "after\n")
		assert.ok(diff.some((entry) => entry.paths.relative === "untracked-user-file.ts"))
		checks.push("unicode-and-untracked-diff-with-unchanged-index")
		await receive({
			type: "checkpointRestore",
			payload: { ts: checkpoint.ts, commitHash: checkpoint.text, mode: "preview" },
		})
		await waitFor(
			() =>
				provider.getCurrentTask()?.instanceId !== task.instanceId &&
				provider.getCurrentTask()?.isInitialized === true,
		)
		assert.match(await fs.readFile(path.join(root, "checkpoint-main.ts"), "utf8"), /value = 1/)
		for (const name of ["文本.cj", "cjpm.lock", "migration.sql", "data.csv"])
			assert.equal((await fs.readFile(path.join(root, name), "utf8")).trim(), "before")
		assert.equal(await fs.readFile(path.join(root, "untracked-user-file.ts"), "utf8"), "retain me\n")
		checks.push("restore-files-through-webview-router")
		const resumed = provider.getCurrentTask()!
		await fs.writeFile(path.join(root, "checkpoint-main.ts"), "export const value = 3\n")
		await receive({
			type: "checkpointRestore",
			payload: { ts: checkpoint.ts, commitHash: checkpoint.text, mode: "restore" },
		})
		await waitFor(
			() =>
				provider.getCurrentTask()?.instanceId !== resumed.instanceId &&
				provider.getCurrentTask()?.isInitialized === true,
		)
		assert.match(await fs.readFile(path.join(root, "checkpoint-main.ts"), "utf8"), /value = 1/)
		assert.ok(!provider.getCurrentTask()!.clineMessages.some((message) => message.say === "completion_result"))
		checks.push("restore-files-and-conversation-through-webview-router")
		const restored = provider.getCurrentTask()!
		await restored.checkpointSave(true)
		await waitFor(() => restored.clineMessages.some((message) => message.say === "checkpoint_saved"))
		const latest = restored.clineMessages.find((message) => message.say === "checkpoint_saved")
		assert.ok(latest)
		await assert.rejects(
			restored.checkpointRestore({
				ts: latest.ts,
				commitHash: "0000000000000000000000000000000000000000",
				mode: "preview",
			}),
		)
		checks.push("invalid-checkpoint-rejects-in-extension-host")
	} catch (error) {
		failure = error instanceof Error ? error.message : String(error)
		throw error
	} finally {
		api.off(NJUST_AIEventName.Message, onMessage)
		api.off(NJUST_AIEventName.TaskCompleted, onCompleted)
		await fs.mkdir(output, { recursive: true })
		await fs.writeFile(
			path.join(output, "report.json"),
			JSON.stringify(
				{
					provider: "volcengine",
					baseUrl,
					model,
					checks,
					failure,
					independentAgentEdits: checks.includes("real-volcengine-agent-edit-with-checkpoint") ? 1 : 0,
					harnessChanges: [
						"Unicode/lock/SQL/CSV restore fixtures",
						"untracked user file",
						"manual value = 3 before conversation restore",
					],
					messages,
				},
				null,
				2,
			).replaceAll(apiKey, "[REDACTED]"),
		)
		await api.cancelCurrentTask()
	}
}
