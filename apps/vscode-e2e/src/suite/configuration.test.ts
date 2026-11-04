import * as assert from "assert"
import * as vscode from "vscode"

suite("VS Code effective configuration listing", () => {
	test("includes defaults and workspace overrides under the registered namespace", async () => {
		const config = vscode.workspace.getConfiguration("njust-ai")
		const before = config.inspect<string>("cangjieTools.cjpmPath")?.workspaceValue
		try {
			await config.update(
				"cangjieTools.cjpmPath",
				"configuration-list-test-cjpm",
				vscode.ConfigurationTarget.Workspace,
			)
			const listed = vscode.workspace.getConfiguration().get<{
				cangjieTools: { cjpmPath: string }
				debugProxy: { enabled: boolean }
			}>("njust-ai")
			assert.ok(listed)
			assert.strictEqual(listed.cangjieTools.cjpmPath, "configuration-list-test-cjpm")
			assert.strictEqual(listed.debugProxy.enabled, config.get("debugProxy.enabled"))
			assert.strictEqual(typeof listed.debugProxy.enabled, "boolean")
		} finally {
			await config.update("cangjieTools.cjpmPath", before, vscode.ConfigurationTarget.Workspace)
		}
	})
})
