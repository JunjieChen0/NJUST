/**
 * Origin validation for API routes.
 * Ensures SSE/log endpoints are only accessed from the same origin
 * to prevent cross-site request attacks.
 */

import type { NextRequest } from "next/server"

/**
 * Validate that the Origin or Referer header matches the request's host.
 * For same-origin requests (e.g., from the web-evals UI), the Origin or
 * Referer must match the Host header.
 *
 * GET requests without Origin/Referer are allowed (curl, health checks).
 * Write operations (POST/PUT/DELETE) MUST provide Origin or Referer to prevent CSRF.
 */
export function validateOrigin(request: NextRequest): boolean {
	const host = request.headers.get("host")
	if (!host) {
		// No host header — reject
		return false
	}

	const origin = request.headers.get("origin")
	const referer = request.headers.get("referer")

	// If neither Origin nor Referer is present:
	// - Allow GET requests (curl, health checks, etc.)
	// - Reject write operations to prevent CSRF
	if (!origin && !referer) {
		return request.method === "GET"
	}

	// Check Origin header if present
	if (origin) {
		try {
			const originUrl = new URL(origin)
			if (originUrl.host === host) {
				return true
			}
		} catch {
			// Invalid origin URL
		}
	}

	// Check Referer header if Origin not present or didn't match
	if (referer) {
		try {
			const refererUrl = new URL(referer)
			if (refererUrl.host === host) {
				return true
			}
		} catch {
			// Invalid referer URL
		}
	}

	return false
}
