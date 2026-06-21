/**
 * Shared fetch helpers for model-list fetchers.
 *
 * These utilities harden the fetcher layer with two measures that were
 * previously missing:
 *
 *  1. Request timeout — prevents the UI from hanging indefinitely when a
 *     provider endpoint is unresponsive. The default is 10 seconds.
 *  2. Response body size cap — reads the body via the Streams API and rejects
 *     as soon as the byte limit is exceeded, preventing an unbounded
 *     `res.json()`/`res.text()` from exhausting memory.
 *
 * The size-limited reader mirrors `readResponseBodyWithLimit` in
 * `services/cloud-agent/CloudAgentClient.ts`; model-list responses are far
 * smaller, so the default cap is 5 MB rather than 50 MB.
 */

/** Default request timeout for model-list fetches (ms). */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000

/** Default response body size cap for model-list fetches (bytes). */
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024

/**
 * Read a Response body in streaming chunks, enforcing a hard byte limit.
 *
 * Unlike `resp.text()` — which buffers the entire body into memory (potentially
 * unbounded when `Transfer-Encoding: chunked` is sent without Content-Length) —
 * this reads via the Streams API and throws as soon as the limit is exceeded.
 *
 * Falls back to `resp.text()` when no streaming body is present (e.g. empty
 * responses or non-streaming Response stubs).
 */
export async function readBodyWithLimit(resp: Response, maxBytes: number): Promise<string> {
	if (!resp.body) {
		// No streaming body available — fall back to the Response text/json helpers.
		// Real fetch Responses always expose text(); some test stubs / polyfills
		// only expose json(), so stringify that as a last resort.
		if (typeof resp.text === "function") {
			return resp.text()
		}
		if (typeof resp.json === "function") {
			return JSON.stringify(await resp.json())
		}
		return ""
	}

	const reader = resp.body.getReader()
	const chunks: Uint8Array[] = []
	let totalBytes = 0

	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done) break

			totalBytes += value.byteLength
			if (totalBytes > maxBytes) {
				// Cancel the stream to stop receiving further chunks
				await reader.cancel().catch(() => {})
				throw new Error(`Response body exceeds size limit (${(maxBytes / 1024 / 1024).toFixed(1)} MB)`)
			}

			chunks.push(value)
		}
	} finally {
		// Best-effort release the reader lock
		reader.releaseLock?.()
	}

	// Concatenate chunks and decode
	const combined = new Uint8Array(totalBytes)
	let offset = 0
	for (const chunk of chunks) {
		combined.set(chunk, offset)
		offset += chunk.byteLength
	}
	return new TextDecoder().decode(combined)
}

/**
 * Join a base URL and a path using the `URL` constructor.
 *
 * Unlike naive string concatenation, this preserves query parameters and
 * fragments on the base URL and normalizes duplicate/leading slashes. Returns
 * the original `baseUrl` unchanged when it is not parseable as a URL (e.g. some
 * non-standard provider base URLs).
 */
export function joinUrl(baseUrl: string, path: string): string {
	try {
		const url = new URL(baseUrl)
		const basePath = url.pathname.replace(/\/+$/, "")
		const cleanPath = path.replace(/^\/+/, "")
		url.pathname = cleanPath ? `${basePath}/${cleanPath}` : basePath
		return url.toString()
	} catch {
		// Fall back to simple concatenation for non-URL base strings.
		return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
	}
}

export interface SafeFetchOptions {
	/** Request timeout in milliseconds. Defaults to {@link DEFAULT_FETCH_TIMEOUT_MS}. */
	timeoutMs?: number
	/** Optional abort signal to chain caller cancellation. */
	signal?: AbortSignal
	/**
	 * Number of times to retry on transient network errors (connection reset,
	 * timeout, 5xx). Defaults to 0 (no retry). Retries use exponential backoff
	 * with jitter and only apply to errors thrown by the fetch itself, NOT to
	 * non-2xx HTTP responses (the caller decides how to handle those).
	 */
	retries?: number
}

/** Small async sleep helper. */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Decide whether a fetch error is worth retrying.
 *
 * Retries cover transient failures: timeouts (rewritten to a plain Error by
 * safeFetch), AbortError, TypeError ("fetch failed" / network down), and
 * 5xx/429 responses surfaced as errors. Non-network errors and 4xx (other
 * than 429) are not retried.
 */
