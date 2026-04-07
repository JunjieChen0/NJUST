import path from "path"

import { type ClineSayTool } from "@njust-ai-cj/types"

import { Task } from "../task/Task"
import { getReadablePath } from "../../utils/path"
import { ignoreAbortError } from "../../utils/errorHandling"
import { isPathUnderBundledCangjieCorpus, isPathPotentiallyUnderCangjieCorpus } from "../../utils/bundledCangjieCorpus"
import { isPathOutsideWorkspace } from "../../utils/pathUtils"
import { regexSearchFiles } from "../../services/ripgrep"
import type { ToolUse } from "../../shared/tools"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface SearchFilesParams {
	path: string
	regex: string
	file_pattern?: string | null
}

export class SearchFilesTool extends BaseTool<"search_files"> {
	readonly name = "search_files" as const

	async execute(params: SearchFilesParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks

		const relDirPath = params.path
		const regex = params.regex
		const filePattern = params.file_pattern || undefined

		if (!relDirPath) {
			task.consecutiveMistakeCount++
			task.recordToolError("search_files")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("search_files", "path"))
			return
		}

		if (!regex) {
			task.consecutiveMistakeCount++
			task.recordToolError("search_files")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("search_files", "regex"))
			return
		}

		task.consecutiveMistakeCount = 0

		const absolutePath = path.resolve(task.cwd, relDirPath)
		const extensionPath = task.providerRef.deref()?.context.extensionPath
		// Only suppress the "search outside workspace" UI for extension-bundled CangjieCorpus; all other rules unchanged.
		const isOutsideWorkspace =
			isPathOutsideWorkspace(absolutePath) && !isPathUnderBundledCangjieCorpus(absolutePath, extensionPath)

		const sharedMessageProps: ClineSayTool = {
			tool: "searchFiles",
			path: getReadablePath(task.cwd, relDirPath),
			regex: regex,
			filePattern: filePattern,
			isOutsideWorkspace,
		}

		try {
			const results = await regexSearchFiles(task.cwd, absolutePath, regex, filePattern, task.rooIgnoreController)
			const isUnderCangjieCorpus = isPathUnderBundledCangjieCorpus(absolutePath, extensionPath)

			if (isUnderCangjieCorpus) {
				// 静默执行：不向UI面板发送交互日志，直接将结果丢给大模型
				pushToolResult(results)
				return
			}

			const completeMessage = JSON.stringify({ ...sharedMessageProps, content: results } satisfies ClineSayTool)
			const didApprove = await askApproval("tool", completeMessage)

			if (!didApprove) {
				return
			}

			pushToolResult(results)
		} catch (error) {
			await handleError("searching files", error as Error)
		}
	}

	override async handlePartial(task: Task, block: ToolUse<"search_files">): Promise<void> {
		const relDirPath = block.params.path
		const regex = block.params.regex
		const filePattern = block.params.file_pattern

		const absolutePath = relDirPath ? path.resolve(task.cwd, relDirPath) : task.cwd
		const extensionPath = task.providerRef.deref()?.context.extensionPath
		const isOutsideWorkspace =
			isPathOutsideWorkspace(absolutePath) && !isPathUnderBundledCangjieCorpus(absolutePath, extensionPath)

		const sharedMessageProps: ClineSayTool = {
			tool: "searchFiles",
			path: getReadablePath(task.cwd, relDirPath ?? ""),
			regex: regex ?? "",
			filePattern: filePattern ?? "",
			isOutsideWorkspace,
		}

		if (isPathPotentiallyUnderCangjieCorpus(absolutePath, extensionPath, relDirPath)) {
			return
		}

		const partialMessage = JSON.stringify({ ...sharedMessageProps, content: "" } satisfies ClineSayTool)
		await task.ask("tool", partialMessage, block.partial).catch(ignoreAbortError)
	}
}

export const searchFilesTool = new SearchFilesTool()
