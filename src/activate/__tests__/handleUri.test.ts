import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock vscode before importing handleUri
vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
	},
	Uri: {
		parse: (str: string) => {
			const url = new URL(str.replace(/^vscode:/, "http:"))
			return {
				path: url.pathname,
				query: url.search.replace("?", ""),
				toString: () => str,
			}
		},
	},
}))

vi.mock("../providerActionDispatcher", () => ({
	getVisibleInstance: vi.fn(() => undefined),
}))

import { handleUri, registerUriCallbackHandler, type IUriCallbackHandler } from "../handleUri"
import * as vscode from "vscode"

function createMockUri(path: string, query: string) {
	const uriString = `vscode://test.extension${path}${query ? "?" + query : ""}`
	return {
		path,
		query,
		toString: () => uriString,
	} as any
}

function createMockHandler(overrides?: Partial<IUriCallbackHandler>): IUriCallbackHandler {
	return {
		handleOpenRouterCallback: vi.fn().mockResolvedValue(undefined),
		handleRequestyCallback: vi.fn().mockResolvedValue(undefined),
		pendingOAuthState: undefined,
		...overrides,
	}
}

describe("handleUri — OAuth callback state handling", () => {
	let handler: IUriCallbackHandler

	beforeEach(() => {
		vi.clearAllMocks()
		handler = createMockHandler()
		registerUriCallbackHandler(handler)
	})

	it("wrong state does NOT clear pending state — subsequent valid callback succeeds", async () => {
		const validState = "valid-state-123"
		handler.pendingOAuthState = {
			state: validState,
			provider: "openrouter",
			createdAt: Date.now(),
		}

		// First callback: wrong state → should fail but NOT clear pending state
		const badUri = createMockUri("/openrouter", "code=abc&state=wrong-state")
		await handleUri(badUri)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("state mismatch"),
		)
		expect(handler.handleOpenRouterCallback).not.toHaveBeenCalled()
		// Critical: pending state must still be set
		expect(handler.pendingOAuthState).toBeDefined()
		expect(handler.pendingOAuthState!.state).toBe(validState)

		vi.clearAllMocks()

		// Second callback: correct state → should succeed
		const goodUri = createMockUri("/openrouter", `code=xyz&state=${validState}`)
		await handleUri(goodUri)

		expect(handler.handleOpenRouterCallback).toHaveBeenCalledWith("xyz", undefined)
		// Now pending state should be cleared
		expect(handler.pendingOAuthState).toBeUndefined()
	})

	it("error request without state does NOT terminate the login flow", async () => {
		const validState = "valid-state-456"
		handler.pendingOAuthState = {
			state: validState,
			provider: "openrouter",
			createdAt: Date.now(),
		}

		// First callback: error (no state, no code) → should not clear pending state
		const errorUri = createMockUri("/openrouter", "error=access_denied")
		await handleUri(errorUri)

		// No code means we break early, pending state stays
		expect(handler.pendingOAuthState).toBeDefined()
		expect(handler.pendingOAuthState!.state).toBe(validState)

		vi.clearAllMocks()

		// Second callback: valid → should succeed
		const goodUri = createMockUri("/openrouter", `code=good-code&state=${validState}`)
		await handleUri(goodUri)

		expect(handler.handleOpenRouterCallback).toHaveBeenCalledWith("good-code", undefined)
		expect(handler.pendingOAuthState).toBeUndefined()
	})

	it("missing state parameter does NOT clear pending state", async () => {
		const validState = "valid-state-789"
		handler.pendingOAuthState = {
			state: validState,
			provider: "openrouter",
			createdAt: Date.now(),
		}

		// Callback with code but no state → should reject but not clear
		const noStateUri = createMockUri("/openrouter", "code=abc")
		await handleUri(noStateUri)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("missing CSRF state"),
		)
		expect(handler.pendingOAuthState).toBeDefined()
		expect(handler.handleOpenRouterCallback).not.toHaveBeenCalled()
	})

	it("two concurrent valid callbacks — only the first one succeeds", async () => {
		const validState = "concurrent-state"
		handler.pendingOAuthState = {
			state: validState,
			provider: "openrouter",
			createdAt: Date.now(),
		}

		const uri1 = createMockUri("/openrouter", `code=code1&state=${validState}`)
		const uri2 = createMockUri("/openrouter", `code=code2&state=${validState}`)

		// First callback succeeds and clears state
		await handleUri(uri1)
		expect(handler.handleOpenRouterCallback).toHaveBeenCalledWith("code1", undefined)
		expect(handler.pendingOAuthState).toBeUndefined()

		vi.clearAllMocks()

		// Second callback fails because state was already consumed
		await handleUri(uri2)
		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("missing CSRF state"),
		)
		expect(handler.handleOpenRouterCallback).not.toHaveBeenCalled()
	})

	it("expired state does NOT clear pending state", async () => {
		handler.pendingOAuthState = {
			state: "expired-state",
			provider: "openrouter",
			createdAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago
		}

		const uri = createMockUri("/openrouter", "code=abc&state=expired-state")
		await handleUri(uri)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("expired"),
		)
		expect(handler.pendingOAuthState).toBeDefined()
		expect(handler.handleOpenRouterCallback).not.toHaveBeenCalled()
	})

	it("wrong provider does NOT clear pending state", async () => {
		handler.pendingOAuthState = {
			state: "requesty-state",
			provider: "requesty",
			createdAt: Date.now(),
		}

		// OpenRouter callback with correct state value but wrong provider
		const uri = createMockUri("/openrouter", "code=abc&state=requesty-state")
		await handleUri(uri)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("different provider"),
		)
		expect(handler.pendingOAuthState).toBeDefined()
		expect(handler.handleOpenRouterCallback).not.toHaveBeenCalled()
	})
})

