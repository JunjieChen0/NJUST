import dns from "node:dns/promises"
import net from "node:net"

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost."])

/** Maximum number of redirects to follow before giving up. */
const MAX_REDIRECTS = 10

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
	let currentUrl = parsed.toString()
	let headers = new Headers(init?.headers)

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

		// Validate the redirect target.
		parsed = await assertSafeOutboundUrl(redirectUrl)
		const newOrigin = parsed.origin

		// Strip sensitive headers on cross-origin redirects.
		const oldOrigin = new URL(currentUrl).origin
		headers = stripSensitiveHeadersForCrossOrigin(headers, oldOrigin, newOrigin)

		currentUrl = parsed.toString()
	}

	throw new Error(`Too many redirects (max ${MAX_REDIRECTS}): ${currentUrl}`)
}
