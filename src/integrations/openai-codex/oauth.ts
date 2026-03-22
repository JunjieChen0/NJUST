// OAuth manager stub for OpenAI Codex
// This is a stub since we've removed the actual OAuth implementation

export const openAiCodexOAuthManager = {
	async getAccessToken(): Promise<string | null> {
		return null
	},

	async forceRefreshAccessToken(): Promise<string | null> {
		return null
	},

	async getAccountId(): Promise<string | null> {
		return null
	},

	async isAuthenticated(): Promise<boolean> {
		return false
	},

	initialize(_context: any, _messageCallback: (message: string) => void): void {
		// Stub - no-op
	},

	startAuthorizationFlow(): string {
		// Stub - return empty URL
		return ""
	},

	async waitForCallback(): Promise<{ success: boolean; error?: string }> {
		// Stub - return failure
		return { success: false }
	},

	async clearCredentials(): Promise<void> {
		// Stub - no-op
	}
}
