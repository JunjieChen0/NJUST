import * as vscode from "vscode"

import { getVisibleInstance } from "./providerActionDispatcher"

/** Maximum age for OAuth state before it is considered expired (10 minutes). */
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000

/** Maximum allowed URI length to prevent abuse. */
const MAX_URI_LENGTH = 8192

export interface IUriCallbackHandler {
	handleOpenRouterCallback(code: string, codeVerifier?: string): Promise<void>
	handleRequestyCallback(code: string, baseUrl: string | null): Promise<void>
	pendingOAuthState?: {
		state: string
		codeVerifier?: string
		provider: "openrouter" | "requesty"
		expectedBaseUrl?: string
		createdAt: number
	}
}

let uriCallbackHandler: IUriCallbackHandler | undefined

export function registerUriCallbackHandler(handler: IUriCallbackHandler): void {
	uriCallbackHandler = handler
}

/**
 * Validate the pending OAuth state against the returned callback parameters.
 *
 * Returns the pending state if valid, or null with an error message shown to the user.
 *
 * **Critical**: This function does NOT clear `handler.pendingOAuthState`.
 * The caller must only clear it after the state has been validated AND
 * the callback handler has been successfully invoked.
 *
 * This ensures that spurious/bad callbacks (wrong state, missing state,
 * error requests without state) do NOT terminate the login flow — the
 * handler keeps waiting for a legitimate callback.
 */
function validatePendingState(
	handler: IUriCallbackHandler,
	returnedState: string | null,
	expectedProvider: "openrouter" | "requesty",
	providerLabel: string,
): NonNullable<IUriCallbackHandler["pendingOAuthState"]> | null {
	const pendingState = handler.pendingOAuthState

	if (!pendingState || !returnedState) {
		vscode.window.showErrorMessage(
			`${providerLabel} OAuth authentication rejected: missing CSRF state parameter.`,
		)
		return null
	}

	if (pendingState.provider !== expectedProvider) {
		vscode.window.showErrorMessage(
			`${providerLabel} OAuth rejected: state was issued for a different provider.`,
		)
		return null
	}

	if (Date.now() - pendingState.createdAt > OAUTH_STATE_MAX_AGE_MS) {
		vscode.window.showErrorMessage(
			`${providerLabel} OAuth rejected: state has expired. Please restart authentication.`,
		)
		return null
	}

	if (returnedState !== pendingState.state) {
		vscode.window.showErrorMessage(
			`${providerLabel} OAuth state mismatch detected. Authentication rejected for security.`,
		)
		return null
	}

	return pendingState
}

export const handleUri = async (uri: vscode.Uri) => {
	// Step 1: Validate URI length
	const uriString = uri.toString()
	if (uriString.length > MAX_URI_LENGTH) {
		return
	}

	const path = uri.path
	const query = new URLSearchParams(uri.query.replace(/\+/g, "%2B"))
	const visibleProvider = getVisibleInstance() as IUriCallbackHandler | undefined

	if (!visibleProvider && !uriCallbackHandler) {
		return
	}

	const handler = visibleProvider ?? uriCallbackHandler!

	switch (path) {
		case "/openrouter": {
			// Step 2: Read parameters
			const code = query.get("code")
			const returnedState = query.get("state")

			if (!code) break

			// Step 3: Validate state (does NOT clear pendingOAuthState on failure)
			const pendingState = validatePendingState(handler, returnedState, "openrouter", "OpenRouter")
			if (!pendingState) break

			// Step 4: State validated — now clear pending state and process callback
			handler.pendingOAuthState = undefined

			const codeVerifier = pendingState.codeVerifier
			await handler.handleOpenRouterCallback(code, codeVerifier)
			break
		}
		case "/requesty": {
			// Step 2: Read parameters
			const code = query.get("code")
			const baseUrl = query.get("baseUrl")
			const returnedState = query.get("state")

			if (!code) break

			// Step 3: Validate state (does NOT clear pendingOAuthState on failure)
			const pendingState = validatePendingState(handler, returnedState, "requesty", "Requesty")
			if (!pendingState) break

			// Step 4: State validated — now clear pending state and process callback
			handler.pendingOAuthState = undefined

			// Step 5: Additional Requesty-specific validation (only after state is valid)
			if (pendingState.expectedBaseUrl) {
				if (!baseUrl) {
					vscode.window.showErrorMessage("Requesty OAuth rejected: callback missing expected base URL.")
					break
				}
				try {
					const expectedOrigin = new URL(pendingState.expectedBaseUrl).origin
					const actualOrigin = new URL(baseUrl).origin
					if (expectedOrigin !== actualOrigin) {
						vscode.window.showErrorMessage(
							"Requesty OAuth rejected: callback base URL does not match the configured endpoint.",
						)
						break
					}
				} catch {
					vscode.window.showErrorMessage("Requesty OAuth rejected: invalid base URL format.")
					break
				}
			}

			await handler.handleRequestyCallback(code, baseUrl)
			break
		}
		default:
			break
	}
}