describe("handleUri — Requesty callback", () => {
	let handler: IUriCallbackHandler

	beforeEach(() => {
		vi.clearAllMocks()
		handler = createMockHandler()
		registerUriCallbackHandler(handler)
	})

	it("wrong state does NOT clear pending state for Requesty", async () => {
		handler.pendingOAuthState = {
			state: "req-state-123",
			provider: "requesty",
			createdAt: Date.now(),
			expectedBaseUrl: "https://api.requesty.ai",
		}

		const badUri = createMockUri("/requesty", "code=abc&state=wrong&baseUrl=https://api.requesty.ai")
		await handleUri(badUri)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("state mismatch"),
		)
		expect(handler.pendingOAuthState).toBeDefined()
		expect(handler.handleRequestyCallback).not.toHaveBeenCalled()
	})

	it("valid Requesty callback clears state and processes callback", async () => {
		handler.pendingOAuthState = {
			state: "req-state-456",
			provider: "requesty",
			createdAt: Date.now(),
			expectedBaseUrl: "https://api.requesty.ai",
		}

		const goodUri = createMockUri(
			"/requesty",
			"code=req-code&state=req-state-456&baseUrl=https://api.requesty.ai",
		)
		await handleUri(goodUri)

		expect(handler.handleRequestyCallback).toHaveBeenCalledWith("req-code", "https://api.requesty.ai")
		expect(handler.pendingOAuthState).toBeUndefined()
	})

	it("baseUrl mismatch after valid state still rejects", async () => {
		handler.pendingOAuthState = {
			state: "req-state-789",
			provider: "requesty",
			createdAt: Date.now(),
			expectedBaseUrl: "https://api.requesty.ai",
		}

		const uri = createMockUri(
			"/requesty",
			"code=req-code&state=req-state-789&baseUrl=https://evil.com",
		)
		await handleUri(uri)

		expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("base URL does not match"),
		)
		expect(handler.handleRequestyCallback).not.toHaveBeenCalled()
		// State was validated and cleared
		expect(handler.pendingOAuthState).toBeUndefined()
	})
})

describe("handleUri — URI validation", () => {
	let handler: IUriCallbackHandler

	beforeEach(() => {
		vi.clearAllMocks()
		handler = createMockHandler()
		registerUriCallbackHandler(handler)
	})

	it("rejects URI exceeding maximum length", async () => {
		handler.pendingOAuthState = {
			state: "valid-state",
			provider: "openrouter",
			createdAt: Date.now(),
		}

		// Create a URI with a very long query string
		const longParam = "x".repeat(10000)
		const uri = createMockUri("/openrouter", `code=abc&state=valid-state&padding=${longParam}`)
		await handleUri(uri)

		// Should silently reject — no callback, no error message
		expect(handler.handleOpenRouterCallback).not.toHaveBeenCalled()
		expect(vscode.window.showErrorMessage).not.toHaveBeenCalled()
		// Pending state preserved for next attempt
		expect(handler.pendingOAuthState).toBeDefined()
	})

	it("unknown path is silently ignored", async () => {
		handler.pendingOAuthState = {
			state: "valid-state",
			provider: "openrouter",
			createdAt: Date.now(),
		}

		const uri = createMockUri("/unknown", "code=abc&state=valid-state")
		await handleUri(uri)

		expect(handler.handleOpenRouterCallback).not.toHaveBeenCalled()
		expect(handler.handleRequestyCallback).not.toHaveBeenCalled()
		// Pending state preserved
		expect(handler.pendingOAuthState).toBeDefined()
	})
})

describe("handleUri — PKCE support", () => {
	let handler: IUriCallbackHandler

	beforeEach(() => {
		vi.clearAllMocks()
		handler = createMockHandler()
		registerUriCallbackHandler(handler)
	})

	it("passes codeVerifier to OpenRouter callback when present", async () => {
		handler.pendingOAuthState = {
			state: "pkce-state",
			codeVerifier: "my-code-verifier-123",
			provider: "openrouter",
			createdAt: Date.now(),
		}

		const uri = createMockUri("/openrouter", "code=pkce-code&state=pkce-state")
		await handleUri(uri)

		expect(handler.handleOpenRouterCallback).toHaveBeenCalledWith("pkce-code", "my-code-verifier-123")
	})
})

describe("handleUri — no residual authentication state", () => {
	let handler: IUriCallbackHandler

	beforeEach(() => {
		vi.clearAllMocks()
		handler = createMockHandler()
		registerUriCallbackHandler(handler)
	})

	it("successful callback clears pending state completely", async () => {
		handler.pendingOAuthState = {
			state: "final-state",
			provider: "openrouter",
			createdAt: Date.now(),
		}

		const uri = createMockUri("/openrouter", "code=final-code&state=final-state")
		await handleUri(uri)

		expect(handler.pendingOAuthState).toBeUndefined()
		expect(handler.handleOpenRouterCallback).toHaveBeenCalledWith("final-code", undefined)
	})

	it("callback handler exception does not leave state in inconsistent form", async () => {
		handler.pendingOAuthState = {
			state: "error-state",
			provider: "openrouter",
			createdAt: Date.now(),
		}
		vi.mocked(handler.handleOpenRouterCallback).mockRejectedValueOnce(new Error("network error"))

		const uri = createMockUri("/openrouter", "code=err-code&state=error-state")

		// The error propagates — but state was already cleared before the callback
		await expect(handleUri(uri)).rejects.toThrow("network error")

		// State is cleared even though callback threw
		expect(handler.pendingOAuthState).toBeUndefined()
	})
})