function isRetryableFetchError(error: unknown): boolean {
	if (error instanceof Error) {
		const msg = error.message.toLowerCase()
		if (
			error.name === "AbortError" ||
			/timed out|timeout|fetch failed|network|econnreset|econnrefused|enotfound/.test(msg)
		) {
			return true
		}
	}
	return false
}

/**
 * Shared axios request config that hardens model-list fetches.
 *
 * Returns a config object with:
 *  - `timeout` — request timeout in ms (prevents indefinite hang)
 *  - `maxContentLength` / `maxBodyLength` — response/request body size caps
 *    that make axios reject with an `AxiosError` before buffering an
 *    unbounded payload into memory.
 *
 * Callers should spread this into their axios call, e.g.:
 *   `axios.get(url, { headers, ...safeAxiosConfig() })`
 */
export function safeAxiosConfig(options: SafeFetchOptions = {}): {
	timeout: number
	maxContentLength: number
	maxBodyLength: number
} {
	const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
	return {
		timeout: timeoutMs,
		maxContentLength: DEFAULT_MAX_BODY_BYTES,
		maxBodyLength: DEFAULT_MAX_BODY_BYTES,
	}
}

/**
 * Fetch a URL with a request timeout, returning the raw Response.
 *
 * The caller is responsible for checking `response.ok` and reading the body
 * (use {@link readBodyWithLimit} to enforce a size cap). The timeout is
 * enforced via an AbortController; on timeout an `Error` with a clear message
 * is thrown (AbortError is rewritten for clarity).
 */
export async function safeFetch(
	url: string,
	init: RequestInit = {},
	options: SafeFetchOptions = {},
): Promise<Response> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
	const maxRetries = Math.max(0, options.retries ?? 0)

	let lastError: unknown
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		// If the caller's abort signal already fired, stop immediately.
		if (options.signal?.aborted) {
			throw new Error("Request aborted before start")
		}

		const timeoutController = new AbortController()
		const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)

		// Chain the caller-provided signal if present. Track the listener so it
		// can be removed at the end of this attempt — otherwise retries would
		// accumulate listeners on the caller's long-lived signal.
		let externalAbortListener: (() => void) | undefined
		if (options.signal) {
			if (options.signal.aborted) {
				timeoutController.abort()
			} else {
				externalAbortListener = () => timeoutController.abort()
				options.signal.addEventListener("abort", externalAbortListener, { once: true })
			}
		}

		try {
			const response = await fetch(url, {
				...init,
				signal: timeoutController.signal,
			})
			// Retry 5xx and 429 responses (transient server-side failures).
			if (maxRetries > 0 && attempt < maxRetries && (response.status === 429 || response.status >= 500)) {
				// Release the body without buffering it (avoid loading a large
				// CDN/HTML error page into memory). Cancel the stream when
				// available; otherwise best-effort drain.
				if (response.body && typeof response.body.cancel === "function") {
					await response.body.cancel().catch(() => {})
				} else {
					await response.text().catch(() => {})
				}
				lastError = new Error(`Transient HTTP ${response.status}`)
				await sleep(1000 * Math.pow(2, attempt) + Math.random() * 500)
				continue
			}
			return response
		} catch (error) {
			// Distinguish a caller-initiated abort (do NOT retry, surface
			// immediately) from our own timeout abort (retryable).
			if (options.signal?.aborted) {
				throw new Error("Request aborted by caller")
			}
			// Rewrite our own timeout abort to a clearer timeout message
			if (error instanceof Error && error.name === "AbortError") {
				lastError = new Error(`Request timed out after ${timeoutMs}ms`)
			} else {
				lastError = error
			}
			// Retry only transient network/timeout errors; otherwise rethrow.
			if (attempt < maxRetries && isRetryableFetchError(lastError)) {
				await sleep(1000 * Math.pow(2, attempt) + Math.random() * 500)
				continue
			}
			throw lastError
		} finally {
			clearTimeout(timeoutId)
			// Remove the per-attempt external-signal listener so retries
			// don't accumulate listeners on the caller's long-lived signal.
			if (externalAbortListener && options.signal) {
				options.signal.removeEventListener("abort", externalAbortListener)
			}
		}
	}
	throw lastError ?? new Error("safeFetch exhausted retries")
}
