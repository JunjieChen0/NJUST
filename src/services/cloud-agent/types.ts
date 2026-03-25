export interface CloudRunResponse {
	ok: boolean
	user_goal: string
	memory_summary: string
	logs: string[]
	/** Usage fields when returned by the cloud service */
	tokens_in?: number
	tokens_out?: number
	cost?: number
}

export interface CloudRunResult {
	memorySummary: string
	tokensIn: number
	tokensOut: number
	cost: number
}

export interface CloudAgentCallbacks {
	onText: (content: string) => Promise<void>
	onReasoning: (content: string) => Promise<void>
	onDone: (summary?: string) => Promise<void>
	onError: (message: string) => Promise<void>
}

export interface CloudAgentClientOptions {
	/** Sent as X-API-Key when set. Omit header when unset (some deployments use device token only). */
	apiKey?: string
	/** Aborts in-flight fetch when signalled (e.g. user cancelled the task). */
	signal?: AbortSignal
	/** Per-request timeout in ms; 0 or unset means no timeout. */
	requestTimeoutMs?: number
}
