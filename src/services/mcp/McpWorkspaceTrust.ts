import * as fs from "fs/promises"
import * as path from "path"

import * as vscode from "vscode"

export const TRUSTED_WORKSPACES_FILE_NAME = "trusted_workspaces.json"

type TrustedWorkspacesFile = { trustedWorkspaces?: string[] }

/**
 * Returns true when the workspace was previously trusted for project-level MCP
 * auto-start. Missing or unreadable files mean "not trusted".
 */
export async function isWorkspaceTrusted(filePath: string, workspacePath: string): Promise<boolean> {
	try {
		const content = await fs.readFile(filePath, "utf-8")
		const data = JSON.parse(content) as TrustedWorkspacesFile
		const normalized = path.normalize(workspacePath)
		return (data.trustedWorkspaces ?? []).some((p) => path.normalize(p) === normalized)
	} catch {
		return false
	}
}

/** Records the workspace as trusted, de-duplicating normalized paths. */
export async function trustWorkspace(filePath: string, workspacePath: string): Promise<void> {
	let data: { trustedWorkspaces: string[] }

	try {
		const content = await fs.readFile(filePath, "utf-8")
		const parsed = JSON.parse(content) as TrustedWorkspacesFile
		data = { trustedWorkspaces: Array.isArray(parsed.trustedWorkspaces) ? parsed.trustedWorkspaces : [] }
	} catch {
		data = { trustedWorkspaces: [] }
	}

	const normalized = path.normalize(workspacePath)

	if (!data.trustedWorkspaces.some((p) => path.normalize(p) === normalized)) {
		data.trustedWorkspaces.push(normalized)
	}

	await fs.mkdir(path.dirname(filePath), { recursive: true })
	await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8")
}

/** Asks the user whether project-level MCP servers may start automatically. */
export async function promptUserToTrustMcpServers(): Promise<boolean> {
	const YES = "Enable MCP Servers"
	const NO = "Skip"
	const choice = await vscode.window.showWarningMessage(
		"This workspace contains a .njust_ai/mcp.json file with MCP server configurations. These servers will start automatically and run shell commands. Do you want to enable them?",
		{ modal: true },
		YES,
		NO,
	)

	return choice === YES
}
