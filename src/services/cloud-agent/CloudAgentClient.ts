import type { CloudAgentCallbacks, CloudAgentClientOptions, CloudRunResponse, CloudRunResult } from "./types"

export class CloudAgentClient {
	private serverUrl: string
	private deviceToken: string
	private callbacks: CloudAgentCallbacks
	private readonly options: CloudAgentClientOptions | undefined

	constructor(
		serverUrl: string,
		deviceToken: string,
		callbacks: CloudAgentCallbacks,
		options?: CloudAgentClientOptions,
	) {
		this.serverUrl = serverUrl.replace(/\/$/, "")
		this.deviceToken = deviceToken
		this.callbacks = callbacks
		this.options = options
	}

	private mergeAbortAndTimeout(): { signal?: AbortSignal; cleanup: () => void } {
		const baseSignal = this.options?.signal
		const timeoutMs = this.options?.requestTimeoutMs
		const hasTimeout = !!(timeoutMs && timeoutMs > 0)

		if (!hasTimeout && !baseSignal) {
			return { cleanup: () => {} }
		}
		if (!hasTimeout && baseSignal) {
			return { signal: baseSignal, cleanup: () => {} }
		}

		const controller = new AbortController()
		const cleanups: (() => void)[] = []

		if (hasTimeout) {
			const id = setTimeout(() => {
				controller.abort(new DOMException("Cloud Agent request timed out", "AbortError"))
			}, timeoutMs!)
			cleanups.push(() => clearTimeout(id))
		}

		if (baseSignal) {
			if (baseSignal.aborted) {
				controller.abort(baseSignal.reason)
			} else {
				const onAbort = () => controller.abort(baseSignal.reason)
				baseSignal.addEventListener("abort", onAbort, { once: true })
				cleanups.push(() => baseSignal.removeEventListener("abort", onAbort))
			}
		}

		return { signal: controller.signal, cleanup: () => cleanups.forEach((fn) => fn()) }
	}

	private buildHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			"X-Device-Token": this.deviceToken,
		}
		if (this.options?.apiKey) {
			headers["X-API-Key"] = this.options.apiKey
		}
		return headers
	}

	private async parseJsonResponse(resp: Response): Promise<CloudRunResponse> {
		const text = await resp.text()
		try {
			return JSON.parse(text) as CloudRunResponse
		} catch {
			throw new Error(
				`Cloud Agent: response is not valid JSON (HTTP ${resp.status}): ${text.slice(0, 400)}${text.length > 400 ? "…" : ""}`,
			)
		}
	}

	async connect(): Promise<void> {
		const { signal, cleanup } = this.mergeAbortAndTimeout()
		try {
			const resp = await fetch(`${this.serverUrl}/health`, {
				method: "GET",
				...(signal ? { signal } : {}),
				headers: this.buildHeaders(),
			})
			if (!resp.ok) {
				const errText = await resp.text()
				throw new Error(`Cloud Agent health check failed: HTTP ${resp.status}: ${errText.slice(0, 300)}`)
			}
		} finally {
			cleanup()
		}
	}

	async submitTask(
		sessionId: string,
		message: string,
		workspacePath?: string,
		images?: string[],
	): Promise<CloudRunResult> {
		const body: Record<string, unknown> = {
			goal: message,
			session_id: sessionId,
			workspace_path: workspacePath,
		}
		if (images && images.length > 0) {
			body.images = images
		}

		const { signal, cleanup } = this.mergeAbortAndTimeout()
		let resp: Response
		try {
			resp = await fetch(`${this.serverUrl}/v1/run`, {
				method: "POST",
				headers: this.buildHeaders(),
				body: JSON.stringify(body),
				...(signal ? { signal } : {}),
			})
		} finally {
			cleanup()
		}

		if (!resp.ok) {
			const errText = await resp.text()
			throw new Error(`Cloud Agent error (HTTP ${resp.status}): ${errText.slice(0, 500)}`)
		}

		const data = await this.parseJsonResponse(resp)

		for (const log of data.logs || []) {
			await this.callbacks.onText(log)
		}

		if (data.memory_summary) {
			await this.callbacks.onText(data.memory_summary)
		}

		await this.callbacks.onDone(data.ok ? "Task completed" : "Task failed")

		return {
			memorySummary: data.memory_summary || "",
			tokensIn: data.tokens_in ?? 0,
			tokensOut: data.tokens_out ?? 0,
			cost: data.cost ?? 0,
		}
	}

	async disconnect(): Promise<void> {
		// No persistent connection in REST mode
	}
}
