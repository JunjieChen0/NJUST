import dns from "node:dns/promises"
import net from "node:net"
import { Agent, Pool, ProxyAgent, type Dispatcher } from "undici"
import { logger } from "../shared/logger.js"

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost."])

/** Maximum number of redirects to follow before giving up. */
const MAX_REDIRECTS = 5

/** Maximum request body size (10 MB) to prevent abuse. */
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024

let debugProxy: { serverUrl: string; tlsInsecure: boolean } | undefined

/** Set only by the extension's development-mode proxy lifecycle. */
export function setGuardedFetchProxy(config: typeof debugProxy): void {
	debugProxy = config
}

/** Sensitive headers to strip on cross-origin redirects. */
const SENSITIVE_HEADERS = new Set(["authorization", "cookie", "set-cookie", "proxy-authorization", "x-api-key"])

function isPrivateIPv4(ip: string): boolean {
	const parts = ip.split(".").map((p) => Number.parseInt(p, 10))
	if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
		return true
	}
	const a = parts[0]!
	const b = parts[1]!
	if (a === 10) return true
	if (a === 127) return true
	if (a === 0) return true
	if (a === 169 && b === 254) return true
	if (a === 172 && b >= 16 && b <= 31) return true
	if (a === 192 && b === 168) return true
	if (a >= 224) return true // multicast + reserved
	return false
}

function isBlockedIPv6(ip: string): boolean {
	const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1)
	if (normalized === "::1") return true
	if (normalized === "::") return true
	if ((Number.parseInt(normalized.split(":")[0]!, 16) & 0xffc0) === 0xfe80) return true // fe80::/10
	if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true // unique-local
	if (normalized.startsWith("ff")) return true // multicast
	if (normalized.startsWith("::ffff:")) {
		const words = normalized
			.slice(7)
			.split(":")
			.map((word) => Number.parseInt(word, 16))
		if (words.length === 2)
			return isPrivateIPv4([words[0]! >>> 8, words[0]! & 255, words[1]! >>> 8, words[1]! & 255].join("."))
	}
	return false
}

export function assertPublicIp(ip: string): void {
	const ipVersion = net.isIP(ip)
	if (ipVersion === 4) {
		if (isPrivateIPv4(ip)) {
			throw new Error(`Blocked private or non-routable IPv4 address: ${ip}`)
		}
		return
	}
	if (ipVersion === 6) {
		if (isBlockedIPv6(ip)) {
			throw new Error(`Blocked private or non-routable IPv6 address: ${ip}`)
		}
		return
	}
	throw new Error(`Invalid IP address: ${ip}`)
}

function assertHostnameAllowed(hostname: string): void {
	const lower = hostname.trim().toLowerCase()
	if (!lower) {
		throw new Error("URL hostname is empty.")
	}
	if (BLOCKED_HOSTNAMES.has(lower) || lower.endsWith(".local")) {
		throw new Error(`Blocked local hostname: ${hostname}`)
	}
}

/** DNS itself cannot be cancelled, but callers must stop waiting and never use a late result. */
export async function lookupWithAbort(hostname: string, signal?: AbortSignal | null) {
	const deadline = AbortSignal.timeout(30_000)
	const active = signal ? AbortSignal.any([signal, deadline]) : deadline
	active.throwIfAborted()
	let onAbort!: () => void
	const aborted = new Promise<never>((_resolve, reject) => {
		onAbort = () => reject(active.reason)
		active.addEventListener("abort", onAbort, { once: true })
	})
	try {
		const result = await Promise.race([dns.lookup(hostname, { all: true, verbatim: true }), aborted])
		active.throwIfAborted()
		return result
	} finally {
		active.removeEventListener("abort", onAbort)
	}
}

export async function assertSafeOutboundUrl(url: string, signal?: AbortSignal | null): Promise<URL> {
	signal?.throwIfAborted()
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		throw new Error(`Invalid URL: ${url}`)
	}

	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Only HTTP/HTTPS URLs are allowed. Got: ${parsed.protocol}`)
	}

	assertHostnameAllowed(parsed.hostname)

	const hostname = parsed.hostname.replace(/^\[|\]$/g, "")
	const hostIpVersion = net.isIP(hostname)
	if (hostIpVersion !== 0) {
		assertPublicIp(hostname)
		return parsed
	}

	const lookedUp = await lookupWithAbort(hostname, signal)
	if (!lookedUp.length) {
		throw new Error(`Could not resolve host: ${parsed.hostname}`)
	}

	for (const entry of lookedUp) {
		assertPublicIp(entry.address)
	}

	return parsed
}

/**
 * Assert that a URL uses HTTPS, with exceptions for loopback addresses.
 * Used to enforce HTTPS on initial requests and redirect targets.
 */
function assertHttpsUnlessLocalhost(parsed: URL): void {
	if (parsed.protocol === "https:") return
	const h = parsed.hostname
	if (h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1") return
	throw new Error(`HTTPS is required for non-localhost connections. Got: ${parsed.protocol}//${parsed.hostname}`)
}

