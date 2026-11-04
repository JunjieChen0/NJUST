import { beforeEach, describe, expect, it, vi } from "vitest"
import * as vscode from "vscode"
import { configTool } from "../ConfigTool"
import { Package } from "../../../shared/package"
import type { Task } from "../../task/Task"
import type { ToolCallbacks } from "../BaseTool"
import { asMock } from "../../../__tests__/helpers/asMock"

vi.mock("vscode", async (importOriginal) => ({
	...(await importOriginal<typeof vscode>()),
	ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
}))

describe("ConfigTool registered settings", () => {
	const get = vi.fn()
	const inspect = vi.fn()
	const update = vi.fn()
	const rootGet = vi.fn()
	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(vscode.workspace, "getConfiguration").mockImplementation((section) => {
			if (section === undefined) return asMock<vscode.WorkspaceConfiguration>({ get: rootGet })
			if (section !== Package.name) throw new Error("Unregistered configuration section")
			return asMock<vscode.WorkspaceConfiguration>({ get, inspect, update })
		})
	})

	it("lists effective defaults and overrides even when inspecting the section returns undefined", async () => {
		inspect.mockReturnValue(undefined)
		const settings = { cangjieTools: { cjpmPath: "workspace-cjpm" }, debugProxy: { enabled: false } }
		rootGet.mockReturnValue(settings)
		const callbacks = {
			askApproval: vi.fn(),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		await configTool.execute({ action: "list" }, { consecutiveMistakeCount: 1 } as Task, callbacks as ToolCallbacks)
		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect(callbacks.askApproval).not.toHaveBeenCalled()
		expect(callbacks.pushToolResult).toHaveBeenCalledWith(JSON.stringify(settings, null, 2))
		expect(rootGet).toHaveBeenCalledWith(Package.name, {})
	})

	it.each(["get", "list", "set"])("uses the registered section for %s", async (action) => {
		get.mockReturnValue(true)
		inspect.mockReturnValue({ defaultValue: { "cangjieTools.cjpmPath": "cjpm" } })
		update.mockResolvedValue(undefined)
		const callbacks = {
			askApproval: vi.fn().mockResolvedValue(true),
			handleError: vi.fn(),
			pushToolResult: vi.fn(),
		}
		await configTool.execute(
			{ action, key: "cangjieTools.cjpmPath", value: "new-cjpm" },
			{ consecutiveMistakeCount: 1 } as Task,
			callbacks as ToolCallbacks,
		)
		expect(callbacks.handleError).not.toHaveBeenCalled()
		expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(Package.name)
		if (action === "set")
			expect(update).toHaveBeenCalledWith(
				"cangjieTools.cjpmPath",
				"new-cjpm",
				vscode.ConfigurationTarget.Workspace,
			)
		else expect(callbacks.pushToolResult).toHaveBeenCalled()
	})
})
