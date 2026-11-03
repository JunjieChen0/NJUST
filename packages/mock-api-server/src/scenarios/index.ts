export type MockProvider = "openai" | "anthropic"

export type MockToolCall = {
	id: string
	name: string
	arguments: Record<string, unknown>
}

export type MockScenarioResponse =
	| {
			type: "text"
			text: string
	  }
	| {
			type: "tool_calls"
			toolCalls: MockToolCall[]
	  }
	| {
			type: "error"
			status: number
			message: string
	  }

export type MockScenarioContext = {
	provider: MockProvider
	body: Record<string, unknown>
}

export type MockScenario = {
	name: string
	resolve: (context: MockScenarioContext) => MockScenarioResponse
}

const hasToolResult = (body: Record<string, unknown>): boolean => {
	const messages = Array.isArray(body.messages) ? body.messages : []
	return messages.some((message) => {
		if (!message || typeof message !== "object") return false
		const role = "role" in message ? message.role : undefined
		if (role === "tool") return true
		if ("tool_call_id" in message) return true
		const content = "content" in message ? message.content : undefined
		return Array.isArray(content)
			? content.some(
					(block) => block && typeof block === "object" && "type" in block && block.type === "tool_result",
				)
			: typeof content === "string" && /\b(Result:|\[.*? for ['"])/.test(content)
	})
}

const getToolResultText = (body: Record<string, unknown>): string => {
	const messages = Array.isArray(body.messages) ? body.messages : []
	for (const message of [...messages].reverse()) {
		if (!message || typeof message !== "object") continue
		const role = "role" in message ? message.role : undefined
		const content = "content" in message ? message.content : undefined
		if (role === "tool" && typeof content === "string") return content
		if (Array.isArray(content)) {
			const toolResult = content.find(
				(block) => block && typeof block === "object" && "type" in block && block.type === "tool_result",
			)
			if (toolResult && typeof toolResult === "object" && "content" in toolResult) {
				return String(toolResult.content)
			}
		}
		if (typeof content === "string" && /\b(Result:|\[.*? for ['"])/.test(content)) return content
	}
	return "The requested tool completed successfully."
}

const completionResponse = (result: string): MockScenarioResponse => ({
	type: "tool_calls",
	toolCalls: [
		{
			id: "call_attempt_completion",
			name: "attempt_completion",
			arguments: { result },
		},
	],
})

const completionScenario = (name: string, result: string): MockScenario => ({
	name,
	resolve: () => completionResponse(result),
})

const toolCompletionResult = (toolName: string): string => {
	switch (toolName) {
		case "switch_mode":
			return "The requested mode switch completed successfully."
		case "list_files":
			return "The requested files and directories were listed successfully."
		case "read_file":
			return "The requested file was read successfully."
		case "write_to_file":
			return "The requested file was written successfully."
		case "search_files":
			return "The requested search completed successfully."
		case "execute_command":
			return "The requested command executed successfully."
		case "apply_patch":
			return "The requested diff was applied successfully."
		case "new_task":
			return "The subtask was created successfully."
		default:
			return `Mock ${toolName} result processed.`
	}
}

const hasAttemptCompletionResult = (body: Record<string, unknown>): boolean => {
	const messages = Array.isArray(body.messages) ? body.messages : []
	return messages.some((message) => {
		if (!message || typeof message !== "object") return false
		const role = "role" in message ? message.role : undefined
		const content = "content" in message ? message.content : undefined
		return (
			role === "tool" &&
			"tool_call_id" in message &&
			message.tool_call_id === "call_attempt_completion" &&
			typeof content === "string"
		)
	})
}

const getMessageText = (message: unknown): string => {
	if (!message || typeof message !== "object") return ""
	const content = "content" in message ? message.content : undefined
	if (typeof content === "string") return content
	if (!Array.isArray(content)) return ""
	return content
		.map((block) =>
			block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block
				? String(block.text)
				: "",
		)
		.join(" ")
}

const getLastUserText = (body: Record<string, unknown>): string => {
	const messages = Array.isArray(body.messages) ? body.messages : []
	return (
		messages
			.filter((message) => message && typeof message === "object" && "role" in message && message.role === "user")
			.map(getMessageText)
			.at(-1) ?? ""
	)
}

const firstQuoted = (text: string): string | undefined => text.match(/"([^"]+)"/)?.[1]

const quotedAfter = (text: string, label: string): string | undefined => {
	const match = text.match(new RegExp(`${label}\\s+(['"])(.*?)\\1`, "i"))
	return match?.[2]
}

const lineAfter = (text: string, marker: string): string | undefined => {
	const index = text.toLowerCase().indexOf(marker.toLowerCase())
	if (index < 0) return undefined
	return text
		.slice(index + marker.length)
		.trimStart()
		.split(/\r?\n/)[0]
		?.trim()
}

const extractListFilesArgs = (text: string): Record<string, unknown> => ({
	path: text.match(/directory\s+"([^"]+)"/i)?.[1] ?? text.match(/at\s+"([^"]+)"/i)?.[1] ?? firstQuoted(text) ?? ".",
	recursive: !/non-recursive|not recursive/i.test(text) && /recursive|all contents|subdirectories/i.test(text),
})

const extractReadFileArgs = (text: string): Record<string, unknown> => ({
	path: firstQuoted(text) ?? "src/app.ts",
	...(text.includes("offset=2") ? { offset: 2, limit: 3 } : {}),
})

const extractWriteFileArgs = (text: string): Record<string, unknown> => {
	const filename = text.match(/file named\s+"([^"]+)"/i)?.[1] ?? firstQuoted(text) ?? "mock-output.txt"
	const nested = text.match(/nested directory structure\s+"([^"]+)"/i)?.[1]
	const content =
		lineAfter(text, "following content:") ??
		(text.includes("File in nested directory") ? "File in nested directory" : "Generated by mock API server.")
	return {
		path: nested ? `${nested.replace(/[\\/]+$/, "")}/${filename}` : filename,
		content,
	}
}

const extractSearchFilesArgs = (text: string): Record<string, unknown> => ({
	path: ".",
	regex: quotedAfter(text, "regex pattern") ?? quotedAfter(text, "pattern") ?? "TODO.*",
	file_pattern: quotedAfter(text, "file pattern"),
})

const extractExecuteCommandArgs = (text: string): Record<string, unknown> => {
	const command =
		lineAfter(text, "run this command:") ??
		lineAfter(text, "command:") ??
		text.match(/run:\s*([^\n]+)/i)?.[1]?.trim() ??
		"echo mock"
	const cwd = text.match(/cwd:\s*([^\n]+)/i)?.[1]?.trim()
	return { command, ...(cwd ? { cwd } : {}) }
}

const makePatch = (path: string, changes: Array<{ search: string; replace: string }>): string =>
	[
		"*** Begin Patch",
		`*** Update File: ${path}`,
		...changes.flatMap(({ search, replace }) => [
			"@@",
			...search.split("\n").map((line) => `-${line}`),
			...replace.split("\n").map((line) => `+${line}`),
		]),
		"*** End Patch",
	].join("\n")

const extractApplyPatchArgs = (text: string): Record<string, unknown> => {
	const path = text.match(/file\s+([^\s"]+\.[\w]+)/i)?.[1] ?? firstQuoted(text) ?? "src/app.ts"
	if (text.includes("This content does not exist")) {
		return { patch: makePatch(path, [{ search: "This content does not exist", replace: "New content" }]) }
	}
	if (text.includes("processData") && text.includes("validateInput")) {
		return {
			patch: makePatch(path, [
				{
					search: `function processData(data) {\n\tconsole.log("Processing data")\n\treturn data.map(item => item * 2)\n}`,
					replace: `function transformData(data) {\n\tconsole.log("Transforming data")\n\treturn data.map(item => item * 2)\n}`,
				},
				{
					search: `function validateInput(input) {\n\tconsole.log("Validating input")\n\tif (!input) {\n\t\tthrow new Error("Invalid input")\n\t}\n\treturn true\n}`,
					replace: `function checkInput(input) {\n\tconsole.log("Checking input")\n\tif (!input) {\n\t\tthrow new Error("Invalid input")\n\t}\n\treturn true\n}`,
				},
			]),
		}
	}
	if (text.includes("calculate") && text.includes("compute")) {
		return {
			patch: makePatch(path, [
				{
					search: `function calculate(x, y) {\n\tconst sum = x + y\n\tconst product = x * y\n\treturn { sum: sum, product: product }\n}`,
					replace: `function compute(a, b) {\n\tconst total = a + b\n\tconst result = a * b\n\treturn { total: total, result: result }\n}`,
				},
			]),
		}
	}
	if (text.includes("oldFunction")) {
		return {
			patch: makePatch(path, [
				{
					search: `function oldFunction() {\n\tconsole.log("Old implementation")\n}`,
					replace: `function newFunction() {\n\tconsole.log("New implementation")\n}`,
				},
			]),
		}
	}
	return { patch: makePatch(path, [{ search: "Hello World", replace: "Hello Universe" }]) }
}

const extractNewTaskArgs = (text: string): Record<string, unknown> => ({
	mode: "ask",
	message:
		text.match(/message '([^']+)'/i)?.[1] ??
		"You are a calculator. Respond only with numbers. What is the square root of 9?",
})

const extractUseMcpToolArgs = (text: string): Record<string, unknown> => {
	const lower = text.toLowerCase()
	const serverName = lower.includes("nonexistent-server") ? "nonexistent-server" : "filesystem"
	let toolName = "read_file"
	if (lower.includes("write_file")) toolName = "write_file"
	else if (lower.includes("list_directory")) toolName = "list_directory"
	else if (lower.includes("directory_tree")) toolName = "directory_tree"
	else if (lower.includes("get_file_info")) toolName = "get_file_info"
	else if (lower.includes("fail_tool") || lower.includes("trigger an error")) toolName = "fail_tool"

	const args: Record<string, unknown> = {}
	const quoted = firstQuoted(text)
	if (toolName === "read_file" || toolName === "get_file_info") {
		args.path = quoted ?? "mcp-test.txt"
	}
	if (toolName === "write_file") {
		args.path = quoted ?? "mcp-write-test.txt"
		args.content = text.match(/content\s+"([^"]+)"/i)?.[1] ?? "Hello from MCP!"
	}
	if (toolName === "list_directory" || toolName === "directory_tree") {
		args.path = "."
	}

	return {
		server_name: serverName,
		tool_name: toolName,
		arguments: args,
	}
}

const textOnlyResult = (text: string): string => {
	if (/square root of 9/i.test(text)) return "3"
	if (/what is your name/i.test(text)) return "My name is Njust-AI"
	if (/unordered list/i.test(text)) return "- Apple\n- Banana\n- Orange"
	if (/numbered list|three steps/i.test(text)) return "1. First step\n2. Second step\n3. Third step"
	if (/nested list/i.test(text)) return "- Main item\n  - Sub-item A\n  - Sub-item B"
	if (/both numbered items and bullet points|mixed ordered and unordered/i.test(text)) {
		return "1. First ordered item\n   - First bullet point\n2. Second ordered item\n   - Second bullet point"
	}
	return "Mock assistant response."
}

const toolScenario = (
	name: string,
	toolName: string,
	args: Record<string, unknown> | ((text: string) => Record<string, unknown>),
): MockScenario => ({
	name,
	resolve: ({ body }) =>
		hasToolResult(body)
			? completionResponse(toolCompletionResult(toolName))
			: {
					type: "tool_calls",
					toolCalls: [
						{
							id: `call_${toolName}`,
							name: toolName,
							arguments: typeof args === "function" ? args(getLastUserText(body)) : args,
						},
					],
				},
})

const extractSequentialExecuteCommands = (text: string): string[] => {
	const commands = [...text.matchAll(/^\s*\d+\.\s*(.+)$/gm)]
		.map((match) => match[1]?.trim())
		.filter((command): command is string => Boolean(command))

	return commands.length > 0 ? commands : [String(extractExecuteCommandArgs(text).command ?? "echo mock")]
}

const scenarioList: MockScenario[] = [
	{
		name: "text-only",
		resolve: ({ body }) => ({
			type: "text",
			text: textOnlyResult(getLastUserText(body)),
		}),
	},
	completionScenario("complete-square-root", "3"),
	completionScenario("complete-tool-result", "The requested tool completed successfully."),
	toolScenario("list-files", "list_files", extractListFilesArgs),
	toolScenario("read-file", "read_file", extractReadFileArgs),
	toolScenario("write-file", "write_to_file", extractWriteFileArgs),
	toolScenario("search-files", "search_files", extractSearchFilesArgs),
	{
		name: "execute-command-multiple",
		resolve: ({ body }) => {
			if (hasToolResult(body)) {
				return completionResponse(toolCompletionResult("execute_command"))
			}

			return {
				type: "tool_calls",
				toolCalls: extractSequentialExecuteCommands(getLastUserText(body)).map((command, index) => ({
					id: `call_execute_command_${index + 1}`,
					name: "execute_command",
					arguments: { command },
				})),
			}
		},
	},
	toolScenario("execute-command", "execute_command", extractExecuteCommandArgs),
	toolScenario("apply-diff", "apply_patch", extractApplyPatchArgs),
	toolScenario("switch-mode", "switch_mode", { mode_slug: "ask", reason: "Requested by E2E test." }),
	toolScenario("new-task", "new_task", extractNewTaskArgs),
	toolScenario("use-mcp-tool", "use_mcp_tool", extractUseMcpToolArgs),
	{
		name: "multi-tool",
		resolve: ({ body }) =>
			hasToolResult(body)
				? { type: "text", text: "Mock multi-tool results processed." }
				: {
						type: "tool_calls",
						toolCalls: [
							{ id: "call_read_file", name: "read_file", arguments: { path: "src/app.ts" } },
							{
								id: "call_search_files",
								name: "search_files",
								arguments: { path: "src", regex: "TODO" },
							},
						],
					},
	},
	{
		name: "error",
		resolve: () => ({ type: "error", status: 500, message: "Mock API error" }),
	},
]

const scenarios = new Map<string, MockScenario>(scenarioList.map((scenario) => [scenario.name, scenario]))

export function resolveScenario(name: string | undefined): MockScenario {
	return scenarios.get(name ?? "") ?? scenarios.get("text-only")!
}

export function autoResolveScenario(body: Record<string, unknown>): MockScenario {
	if (JSON.stringify(body.messages ?? []).includes("[cangjie-verification-e2e]")) {
		return { name: "cangjie-verification", resolve: ({ body }) => verificationResponse(body) }
	}
	if (hasAttemptCompletionResult(body)) return resolveScenario("text-only")
	if (hasToolResult(body)) {
		return {
			name: "complete-tool-result",
			resolve: ({ body: responseBody }) => completionResponse(getToolResultText(responseBody).slice(0, 1_000)),
		}
	}
	const text = getLastUserText(body)
	const lower = text.toLowerCase()
	const bodyText = JSON.stringify(body).toLowerCase()
	const wantsWriteFile =
		/create a file named\s+"[^"]+"/i.test(text) ||
		lower.includes("nested directory structure") ||
		lower.includes("use the write_to_file tool")
	const wantsExecuteCommand =
		lower.includes("use the execute_command tool") ||
		lower.includes("run this command") ||
		lower.includes("execute these commands") ||
		lower.includes("with these exact parameters")
	if (bodyText.includes("what is your name")) {
		return {
			name: "auto-complete",
			resolve: () => completionResponse("My name is Njust-AI"),
		}
	}
	if (bodyText.includes("unordered list")) {
		return {
			name: "auto-complete",
			resolve: () => completionResponse("- Apple\n- Banana\n- Orange"),
		}
	}
	if (bodyText.includes("numbered list") || bodyText.includes("three steps")) {
		return {
			name: "auto-complete",
			resolve: () => completionResponse("1. First step\n2. Second step\n3. Third step"),
		}
	}
	if (bodyText.includes("nested list")) {
		return {
			name: "auto-complete",
			resolve: () => completionResponse("- Main item\n  - Sub-item A\n  - Sub-item B"),
		}
	}
	if (
		bodyText.includes("both numbered items and bullet points") ||
		bodyText.includes("mixed ordered and unordered")
	) {
		return {
			name: "auto-complete",
			resolve: () =>
				completionResponse(
					"1. First ordered item\n   - First bullet point\n2. Second ordered item\n   - Second bullet point",
				),
		}
	}
	if (bodyText.includes("use the `switch_mode` tool") || bodyText.includes("switch to ask mode")) {
		return resolveScenario("switch-mode")
	}
	if (lower.includes("mcp") && (lower.includes("server") || lower.includes("use_mcp_tool"))) {
		return resolveScenario("use-mcp-tool")
	}
	if (lower.includes("new_task") || lower.includes("create a subtask")) return resolveScenario("new-task")
	if (/square root of 9/i.test(text)) return resolveScenario("complete-square-root")
	if (lower.includes("switch_mode")) return resolveScenario("switch-mode")
	if (lower.includes("list_files") || lower.includes("list the contents")) return resolveScenario("list-files")
	if (lower.includes("read_file") || lower.includes("read the file") || lower.includes("try to read")) {
		return resolveScenario("read-file")
	}
	if (lower.includes("apply_diff")) return resolveScenario("apply-diff")
	if (
		lower.includes("search_files") ||
		lower.includes("search the") ||
		lower.includes("search for") ||
		lower.includes("use search")
	)
		return resolveScenario("search-files")
	if (wantsWriteFile) return resolveScenario("write-file")
	if (wantsExecuteCommand && /(?:^|\n)\s*\d+\.\s*/.test(text)) {
		return resolveScenario("execute-command-multiple")
	}
	if (wantsExecuteCommand) return resolveScenario("execute-command")
	return {
		name: "auto-complete",
		resolve: () => completionResponse(textOnlyResult(text)),
	}
}

/** Drive the actual Cangjie stages; build/test evidence still comes from the extension's runner. */
function verificationResponse(body: Record<string, unknown>): MockScenarioResponse {
	const messages = Array.isArray(body.messages) ? body.messages : []
	const firstUser = messages.find(
		(message) => message && typeof message === "object" && "role" in message && message.role === "user",
	)
	const initial = getMessageText(firstUser)
	const stage = initial.match(/\[Sub-Agent Type: (Cangjie\w+)\]/)?.[1]
	const results = messages.filter(
		(message) => message && typeof message === "object" && "role" in message && message.role === "tool",
	)
	const tool = (id: string, name: string, args: Record<string, unknown>): MockScenarioResponse => ({
		type: "tool_calls",
		toolCalls: [{ id, name, arguments: args }],
	})
	const serialized = JSON.stringify(results)
	if (serialized.includes("先修复边界问题，不要结束")) {
		return tool("call_verification_feedback", "ask_followup_question", {
			question: "已收到：先修复边界问题，不要结束。请说明边界要求。",
			follow_up: [{ text: "继续检查边界" }],
		})
	}
	if (stage) {
		if (stage === "CangjieImplement" && results.length > 0 && !serialized.includes("call_verification_write")) {
			return tool("call_verification_write", "apply_patch", {
				patch: makePatch("src/main.cj", [{ search: "    0", replace: "    42" }]),
			})
		}
		if (results.length > 0) return completionResponse("Stage inspection complete.")
		return tool("call_verification_read", "read_file", { path: "src/main.cj" })
	}
	const stages = initial.includes("modify-feature")
		? ["CangjieExplore", "CangjieImplement", "CangjieVerify"]
		: ["CangjieVerify"]
	const done = results.filter(
		(message) => "tool_call_id" in message && String(message.tool_call_id).startsWith("call_verification_stage_"),
	).length
	const next = stages[done]
	if (next)
		return tool(`call_verification_stage_${next}`, "agent", {
			agentType: next,
			task: `[cangjie-verification-e2e] Inspect the existing demo project. ${next === "CangjieImplement" ? "Change its exit value to 42." : "Report the source contents."}`,
		})
	return completionResponse("Requested project work is ready for system verification.")
}
