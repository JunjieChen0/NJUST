import { Task } from "../task/Task"

import { BaseTool, ToolCallbacks } from "./BaseTool"

interface ConfigParams {
	action: string
	key?: string
	value?: unknown
}

/**
 * ConfigTool – read / write VS Code workspace configuration under "roo-code".
 *
 * Actions:
 *   - get  : return the value of a single key
 *   - set  : update a key to a new value
 *   - list : return all keys under "roo-code"
 */
export class ConfigTool extends BaseTool<"config"> {
	readonly name = "config" as const

	override isConcurrencySafe(): boolean {
		return true
	}

	override isReadOnly(params?: Record<string, unknown>): boolean {
		if (!params) return false
		const action = params.action as string | undefined
		return action === "get" || action === "list"
	}

	override userFacingName(): string {
		return "Config"
	}

	override get searchHint(): string | undefined {
		return "config configuration settings"
	}

	override get shouldDefer(): boolean {
		return true
	}

	override async execute(params: ConfigParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
		const { askApproval, handleError, pushToolResult } = callbacks
		const recordMissingParamError = async (paramName: string): Promise<void> => {
			task.consecutiveMistakeCount++
			task.recordToolError("custom_tool")
			task.didToolFailInCurrentTurn = true
			pushToolResult(await task.sayAndCreateMissingParamError("custom_tool", paramName))
		}

		try {
			const { action, key, value } = params

			if (!action || !["get", "set", "list"].includes(action)) {
				await recordMissingParamError("action")
				return
			}

			// Dynamically import vscode to avoid hard dependency at module level
			const vscode = await import("vscode")
			const config = vscode.workspace.getConfiguration("roo-code")

			switch (action) {
				case "get": {
					if (!key) {
						await recordMissingParamError("key")
						return
					}
					task.consecutiveMistakeCount = 0
					const val = config.get(key)
					pushToolResult(JSON.stringify({ key, value: val }, null, 2))
					return
				}

				case "list": {
					task.consecutiveMistakeCount = 0
					// config object contains the resolved settings; extract own keys.
					const allKeys: Record<string, unknown> = {}
					// The VS Code API doesn't expose a simple "list all keys" method.
					// Inspect the configuration section to get defined keys.
					const inspect = config.inspect("")
					if (inspect) {
						const merge = (src: Record<string, unknown> | undefined) => {
							if (src) {
								for (const [k, v] of Object.entries(src)) {
									allKeys[k] = v
								}
							}
						}
						merge(inspect.globalValue as Record<string, unknown> | undefined)
						merge(inspect.workspaceValue as Record<string, unknown> | undefined)
						merge(inspect.workspaceFolderValue as Record<string, unknown> | undefined)
						merge(inspect.defaultValue as Record<string, unknown> | undefined)
					}
					pushToolResult(JSON.stringify(allKeys, null, 2))
					return
				}

				case "set": {
					if (!key) {
						await recordMissingParamError("key")
						return
					}

					// Require user approval for write operations
					const didApprove = await askApproval("tool")
					if (!didApprove) {
						return
					}

					task.consecutiveMistakeCount = 0
					await config.update(key, value, vscode.ConfigurationTarget.Workspace)
					pushToolResult(JSON.stringify({ success: true, key, value }, null, 2))
					return
				}
			}
		} catch (error) {
			await handleError("managing configuration", error as Error)
		}
	}
}

export const configTool = new ConfigTool()
