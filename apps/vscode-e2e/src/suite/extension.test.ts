import * as assert from "assert"
import * as vscode from "vscode"

import { setDefaultSuiteTimeout } from "./test-utils"

suite("NJUST_AI Extension", function () {
	setDefaultSuiteTimeout(this)

	test("Commands should be registered", async () => {
		const expectedCommands = [
			// `SidebarProvider.open` is a VS Code-generated view-container command that only
			// exists in newer builds, so it is intentionally not part of the required set.
			"SidebarProvider.focus",
			"SidebarProvider.resetViewLocation",
			"SidebarProvider.toggleVisibility",
			"SidebarProvider.removeView",
			"activationCompleted",
			"plusButtonClicked",
			"popoutButtonClicked",
			"openInNewTab",
			"settingsButtonClicked",
			"historyButtonClicked",
			"newTask",
			"setCustomStoragePath",
			"focusInput",
			"acceptInput",
			"explainCode",
			"fixCode",
			"improveCode",
			"addToContext",
			"terminalAddToContext",
			"terminalFixCommand",
			"terminalExplainCommand",
		]

		const commands = new Set((await vscode.commands.getCommands(true)).filter((cmd) => cmd.startsWith("njust-ai")))
		const missing = expectedCommands.filter((command) => !commands.has(`njust-ai.${command}`))

		assert.deepStrictEqual(
			missing,
			[],
			`Commands should be registered. Missing: ${missing.join(", ")}. Available: ${[...commands].sort().join(", ")}`,
		)
	})
})
