/**
 * Derive a CSP-safe `connect-src` origin from a user-editable URL.
 *
 * The OpenRouter base URL lives in mutable global state that the webview can
 * write. Interpolating a raw value (or a regex capture of it) into a
 * Content-Security-Policy header lets a crafted value inject extra directives
 * (e.g. `https://evil.com; script-src 'unsafe-inline'`). Always parse with
 * `new URL()`, restrict the scheme, and normalize to `.origin`.
 */

const DEFAULT_OPENROUTER_ORIGIN = "https://openrouter.ai"

/**
 * Returns a safe origin string for use in a CSP, or the default OpenRouter
 * origin when the input is missing / malformed / uses an unsafe scheme.
 * Any HTTPS host is allowed so enterprise/self-hosted OpenRouter-compatible
 * gateways keep working; the URL parser strips paths, credentials and any
 * would-be CSP suffix, leaving only `scheme://host[:port]`.
 */
export function safeConnectOrigin(raw: string | undefined, allowHttpLocalhost = false): string {
	if (!raw || typeof raw !== "string") return DEFAULT_OPENROUTER_ORIGIN
	try {
		const url = new URL(raw)
		const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1"
		if (url.protocol === "https:" || (allowHttpLocalhost && url.protocol === "http:" && isLocalhost)) {
			return url.origin
		}
	} catch {
		// Malformed URL — fall through to the safe default.
	}
	return DEFAULT_OPENROUTER_ORIGIN
}
