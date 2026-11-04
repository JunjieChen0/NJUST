import * as assert from "node:assert"
import * as path from "node:path"
import * as vscode from "vscode"
import type { NJUST_AIAPI } from "@njust-ai/types"
import { waitFor } from "./utils"

/** Entry point used only by the packaged Nightly smoke runner. */
export async function run(): Promise<void> {
	const extension = vscode.extensions.getExtension<NJUST_AIAPI>("JunjieChen-YuyaoJiang.njust-ai-nightly")
	assert.ok(extension, "Installed Nightly extension must be discovered")
	assert.strictEqual(path.resolve(extension.extensionPath), path.resolve(process.env.NIGHTLY_SMOKE_EXTENSION_PATH!))
	const manifest = extension.packageJSON as {
		icon: string
		contributes: {
			debuggers?: { type: string }[]
			languages?: { configuration?: string }[]
			grammars?: { path: string }[]
			snippets?: { path: string }[]
		}
	}
	assert.strictEqual(manifest.icon, "assets/icons/icon.png", "Nightly must display the NJUST crest")
	await vscode.workspace.fs.stat(vscode.Uri.joinPath(extension.extensionUri, manifest.icon))
	assert.ok(manifest.contributes.debuggers?.some((debuggerType) => debuggerType.type === "cangjie"))
	const resources = [
		...(manifest.contributes.languages ?? []).flatMap((language) => language.configuration ?? []),
		...(manifest.contributes.grammars ?? []).map((grammar) => grammar.path),
		...(manifest.contributes.snippets ?? []).map((snippet) => snippet.path),
	]
	assert.ok(resources.length > 0, "Language resources must be declared")
	for (const resource of resources)
		await vscode.workspace.fs.stat(vscode.Uri.joinPath(extension.extensionUri, resource))
	const api = await extension.activate()
	assert.ok(extension.isActive, "Packaged Nightly must activate successfully")
	const commands = await vscode.commands.getCommands(true)
	assert.ok(
		commands.includes("njust-ai-nightly.settingsButtonClicked"),
		"Nightly settings command must be registered",
	)
	await vscode.commands.executeCommand("njust-ai-nightly.SidebarProvider.focus")
	await waitFor(() => api.isReady(), { timeout: 60_000 })
	await vscode.commands.executeCommand("njust-ai-nightly.settingsButtonClicked")
	console.info("Nightly VSIX smoke passed: declarations, resources, activation, webview and settings command")
}
