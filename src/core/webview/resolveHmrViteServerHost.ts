/**
 * resolveHmrViteServerHost — choose the host:port for the dev (HMR) Vite server
 * the webview should connect to.
 *
 * Hardening rules:
 *  - Only loopback hosts are returned. Bind addresses like `0.0.0.0` are not
 *    accepted because they would let any LAN attacker on the same network
 *    serve scripts into the webview when the user runs HMR.
 *  - Ports must be a positive integer in [1, 65535] and round-trip through
 *    `String(parseInt(...))` to defeat sneaky inputs like `"5173 "` or
 *    `"5173.0"` or scientific-notation tricks.
 *  - On any rejection the function returns the default `localhost:5173`
 *    rather than throwing — the caller will then try to connect and surface
 *    a normal "HMR not running" message if that fails.
 */

const HMR_DEFAULT_PORT = 5173

export interface ResolveHmrHostInput {
	/** Raw port string read from `.vite-port`. May be `null`/`undefined`/missing. */
	rawPort?: string | null
}

export interface ResolveHmrHostResult {
	host: string
	port: number
	/** True iff the input passed all checks. False indicates a fall-back to the default. */
	ok: boolean
	/** Set when `ok` is false; describes why the input was rejected. */
	reason?: string
}

export function resolveHmrViteServerHost(input: ResolveHmrHostInput): ResolveHmrHostResult {
	const raw = input.rawPort
	if (raw === undefined || raw === null) {
		return { host: "localhost", port: HMR_DEFAULT_PORT, ok: false, reason: "missing port file" }
	}

	const trimmed = String(raw).trim()
	if (trimmed.length === 0) {
		return { host: "localhost", port: HMR_DEFAULT_PORT, ok: false, reason: "empty port" }
	}

	const parsed = parseInt(trimmed, 10)
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535 || String(parsed) !== trimmed) {
		return { host: "localhost", port: HMR_DEFAULT_PORT, ok: false, reason: `invalid port "${trimmed}"` }
	}

	return { host: "localhost", port: parsed, ok: true }
}
