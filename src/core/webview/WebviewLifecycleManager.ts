/**
 * WebviewLifecycleManager — Manages webview panel/view creation, disposal,
 * and disposables registration.
 *
 * Extracted from ClineProvider.ts to decompose the monolithic file.
 *
 * Phase 1: Interface definition for webview lifecycle operations.
 * Phase 2: Move configureWebviewPanelMode, configureWebviewContent,
 * attachWebviewLifecycleListeners, clearWebviewResources,
 * and initializeWebviewRuntimeState from ClineProvider.
 */
import * as vscode from "vscode"

import { Terminal } from "../../integrations/terminal/Terminal"
import { getTheme } from "../../integrations/theme/getTheme"
import { setTtsEnabled, setTtsSpeed } from "../../utils/tts"
import { setPanel } from "../../activate/registerCommands"

/**
 * Service interface for webview lifecycle management.
 * ClineProvider implements this surface.
 */
export interface IWebviewLifecycleManager {
	resolveWebviewView(
		webviewView: vscode.WebviewView | vscode.WebviewPanel,
		context?: vscode.WebviewViewResolveContext,
		token?: vscode.CancellationToken,
	): Promise<void>

	postMessageToWebview(message: any): Promise<void>

	convertToWebviewUri(filePath: string): string

	dispose(): Promise<void>
}

/**
 * Concrete implementation that delegates back to the ClineProvider host.
 * All `this.X` references from the original ClineProvider methods become `h.X`.
 */
export class WebviewLifecycleManager {
	constructor(private host: any) {}

	clearWebviewResources(): void {
		const h = this.host
		while (h.webviewDisposables.length) {
			const x = h.webviewDisposables.pop()
			if (x) {
				x.dispose()
			}
		}
	}

	configureWebviewPanelMode(webviewView: vscode.WebviewView | vscode.WebviewPanel): boolean {
		const inTabMode = "onDidChangeViewState" in webviewView
		if (inTabMode) {
			setPanel(webviewView, "tab")
		} else if ("onDidChangeVisibility" in webviewView) {
			setPanel(webviewView, "sidebar")
		}
		return inTabMode
	}

	async initializeWebviewRuntimeState(): Promise<void> {
		const h = this.host
		const {
			terminalShellIntegrationTimeout = Terminal.defaultShellIntegrationTimeout,
			terminalShellIntegrationDisabled = false,
			terminalCommandDelay = 0,
			terminalZshClearEolMark = true,
			terminalZshOhMy = false,
			terminalZshP10k = false,
			terminalPowershellCounter = false,
			terminalZdotdir = false,
			ttsEnabled,
			ttsSpeed,
		} = await h.getState()

		Terminal.setShellIntegrationTimeout(terminalShellIntegrationTimeout)
		Terminal.setShellIntegrationDisabled(terminalShellIntegrationDisabled)
		Terminal.setCommandDelay(terminalCommandDelay)
		Terminal.setTerminalZshClearEolMark(terminalZshClearEolMark)
		Terminal.setTerminalZshOhMy(terminalZshOhMy)
		Terminal.setTerminalZshP10k(terminalZshP10k)
		Terminal.setPowershellCounter(terminalPowershellCounter)
		Terminal.setTerminalZdotdir(terminalZdotdir)
		setTtsEnabled(ttsEnabled ?? false)
		setTtsSpeed(ttsSpeed ?? 1)

		await h.contextProxy.setValue("enableWebSearch", false)
	}

	async configureWebviewContent(webviewView: vscode.WebviewView | vscode.WebviewPanel): Promise<void> {
		const h = this.host
		const resourceRoots = [h.contextProxy.extensionUri]
		if (vscode.workspace.workspaceFolders) {
			resourceRoots.push(...vscode.workspace.workspaceFolders.map((folder: vscode.WorkspaceFolder) => folder.uri))
		}

		webviewView.webview.options = { enableScripts: true, localResourceRoots: resourceRoots }
		webviewView.webview.html =
			h.contextProxy.extensionMode === vscode.ExtensionMode.Development
				? await h.getHMRHtmlContent(webviewView.webview)
				: await h.getHtmlContent(webviewView.webview)
	}

	attachWebviewLifecycleListeners(
		webviewView: vscode.WebviewView | vscode.WebviewPanel,
		inTabMode: boolean,
	): void {
		const h = this.host
		const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(() => {
			h.updateCodeIndexStatusSubscription()
		})
		h.webviewDisposables.push(activeEditorSubscription)

		if ("onDidChangeViewState" in webviewView) {
			const viewStateDisposable = webviewView.onDidChangeViewState(() => {
				if (h.view?.visible) {
					h.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
				}
			})
			h.webviewDisposables.push(viewStateDisposable)
		} else if ("onDidChangeVisibility" in webviewView) {
			const visibilityDisposable = webviewView.onDidChangeVisibility(() => {
				if (h.view?.visible) {
					h.postMessageToWebview({ type: "action", action: "didBecomeVisible" })
				}
			})
			h.webviewDisposables.push(visibilityDisposable)
		}

		webviewView.onDidDispose(
			async () => {
				if (inTabMode) {
					h.log("Disposing ClineProvider instance for tab view")
					await h.dispose()
				} else {
					h.log("Clearing webview resources for sidebar view")
					this.clearWebviewResources()
					h.codeIndexManager = undefined
				}
			},
			null,
			h.disposables,
		)

		const configDisposable = vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (e && e.affectsConfiguration("workbench.colorTheme")) {
				await h.postMessageToWebview({ type: "theme", text: JSON.stringify(await getTheme()) })
			}
		})
		h.webviewDisposables.push(configDisposable)
	}
}
