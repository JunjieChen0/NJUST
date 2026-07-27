import dns from "node:dns/promises"
import net from "node:net"

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost."])

/** Maximum number of redirects to follow before giving up. */
const MAX_REDIRECTS = 5

/** Maximum request body size (10 MB) to prevent abuse. */
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024

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
	const normalized = ip.toLowerCase()
	if (normalized === "::1") return true
	if (normalized === "::") return true
	if (normalized.startsWith("fe80:")) return true // link-local
	if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true // unique-local
	if (normalized.startsWith("ff")) return true // multicast
	if (normalized.startsWith("::ffff:")) {
		const mapped = normalized.replace(/^::ffff:/, "")
		if (net.isIP(mapped) === 4 && isPrivateIPv4(mapped)) {
			return true
		}
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

export async function assertSafeOutboundUrl(url: string): Promise<URL> {
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

	const hostIpVersion = net.isIP(parsed.hostname)
	if (hostIpVersion !== 0) {
		assertPublicIp(parsed.hostname)
		return parsed
	}

	const lookedUp = await dns.lookup(parsed.hostname, { all: true, verbatim: true })
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
 * Validate that a redirect target stays within the same registrable domain.
 * Prevents open-redirect attacks where a trusted server redirects to an
 * attacker-controlled domain to leak authorization headers.
 *
 * Uses a simplified check: the hostname of the redirect target must equal
 * or be a subdomain of the original hostname (or vice versa).
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
	if (net.isIP(parsed.hostname) !== 0) {
		return fetch(parsed.toString(), { ...init, redirect: "manual" })
	}

	const resolved = await dns.lookup(parsed.hostname, { all: true, verbatim: true })
	if (!resolved.length) {
		throw new Error(`Could not resolve host: ${parsed.hostname}`)
	}
	for (const entry of resolved) {
		assertPublicIp(entry.address)
	}

	const pinnedIp = resolved[0]!.address
	const ipUrl = new URL(parsed.toString())
	ipUrl.hostname = net.isIP(pinnedIp) === 6 ? `[${pinnedIp}]` : pinnedIp

	const headers = new Headers(init?.headers)
	if (!headers.has("Host")) {
		headers.set("Host", parsed.hostname)
	}

	return fetch(ipUrl.toString(), { ...init, headers, redirect: "manual" })
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
	let parsed = await assertSafeOutboundUrl(url)
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
		parsed = await assertSafeOutboundUrl(redirectUrl)

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

	throw new Error(`Too many redirects (max ${MAX_REDIRECTS}): ${currentUrl}`)
}
