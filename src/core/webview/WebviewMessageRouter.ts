/**
 * WebviewMessageRouter — Routes incoming webview messages to the appropriate
 * handler and synchronizes state back to the frontend.
 *
 * Extracted from ClineProvider.ts to decompose the monolithic file.
 *
 * Phase 1: Interface + thin delegation layer.
 * Phase 2: Concrete implementation that owns the listener lifecycle,
 * keeping ClineProvider free of message-wiring details.
 */
import type * as vscode from "vscode"
import type { WebviewMessage } from "../../shared/WebviewMessage"
import { webviewMessageHandler } from "./webviewMessageHandler"

/**
 * The subset of ClineProvider that the router needs.
 * Using an interface avoids importing the full ClineProvider class,
 * breaking the circular-dependency risk.
 */
export interface IWebviewMessageHost {
	/** Pass-through — webviewMessageHandler expects the full provider as first arg. */
	readonly self: unknown
}

/**
 * Service interface for webview message routing.
 */
export interface IWebviewMessageRouter {
	/**
	 * Register the message listener on a webview. Typically called once
	 * inside resolveWebviewView after the webview content is configured.
	 */
	setWebviewMessageListener(webview: vscode.Webview): void

	/** Dispose all listeners registered via setWebviewMessageListener. */
	dispose(): void
}

/**
 * Concrete router that owns the onDidReceiveMessage subscription.
 *
 * Lifecycle: create once per ClineProvider; call `setWebviewMessageListener`
 * when the webview becomes available; call `dispose` (or let
 * ClineProvider.dispose drain `webviewDisposables`) to clean up.
 */
export class WebviewMessageRouter implements IWebviewMessageRouter {
	private readonly disposables: vscode.Disposable[] = []

	/**
	 * @param provider The ClineProvider instance (typed as `unknown` to
	 *   avoid a direct import — webviewMessageHandler performs its own cast).
	 */
	constructor(private readonly provider: unknown) {}

	setWebviewMessageListener(webview: vscode.Webview): void {
		const onReceiveMessage = async (message: WebviewMessage) =>
			webviewMessageHandler(this.provider as Parameters<typeof webviewMessageHandler>[0], message)

		const sub = webview.onDidReceiveMessage(onReceiveMessage)
		this.disposables.push(sub)
	}

	dispose(): void {
		while (this.disposables.length) {
			this.disposables.pop()?.dispose()
		}
	}

	/** Expose disposables so ClineProvider can merge them into its own array. */
	getDisposables(): readonly vscode.Disposable[] {
		return this.disposables
	}
}