/**
 * Validate that a redirect target stays within the same host family.
 * Prevents open-redirect attacks where a trusted server redirects to an
 * attacker-controlled domain to leak authorization headers.
 *
 * Current policy: the redirect target must be the same hostname, or a parent/child
 * of it (a.example.com ⇄ example.com). Sibling subdomains (a.example.com →
 * b.example.com) are rejected. Using the registrable domain (eTLD+1 via the Public
 * Suffix List) would be more precise; tracked as a follow-up.
 */
function assertSameDomainRedirect(from: URL, to: URL): void {
	const fromHost = from.hostname.toLowerCase()
	const toHost = to.hostname.toLowerCase()
	if (fromHost === toHost) return
	// Allow subdomain matches: a.example.com → b.example.com
	if (fromHost.endsWith(`.${toHost}`) || toHost.endsWith(`.${fromHost}`)) return
	throw new Error(
		`Cross-domain redirect blocked: ${fromHost} → ${toHost}. Redirects must stay within the same domain.`,
	)
}

/**
 * Validate that request headers do not contain CRLF injection sequences.
 * Header names and values must not include \r, \n, or \0 characters.
 */
/**
 * Collect header entries from any supported header representation.
 * Uses `forEach` instead of `entries()` for compatibility with all Headers definitions.
 */
function collectHeaderEntries(headers: Headers): [string, string][] {
	const entries: [string, string][] = []
	headers.forEach((value, key) => {
		entries.push([key, value])
	})
	return entries
}

export function assertHeadersSafe(headers: Headers | Record<string, string> | [string, string][] | undefined): void {
	if (!headers) return
	const CRLF_RE = /[\r\n\0]/
	let entries: [string, string][]
	if (headers instanceof Headers) {
		entries = collectHeaderEntries(headers)
	} else if (Array.isArray(headers)) {
		entries = headers
	} else {
		entries = Object.entries(headers)
	}
	for (const [name, value] of entries) {
		if (CRLF_RE.test(name)) {
			throw new Error(`Header name contains invalid characters (CRLF injection): "${name}"`)
		}
		if (CRLF_RE.test(value)) {
			throw new Error(`Header "${name}" contains invalid characters (CRLF injection)`)
		}
	}
}

/**
 * Validate that a request body does not exceed the maximum allowed size.
 *
 * Explicitly supported BodyInit types with upfront length determination:
 * - `string` (UTF-8 byte length)
 * - `Uint8Array` (byteLength)
 * - `ArrayBuffer` (byteLength)
 *
 * Types that cannot be reliably sized before consumption are **not** checked here:
 * `Blob`, `FormData`, `ReadableStream`, `URLSearchParams`.
 * For these, enforcement must happen server-side or via streaming limits.
 */
function assertRequestBodySize(body: BodyInit | null | undefined): void {
	if (body === null || body === undefined) return

	if (typeof body === "string") {
		const byteLen = new TextEncoder().encode(body).byteLength
		if (byteLen > MAX_REQUEST_BODY_BYTES) {
			throw new Error(
				`Request body size (${(byteLen / 1024 / 1024).toFixed(1)} MB) exceeds limit (${(MAX_REQUEST_BODY_BYTES / 1024 / 1024).toFixed(1)} MB)`,
			)
		}
		return
	}

	if (body instanceof Uint8Array) {
		if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
			throw new Error(
				`Request body size (${(body.byteLength / 1024 / 1024).toFixed(1)} MB) exceeds limit (${(MAX_REQUEST_BODY_BYTES / 1024 / 1024).toFixed(1)} MB)`,
			)
		}
		return
	}

	if (body instanceof ArrayBuffer) {
		if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
			throw new Error(
				`Request body size (${(body.byteLength / 1024 / 1024).toFixed(1)} MB) exceeds limit (${(MAX_REQUEST_BODY_BYTES / 1024 / 1024).toFixed(1)} MB)`,
			)
		}
		return
	}

	// Blob, FormData, ReadableStream, URLSearchParams — size cannot be
	// determined upfront without consuming the stream. Enforcement must
	// rely on server-side limits or streaming byte counters.
}

/**
 * Strip sensitive headers when redirecting to a different origin.
 */
function stripSensitiveHeadersForCrossOrigin(headers: Headers, fromOrigin: string, toOrigin: string): Headers {
	if (fromOrigin === toOrigin) {
		return headers
	}
	const stripped = new Headers()
	headers.forEach((value, key) => {
		if (!SENSITIVE_HEADERS.has(key.toLowerCase())) {
			stripped.set(key, value)
		}
	})
	return stripped
}

/**
 * Perform a single fetch with IP pinning against a validated URL.
 */
