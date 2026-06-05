import * as path from "path"
import Mocha from "mocha"
import { glob } from "glob"
import * as vscode from "vscode"

import { NJUST_AIEventName, type NJUST_AIAPI, type UnsafeAny } from "@njust-ai/types"

import { waitFor } from "./utils"

type TestApiWithCurrentTask = NJUST_AIAPI & {
	sidebarProvider?: {
		getCurrentTask?: () => { approveAsk?: () => void } | undefined
	}
}

const approveCurrentTaskAsk = (api: NJUST_AIAPI): boolean => {
	const currentTask = (api as TestApiWithCurrentTask).sidebarProvider?.getCurrentTask?.()

	if (currentTask?.approveAsk) {
		currentTask.approveAsk()
		return true
	}

	return false
}

const approveMockAskWithRetry = async (api: NJUST_AIAPI) => {
	for (let attempt = 0; attempt < 10; attempt++) {
		if (approveCurrentTaskAsk(api)) {
			return
		}
		await new Promise((resolve) => setTimeout(resolve, 200))
	}

	console.warn("Skipped mock auto-approval because no current task was available")
}

export async function run() {
	const extension = vscode.extensions.getExtension<NJUST_AIAPI>("JunjieChen-YuyaoJiang.njust-ai")

	if (!extension) {
		throw new Error("Extension not found")
	}

	const api = extension.isActive ? extension.exports : await extension.activate()

	if (process.env.MOCK_API_URL) {
		const mockConfig = {
			apiProvider: "openai" as const,
			openAiBaseUrl: `${process.env.MOCK_API_URL}/v1`,
			openAiApiKey: "mock-key",
			openAiModelId: "mock-model",
			openAiStreamingEnabled: true,
			autoApprovalEnabled: true,
			alwaysAllowSubtasks: true,
		}
		await api.setConfiguration(mockConfig)

		// Verify mock server is reachable before proceeding.
		try {
			const healthRes = await fetch(`${process.env.MOCK_API_URL}/health`)
			if (!healthRes.ok) {
				console.warn(`Mock API health check returned ${healthRes.status}`)
			}
		} catch (err) {
			console.error(`Mock API health check failed: ${err instanceof Error ? err.message : String(err)}`)
		}

		// Verify that the provider configuration (including secret keys) was persisted.
		// getConfiguration() strips secrets, so we access the internal contextProxy.
		const internalConfig = (api as UnsafeAny).sidebarProvider?.contextProxy?.getValues?.()
		if (!internalConfig?.openAiApiKey) {
			console.error(
				"[e2e setup] CRITICAL: openAiApiKey is missing after setConfiguration. " +
					`apiProvider=${internalConfig?.apiProvider}, ` +
					`openAiBaseUrl=${internalConfig?.openAiBaseUrl}, ` +
					`openAiModelId=${internalConfig?.openAiModelId}. ` +
					"Attempting direct secret store as fallback...",
			)
			// Fallback: directly call storeSecret to ensure the key is in the cache.
			const contextProxy = (api as UnsafeAny).sidebarProvider?.contextProxy
			if (contextProxy?.storeSecret) {
				await contextProxy.storeSecret("openAiApiKey", "mock-key")
				// Verify the fallback worked.
				const retryConfig = contextProxy.getValues?.()
				if (retryConfig?.openAiApiKey) {
					console.log("[e2e setup] Fallback storeSecret succeeded - openAiApiKey is now present.")
				} else {
					console.error("[e2e setup] Fallback storeSecret also failed. Tests will likely fail.")
				}
			}
		}
	} else {
		await api.setConfiguration({
			apiProvider: "openrouter" as const,
			openRouterApiKey: process.env.OPENROUTER_API_KEY!,
			openRouterModelId: "openai/gpt-4.1",
		})
	}

	await vscode.commands.executeCommand("njust-ai.SidebarProvider.focus")
	await waitFor(() => api.isReady())

	globalThis.api = api

	if (process.env.MOCK_API_URL) {
		api.on(NJUST_AIEventName.Message, ({ message }) => {
			const shouldApproveNewTask =
				message.type === "ask" &&
				message.ask === "tool" &&
				typeof message.text === "string" &&
				(() => {
					try {
						return JSON.parse(message.text).tool === "newTask"
					} catch {
						return false
					}
				})()

			if (message.type === "ask" && message.ask === "completion_result") {
				if (!approveCurrentTaskAsk(api)) {
					void approveMockAskWithRetry(api).catch((error) => {
						console.error("Failed to auto-approve mock completion:", error)
					})
				}
			}
			if (shouldApproveNewTask) {
				void approveMockAskWithRetry(api).catch((error) => {
					console.error("Failed to auto-approve mock new_task:", error)
				})
			}
			if (message.type === "ask" && message.ask === "use_mcp_server") {
				void approveMockAskWithRetry(api).catch((error) => {
					console.error("Failed to auto-approve mock use_mcp_server:", error)
				})
			}
			if (message.type === "ask" && message.ask === "command") {
				void approveMockAskWithRetry(api).catch((error) => {
					console.error("Failed to auto-approve mock command:", error)
				})
			}
		})
	}

	const mochaOptions: Mocha.MochaOptions = {
		ui: "tdd",
		timeout: 20 * 60 * 1_000, // 20m
	}

	if (process.env.TEST_GREP) {
		mochaOptions.grep = process.env.TEST_GREP
		console.log(`Running tests matching pattern: ${process.env.TEST_GREP}`)
	}

	const mocha = new Mocha(mochaOptions)
	const cwd = path.resolve(__dirname, "..")

	let testFiles: string[]

	if (process.env.TEST_FILE) {
		const specificFile = process.env.TEST_FILE.endsWith(".js")
			? process.env.TEST_FILE
			: `${process.env.TEST_FILE}.js`

		testFiles = await glob(`**/${specificFile}`, { cwd })
		console.log(`Running specific test file: ${specificFile}`)
	} else {
		testFiles = await glob("**/**.test.js", { cwd })
	}

	// Only tests listed below are compatible with the mock API server.
	// Excluded tests:
	//   - task, modes, markdown-lists: assert real LLM output quality, not tool invocation
	if (process.env.MOCK_API_URL && !process.env.TEST_FILE) {
		const mockSupportedTests = new Set([
			"extension.test.js",
			"subtasks.test.js",
			"tools/apply-diff.test.js",
			"tools/execute-command.test.js",
			"tools/list-files.test.js",
			"tools/read-file.test.js",
			"tools/search-files.test.js",
			"tools/use-mcp-tool.test.js",
			"tools/write-to-file.test.js",
		])
		testFiles = testFiles.filter((testFile) =>
			mockSupportedTests.has(testFile.replace(/\\/g, "/").replace(/^suite\//, "")),
		)
	}

	if (testFiles.length === 0) {
		throw new Error(`No test files found matching criteria: ${process.env.TEST_FILE || "all tests"}`)
	}

	testFiles.forEach((testFile) => mocha.addFile(path.resolve(cwd, testFile)))

	return new Promise<void>((resolve, reject) =>
		mocha.run((failures) => (failures === 0 ? resolve() : reject(new Error(`${failures} tests failed.`)))),
	)
}
