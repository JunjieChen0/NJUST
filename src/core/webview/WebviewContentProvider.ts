/**
 * WebviewContentProvider generates HTML content for the webview.
 *
 * Supports both production builds and HMR (Hot Module Replacement) for development.
 */

import * as fs from "fs"
import * as path from "path"
import * as vscode from "vscode"
import axios from "axios"

import { getNonce } from "./getNonce"
import { getUri } from "./getUri"
import { resolveHmrViteServerHost } from "./resolveHmrViteServerHost"
import { t } from "../../i18n"
import { logger } from "../../shared/logger"
import { TelemetryEventName } from "@njust-ai/types"
import { TelemetryService } from "@njust-ai/telemetry"

export interface WebviewContentProviderHost {
	readonly extensionUri: vscode.Uri
	getValues(): { openRouterBaseUrl?: string }
}

export class WebviewContentProvider {
	constructor(private host: WebviewContentProviderHost) {}

	/**
	 * Generates HTML content for HMR (Hot Module Replacement) development mode.
	 * Falls back to production build if dev server is not running.
	 */
	async getHMRHtmlContent(webview: vscode.Webview): Promise<string> {
		let rawPort: string | null = null

		try {
			const portFilePath = path.resolve(__dirname, "../../.vite-port")

			if (fs.existsSync(portFilePath)) {
				rawPort = fs.readFileSync(portFilePath, "utf8").trim()
			} else {
				logger.info("WebviewContentProvider", `Port file not found at ${portFilePath}, using default port`)
			}
		} catch (err) {
			logger.error("WebviewContentProvider", "Failed to read Vite port file:", err)
			TelemetryService.reportError(err, TelemetryEventName.WEBVIEW_ERROR)
		}

		const resolved = resolveHmrViteServerHost({ rawPort })
		if (!resolved.ok) {
			logger.warn(
				"WebviewContentProvider",
				`HMR port input rejected (${resolved.reason}); falling back to default ${resolved.host}:${resolved.port}`,
			)
		} else {
			logger.info("WebviewContentProvider", `Using Vite server port: ${resolved.host}:${resolved.port}`)
		}

		const localPort = String(resolved.port)
		const localServerUrl = `${resolved.host}:${localPort}`

		// Check if local dev server is running.
		try {
			await axios.get(`http://${localServerUrl}`)
		} catch (_error) {
			vscode.window.showErrorMessage(t("common:errors.hmr_not_running"))
			return this.getHtmlContent(webview)
		}

		const nonce = getNonce()

		const openRouterBaseUrl = this.host.getValues().openRouterBaseUrl || "https://openrouter.ai"
		const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^/]+)/)?.[1] || "https://openrouter.ai"

		const stylesUri = getUri(webview, this.host.extensionUri, ["webview-ui", "build", "assets", "index.css"])

		const codiconsUri = getUri(webview, this.host.extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, this.host.extensionUri, ["assets", "vscode-material-icons", "icons"])
		const imagesUri = getUri(webview, this.host.extensionUri, ["assets", "images"])
		const audioUri = getUri(webview, this.host.extensionUri, ["webview-ui", "audio"])

		const file = "src/index.tsx"
		const scriptUri = `http://${localServerUrl}/${file}`

		const reactRefresh = /*html*/ `
			<script nonce="${nonce}" type="module">
				import RefreshRuntime from "http://localhost:${localPort}/@react-refresh"
				RefreshRuntime.injectIntoGlobalHook(window)
				window.$RefreshReg$ = () => {}
				window.$RefreshSig$ = () => (type) => type
				window.__vite_plugin_react_preamble_installed__ = true
			</script>
		`

		// ──────────────────────────────────────────────────────────────────
		// HMR-only CSP. PRODUCTION uses `getHtmlContent()` below, which has a
		// strict CSP without `unsafe-eval` / `unsafe-inline` for scripts and
		// without any `http://` origin.
		//
		// Why the relaxations are STILL necessary in HMR:
		//   * `'unsafe-eval'` — Vite's dev runtime and React Refresh evaluate
		//     module source generated at request time; removing it breaks HMR.
		//   * `'unsafe-inline'` for style-src — Vite injects CSS as inline
		//     <style> tags during HMR.
		//   * `http://${localServerUrl}` and `ws://${localServerUrl}` — the
		//     dev server speaks plain HTTP/WS on loopback only.
		//
		// Why this is acceptable in this code path only:
		//   * `localServerUrl` is hard-locked to a loopback host — see
		//     `resolveHmrViteServerHost`. No LAN/internet origin can reach it.
		//   * The HMR HTML is never produced in production builds (only when
		//     `IS_DEV` is true and the developer has started Vite).
		//   * The strict CSP from `getHtmlContent()` is what ships to users.
		//
		// If you ever need to ship `getHMRHtmlContent()` outside dev, the
		// `unsafe-eval` and `unsafe-inline` directives must be removed first.
		// ──────────────────────────────────────────────────────────────────
		const csp = [
			"default-src 'none'",
			`font-src ${webview.cspSource} data:`,
			`style-src ${webview.cspSource} 'unsafe-inline' http://${localServerUrl}`,
			`img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data:`,
			`media-src ${webview.cspSource} blob:`,
			`script-src 'unsafe-eval' ${webview.cspSource} http://${localServerUrl} 'nonce-${nonce}'`,
			`connect-src ${webview.cspSource} ${openRouterDomain} ws://${localServerUrl} http://${localServerUrl}`,
		]

		return /*html*/ `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="utf-8">
					<meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
					<meta http-equiv="Content-Security-Policy" content="${csp.join("; ")}">
					<link rel="stylesheet" type="text/css" href="${stylesUri}">
					<link href="${codiconsUri}" rel="stylesheet" />
					<script nonce="${nonce}">
						window.IMAGES_BASE_URI = "${imagesUri}"
						window.AUDIO_BASE_URI = "${audioUri}"
						window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
					</script>
					<title>NJUST_AI</title>
				</head>
				<body>
					<div id="root"></div>
					${reactRefresh}
					<script type="module" src="${scriptUri}"></script>
				</body>
			</html>
		`
	}

	/**
	 * Generates HTML content for production build.
	 */
	getHtmlContent(webview: vscode.Webview): string {
		const stylesUri = getUri(webview, this.host.extensionUri, ["webview-ui", "build", "assets", "index.css"])

		const scriptUri = getUri(webview, this.host.extensionUri, ["webview-ui", "build", "assets", "index.js"])
		const codiconsUri = getUri(webview, this.host.extensionUri, ["assets", "codicons", "codicon.css"])
		const materialIconsUri = getUri(webview, this.host.extensionUri, ["assets", "vscode-material-icons", "icons"])
		const imagesUri = getUri(webview, this.host.extensionUri, ["assets", "images"])
		const audioUri = getUri(webview, this.host.extensionUri, ["webview-ui", "audio"])

		const nonce = getNonce()

		const openRouterBaseUrl = this.host.getValues().openRouterBaseUrl || "https://openrouter.ai"
		const openRouterDomain = openRouterBaseUrl.match(/^(https?:\/\/[^/]+)/)?.[1] || "https://openrouter.ai"

		return /*html*/ `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
            <meta name="theme-color" content="#000000">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; font-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} https://storage.googleapis.com https://img.clerk.com data:; media-src ${webview.cspSource} blob:; script-src ${webview.cspSource} 'wasm-unsafe-eval' 'nonce-${nonce}' 'strict-dynamic'; connect-src ${webview.cspSource} ${openRouterDomain} https://api.requesty.ai;">
            <link rel="stylesheet" type="text/css" href="${stylesUri}">
			<link href="${codiconsUri}" rel="stylesheet" />
			<script nonce="${nonce}">
				window.IMAGES_BASE_URI = "${imagesUri}"
				window.AUDIO_BASE_URI = "${audioUri}"
				window.MATERIAL_ICONS_BASE_URI = "${materialIconsUri}"
			</script>
            <title>NJUST_AI</title>
          </head>
          <body>
            <noscript>You need to enable JavaScript to run this app.</noscript>
            <div id="root"></div>
            <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
          </body>
        </html>
      `
	}
}