async function pinnedFetch(parsed: URL, init?: RequestInit): Promise<Response> {
	init?.signal?.throwIfAborted()
	const hostname = parsed.hostname.replace(/^\[|\]$/g, "")
	const family = net.isIP(hostname)
	if (family !== 0 && !debugProxy) {
		return fetch(parsed.toString(), { ...init, redirect: "manual" })
	}

	const resolved = family ? [{ address: hostname, family }] : await lookupWithAbort(hostname, init?.signal)
	if (!resolved.length) {
		throw new Error(`Could not resolve host: ${parsed.hostname}`)
	}
	for (const entry of resolved) {
		assertPublicIp(entry.address)
	}

	const target = resolved[0]!
	const authority = `${target.family === 6 ? `[${target.address}]` : target.address}:${parsed.port || (parsed.protocol === "https:" ? 443 : 80)}`
	const dispatcher = debugProxy
		? new ProxyAgent({
				uri: debugProxy.serverUrl,
				requestTls: { rejectUnauthorized: !debugProxy.tlsInsecure },
				proxyTls: { rejectUnauthorized: !debugProxy.tlsInsecure },
				// Pin the proxy's CONNECT destination; keep the request origin for Host and TLS.
				clientFactory: (origin, options) =>
					new Pool(origin, options).compose(
						(dispatch) => (options, handler) =>
							dispatch(
								{ ...options, path: authority, headers: { ...options.headers, host: authority } },
								handler,
							),
					),
			})
		: new Agent({
				connect: {
					lookup: (_hostname, options, callback) => {
						if (options.all) callback(null, resolved)
						else callback(null, target.address, target.family)
					},
				},
			})
	try {
		init?.signal?.throwIfAborted()
		// Keep the original origin for Host, TLS SNI and certificate verification.
		return await fetch(parsed.toString(), { ...init, redirect: "manual", dispatcher } as RequestInit & {
			dispatcher: Dispatcher
		})
	} finally {
		// Drain active response bodies before closing; awaiting here would block streaming callers.
		void dispatcher.close().catch((error) => logger.debug("networkGuard", "Cannot close pinned dispatcher", error))
	}
}

/**
 * Resolve a redirect Location header against the current request URL.
 */
function resolveRedirectLocation(location: string, currentUrl: URL): string {
	try {
		return new URL(location).toString()
	} catch {
		return new URL(location, currentUrl.toString()).toString()
	}
}

/**
 * A fetch wrapper that prevents SSRF via redirect chains.
 *
 * Unlike the standard `fetch` which follows redirects automatically without
 * re-validating each hop, this function:
 * 1. Sets `redirect: "manual"` to intercept every redirect.
 * 2. Re-validates (DNS + public-IP check) each redirect target.
 * 3. Strips sensitive headers on cross-origin redirects.
 * 4. Caps the redirect chain at {@link MAX_REDIRECTS} hops.
 *
 * @param url - The initial URL to fetch
 * @param init - Standard RequestInit (redirect is forced to "manual")
 * @returns The final Response (non-redirect status)
 */
export async function guardedFetch(url: string, init?: RequestInit): Promise<Response> {
	let parsed = await assertSafeOutboundUrl(url, init?.signal)
	// Enforce HTTPS for non-localhost initial URL
	assertHttpsUnlessLocalhost(parsed)
	// Validate headers against CRLF injection
	assertHeadersSafe(init?.headers as Headers | Record<string, string> | [string, string][] | undefined)
	// Validate request body size
	assertRequestBodySize(init?.body)

	let currentUrl = parsed.toString()
	let headers = new Headers(init?.headers)
	const initialProtocol = parsed.protocol

	const { redirect: _ignored, ...restInit } = init ?? {}

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		init?.signal?.throwIfAborted()
		const resp = await pinnedFetch(parsed, { ...restInit, headers })

		const status = resp.status
		if (status < 300 || status >= 400 || !resp.headers.has("location")) {
			return resp
		}

		// Consume the redirect response body to release the connection.
		await resp.text().catch(() => {})

		const location = resp.headers.get("location")!
		const redirectUrl = resolveRedirectLocation(location, new URL(currentUrl))
		const prevUrl = new URL(currentUrl)

		// Validate the redirect target (DNS + IP + hostname).
		parsed = await assertSafeOutboundUrl(redirectUrl, init?.signal)

		// Prevent HTTPS → HTTP downgrade
		if (initialProtocol === "https:" && parsed.protocol === "http:") {
			const h = parsed.hostname
			if (h !== "localhost" && h !== "127.0.0.1" && h !== "[::1]" && h !== "::1") {
				throw new Error(
					`HTTPS downgrade blocked: redirect from ${prevUrl.hostname} (HTTPS) to ${parsed.hostname} (HTTP)`,
				)
			}
		}

		// Same-domain redirect check
		assertSameDomainRedirect(prevUrl, parsed)

		const newOrigin = parsed.origin

		// Strip sensitive headers on cross-origin redirects.
		const oldOrigin = prevUrl.origin
		headers = stripSensitiveHeadersForCrossOrigin(headers, oldOrigin, newOrigin)

		currentUrl = parsed.toString()
	}

	throw new Error(`Too many redirects (max ${MAX_REDIRECTS}): ${parsed.origin}`)
}
